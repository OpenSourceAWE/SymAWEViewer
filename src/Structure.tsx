import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  anchorPoints,
  pointGroups,
  pointPick,
  segmentRoles,
  tubeEnds,
  type PointGroup,
  type PointPick,
  type SegmentRole,
} from "./parts";
import {
  canopyPositions,
  optionalColumnValues,
  pointPositions,
  segmentPositions,
  type Frame,
  type Run,
} from "./topology";

/** The simulation frame is z-up; three.js is y-up. */
export const Z_UP_TO_Y_UP: [number, number, number] = [-Math.PI / 2, 0, 0];

/** Colors of each part the structure is drawn in. */
export interface Palette extends Record<SegmentRole, string> {
  tube: string;
  canopy: string;
  point: string;
  anchor: string;
  highlight: string;
  /** The spring force scale at its most compressive, at zero and at its most tensile. */
  compression: string;
  unloaded: string;
  tension: string;
  /** The arrows of the aero and of the drag force. */
  aero: string;
  drag: string;
}

/** The colors `Structure` draws in where its `palette` names none. */
export const DEFAULT_PALETTE: Palette = {
  power: "#ff7a45",
  tether: "#e8c547",
  pulley: "#4fd1c5",
  bridle: "#6f7f9e",
  tube: "#c9d3e6",
  canopy: "#7f9cd9",
  point: "#9aa6bf",
  anchor: "#ff7a45",
  highlight: "#ff4fa3",
  compression: "#3987e5",
  unloaded: "#6b7080",
  tension: "#d9483b",
  aero: "#17a98c",
  drag: "#9a6ff0",
};

/** `palette` over `DEFAULT_PALETTE`. */
export function resolvePalette(palette?: Partial<Palette>): Palette {
  return { ...DEFAULT_PALETTE, ...palette };
}

export interface StructureProps {
  run: Run;
  frame: Frame;
  palette?: Partial<Palette>;
  pointSize?: number;
  /** The group whose points are drawn in the highlight color. */
  highlight?: PointGroup | null;
  onPick?: (pick: PointPick) => void;
  /** Flat `[r, g, b, ...]` for each segment's two ends, in place of its role's color. */
  segmentColors?: Float32Array;
}

const UP = new THREE.Vector3(0, 1, 0);

/** The width of an arrow's head as a share of its length. */
const HEAD_WIDTH = 0.6;

/** The matrix placing a unit shape along +y between `start` and `end`, `diameter` wide. */
function spanMatrix(start: THREE.Vector3, end: THREE.Vector3, diameter: number): THREE.Matrix4 {
  const axis = end.clone().sub(start);
  return new THREE.Matrix4().compose(
    start.clone().add(end).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize()),
    new THREE.Vector3(diameter, axis.length(), diameter),
  );
}

/**
 * One matrix per tube placing a unit cylinder, of unit diameter along +y, between
 * its two `ends` (as `tubeEnds` gives them) at the tube's `diameter`, in the
 * simulation frame. None where the tubes carry no `diameter`.
 */
export function tubeMatrices(run: Run, ends: Float32Array): THREE.Matrix4[] {
  const diameters = optionalColumnValues<number>(run.topology.tubes, "diameter");
  if (!diameters) return [];
  return diameters.map((diameter, i) =>
    spanMatrix(
      new THREE.Vector3().fromArray(ends, i * 6),
      new THREE.Vector3().fromArray(ends, i * 6 + 3),
      diameter,
    ),
  );
}

/**
 * For each arrow of `ends`, the matrices placing a unit cylinder as its shaft and a unit
 * cone as its head, which is `headLength` long or half the arrow where that is shorter.
 */
export function arrowMatrices(
  ends: Float32Array,
  shaftDiameter: number,
  headLength: number,
): { shafts: THREE.Matrix4[]; heads: THREE.Matrix4[] } {
  const shafts: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  for (let i = 0; i < ends.length; i += 6) {
    const start = new THREE.Vector3().fromArray(ends, i);
    const end = new THREE.Vector3().fromArray(ends, i + 3);
    const length = start.distanceTo(end);
    const head = Math.min(headLength, length / 2);
    const neck = start.clone().lerp(end, 1 - head / length);
    shafts.push(spanMatrix(start, neck, shaftDiameter));
    heads.push(spanMatrix(neck, end, head * HEAD_WIDTH));
  }
  return { shafts, heads };
}

