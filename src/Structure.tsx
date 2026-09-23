import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  bodyPositions,
  bodyRows,
  pointGroups,
  pointPick,
  segmentRoles,
  type PointGroup,
  type PointPick,
  type SegmentRole,
} from "./parts";
import {
  columnValues,
  pointIndexOf,
  pointPositions,
  segmentPositions,
  type Frame,
  type Run,
} from "./topology";
import type { NamePair } from "./generated/structure";

/** The simulation frame is z-up; three.js is y-up. */
export const Z_UP_TO_Y_UP: [number, number, number] = [-Math.PI / 2, 0, 0];

/** Colors of each part the structure is drawn in. */
export interface Palette extends Record<SegmentRole, string> {
  tube: string;
  point: string;
  anchor: string;
  highlight: string;
}

/** The colors `Structure` draws in where its `palette` names none. */
export const DEFAULT_PALETTE: Palette = {
  power: "#ff7a45",
  tether: "#e8c547",
  pulley: "#4fd1c5",
  bridle: "#6f7f9e",
  tube: "#c9d3e6",
  point: "#9aa6bf",
  anchor: "#ff7a45",
  highlight: "#ff4fa3",
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
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * One matrix per tube placing a unit cylinder, of unit diameter along +y, between
 * its two bodies at the tube's `diameter`, in the simulation frame.
 */
export function tubeMatrices(run: Run, frame: Frame): THREE.Matrix4[] {
  const { tubes } = run.topology;
  const placed = bodyPositions(run, frame);
  const row = bodyRows(run);
  const diameters = columnValues<number>(tubes, "diameter");
  return columnValues<NamePair>(tubes, "bodies").map(([a, b], i) => {
    const start = new THREE.Vector3().fromArray(placed, row.get(a)! * 3);
    const end = new THREE.Vector3().fromArray(placed, row.get(b)! * 3);
    const axis = end.clone().sub(start);
    return new THREE.Matrix4().compose(
      start.add(end).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize()),
      new THREE.Vector3(diameters[i], axis.length(), diameters[i]),
    );
  });
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

function Tubes({ run, frame, color }: { run: Run; frame: Frame; color: string }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const matrices = useMemo(() => tubeMatrices(run, frame), [run, frame]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    matrices.forEach((matrix, i) => mesh.current!.setMatrixAt(i, matrix));
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [matrices]);

  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      key={matrices.length}
      ref={mesh}
      args={[undefined, undefined, matrices.length]}
    >
      <cylinderGeometry args={[0.5, 0.5, 1, 16]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </instancedMesh>
  );
}

/**
 * The structure, already rotated into three.js axes: segments colored by role,
 * tubes as cylinders at their diameter, points, and a cone on each winch point.
 * Render it inside your own `Canvas` when you want custom chrome.
 */
export function Structure({
  run,
  frame,
  palette,
  pointSize = 1.2,
  highlight,
  onPick,
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
  const segmentColors = useBufferAttribute(
    useMemo(
      () => roleColors(roles, { power, tether, pulley, bridle }),
      [roles, power, tether, pulley, bridle],
    ),
  );

  const points = useBufferAttribute(useMemo(() => pointPositions(frame), [frame]));
  const lit = useMemo(
    () => (highlight ? pointGroups(run, highlight.block).get(highlight.name) ?? [] : []),
    [run, highlight?.block, highlight?.name],
  );
  const litPoints = useBufferAttribute(
    useMemo(() => pointPositions(frame, lit), [frame, lit]),
  );

  const anchors = useMemo(
    () =>
      columnValues<string>(run.topology.winches, "winch_point").map((name) =>
        pointIndexOf(run, name, "winch"),
      ),
    [run],
  );
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
          <primitive attach="attributes-color" object={segmentColors} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      <Tubes run={run} frame={frame} color={colors.tube} />
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