/**
 * Flat `[r, g, b, ...]` for each segment's two ends, on the diverging scale of `palette`
 * from `-limit` through zero to `+limit` [N]: saturated beyond it, unloaded where unknown.
 */
export function forceColors(
  forces: ArrayLike<number>,
  limit: number,
  palette: Pick<Palette, "compression" | "unloaded" | "tension">,
): Float32Array {
  const [compression, unloaded, tension] = [
    palette.compression,
    palette.unloaded,
    palette.tension,
  ].map((hex) => new THREE.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace));
  const out = new Float32Array(forces.length * 6);
  const color = new THREE.Color();
  for (let i = 0; i < forces.length; i++) {
    const share = Number.isFinite(forces[i]) ? Math.min(Math.abs(forces[i]) / limit, 1) : 0;
    const pole = forces[i] < 0 ? compression : tension;
    color.setRGB(
      unloaded.r + (pole.r - unloaded.r) * share,
      unloaded.g + (pole.g - unloaded.g) * share,
      unloaded.b + (pole.b - unloaded.b) * share,
      THREE.SRGBColorSpace,
    );
    color.toArray(out, i * 6);
    color.toArray(out, i * 6 + 3);
  }
  return out;
}

/** Flat `[r, g, b, ...]` for each segment's two ends, in its role's color. */
function roleColors(
  roles: SegmentRole[],
  palette: Record<SegmentRole, string>,
): Float32Array {
  const out = new Float32Array(roles.length * 6);
  const color = new THREE.Color();
  roles.forEach((role, i) => {
    color.set(palette[role]).toArray(out, i * 6);
    color.toArray(out, i * 6 + 3);
  });
  return out;
}

function useBufferAttribute(values: Float32Array) {
  return useMemo(() => new THREE.BufferAttribute(values, 3), [values]);
}

/** One instance of the geometry and material in `children` per matrix. */
function Instances({ matrices, children }: { matrices: THREE.Matrix4[]; children: ReactNode }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    matrices.forEach((matrix, i) => mesh.current!.setMatrixAt(i, matrix));
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [matrices]);
  return (
    <instancedMesh
      key={matrices.length}
      ref={mesh}
      args={[undefined, undefined, matrices.length]}
    >
      {children}
    </instancedMesh>
  );
}

/** Tubes as cylinders at their diameter, or as lines where they carry none. */
function Tubes({ run, frame, color }: { run: Run; frame: Frame; color: string }) {
  const ends = useMemo(() => tubeEnds(run, frame), [run, frame]);
  const matrices = useMemo(() => tubeMatrices(run, ends), [run, ends]);
  const axes = useBufferAttribute(ends);

  if (matrices.length === 0) {
    return (
      <lineSegments>
        <bufferGeometry>
          <primitive attach="attributes-position" object={axes} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
    );
  }
  return (
    <Instances matrices={matrices}>
      <cylinderGeometry args={[0.5, 0.5, 1, 16]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </Instances>
  );
}

export interface ForceArrowsViewProps {
  /** Each arrow's start and end, as `arrowEnds` gives them. */
  ends: Float32Array;
  color: string;
  /** The scale of the run [m], which the arrows' thickness follows. */
  span: number;
}

/** Arrows between `ends`, already rotated into three.js axes. */
export function ForceArrowsView({ ends, color, span }: ForceArrowsViewProps) {
  const { shafts, heads } = useMemo(
    () => arrowMatrices(ends, span / 600, span / 100),
    [ends, span],
  );
  return (
    <group rotation={Z_UP_TO_Y_UP}>
      <Instances matrices={shafts}>
        <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
        <meshBasicMaterial color={color} />
      </Instances>
      <Instances matrices={heads}>
        <coneGeometry args={[0.5, 1, 12]} />
        <meshBasicMaterial color={color} />
      </Instances>
    </group>
  );
}

/**
 * The structure, already rotated into three.js axes: segments colored by role or
 * by `segmentColors`, tubes, the canopy faces, points, and a cone on each fixed point.
 * Render it inside your own `Canvas` when you want custom chrome.
 */
export function Structure({
  run,
  frame,
  palette,
  pointSize = 1.2,
  highlight,
  onPick,
  segmentColors,
}: StructureProps) {
  const raycaster = useThree((state) => state.raycaster);
  useEffect(() => {
    raycaster.params.Points.threshold = pointSize / 2;
  }, [raycaster, pointSize]);

  const colors = resolvePalette(palette);
  const { power, tether, pulley, bridle } = colors;

  const segments = useBufferAttribute(
    useMemo(() => segmentPositions(run, frame), [run, frame]),
  );
  const roles = useMemo(() => segmentRoles(run.topology), [run]);
  const byRole = useMemo(
    () => roleColors(roles, { power, tether, pulley, bridle }),
    [roles, power, tether, pulley, bridle],
  );
  const lineColors = useBufferAttribute(segmentColors ?? byRole);

  const points = useBufferAttribute(useMemo(() => pointPositions(frame), [frame]));
  const lit = useMemo(
    () => (highlight ? pointGroups(run, highlight.block).get(highlight.name) ?? [] : []),
    [run, highlight?.block, highlight?.name],
  );
  const litPoints = useBufferAttribute(
    useMemo(() => pointPositions(frame, lit), [frame, lit]),
  );

  const canopy = useBufferAttribute(
    useMemo(() => canopyPositions(run, frame), [run, frame]),
  );
  const anchors = useMemo(() => anchorPoints(run.topology), [run]);
  const anchorHeight = framing(frame).span / 40;

  function pickPoint(event: ThreeEvent<MouseEvent>) {
    if (!onPick || event.index === undefined) return;
    event.stopPropagation();
    onPick(pointPick(run, event.index));
  }

  return (
    <group rotation={Z_UP_TO_Y_UP}>
      <lineSegments>
        <bufferGeometry>
          <primitive attach="attributes-position" object={segments} />
          <primitive attach="attributes-color" object={lineColors} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      <Tubes run={run} frame={frame} color={colors.tube} />
      {canopy.count > 0 && (
        <mesh key={canopy.count}>
          <bufferGeometry>
            <primitive attach="attributes-position" object={canopy} />
          </bufferGeometry>
          <meshBasicMaterial
            color={colors.canopy}
            side={THREE.DoubleSide}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
      )}
      <points onClick={pickPoint}>
        <bufferGeometry>
          <primitive attach="attributes-position" object={points} />
        </bufferGeometry>
        <pointsMaterial color={colors.point} size={pointSize} sizeAttenuation />
      </points>
      <points key={litPoints.count} renderOrder={1}>
        <bufferGeometry>
          <primitive attach="attributes-position" object={litPoints} />
        </bufferGeometry>
        <pointsMaterial
          color={colors.highlight}
          size={pointSize * 2}
          sizeAttenuation
          depthTest={false}
        />
      </points>
      {anchors.map((index) => (
        <mesh
          key={index}
          position={[frame.x[index], frame.y[index], frame.z[index] + anchorHeight / 2]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <coneGeometry args={[anchorHeight / 2, anchorHeight, 24]} />
          <meshStandardMaterial color={colors.anchor} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Camera centre and scale for a pose, in three.js axes, so any run fills the
 * view without the caller knowing the geometry.
 */
export function framing(frame: Frame): { centre: THREE.Vector3; span: number } {
  const max = (v: Float32Array) => v.reduce((a, b) => Math.max(a, b), -Infinity);
  const min = (v: Float32Array) => v.reduce((a, b) => Math.min(a, b), Infinity);
  const centre = new THREE.Vector3(
    (min(frame.x) + max(frame.x)) / 2,
    (min(frame.z) + max(frame.z)) / 2,
    -(min(frame.y) + max(frame.y)) / 2,
  );
  const span = Math.max(
    max(frame.x) - min(frame.x),
    max(frame.y) - min(frame.y),
    max(frame.z) - min(frame.z),
    1,
  );
  return { centre, span };
}
