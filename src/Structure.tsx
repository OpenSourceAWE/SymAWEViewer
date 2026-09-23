import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  bodyPositions,
  pointGroups,
  segmentRoles,
  type PointGroupBlock,
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

/** A body's or a station's points, named by the block and row they come from. */
export interface PointGroup {
  block: PointGroupBlock;
  name: string;
}

/** A clicked point, with the body and the stations it belongs to. */
export interface Pick {
  point: string;
  groups: PointGroup[];
}

export interface StructureProps {
  run: Run;
  frame: Frame;
  palette?: Partial<Palette>;
  pointSize?: number;
  /** The group whose points are drawn in the highlight color. */
  highlight?: PointGroup | null;
  onPick?: (pick: Pick) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * One matrix per tube placing a unit cylinder, of unit diameter along +y, between
 * its two bodies at the tube's `diameter`, in the simulation frame.
 */
export function tubeMatrices(run: Run, frame: Frame): THREE.Matrix4[] {
  const { bodies, tubes } = run.topology;
  const placed = bodyPositions(run, frame);
  const row = new Map(columnValues<string>(bodies, "name").map((name, i) => [name, i]));
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

/** The point at `index` with the groups it belongs to, its body first. */
function pickOf(run: Run, index: number): Pick {
  const body = columnValues<string | null>(run.topology.points, "body")[index];
  const groups: PointGroup[] = body === null ? [] : [{ block: "bodies", name: body }];
  for (const [name, members] of pointGroups(run, "stations")) {
    if (members.includes(index)) groups.push({ block: "stations", name });
  }
  return { point: columnValues<string>(run.topology.points, "name")[index], groups };
}

/** Flat `[r, g, b, ...]` for `count` vertices, vertex `i` colored `colorOf(i)`. */
function vertexColors(count: number, colorOf: (i: number) => string): Float32Array {
  const out = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) color.set(colorOf(i)).toArray(out, i * 3);
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

  const colors = { ...DEFAULT_PALETTE, ...palette };
  const colorsKey = Object.values(colors).join();

  const segments = useBufferAttribute(
    useMemo(() => segmentPositions(run, frame), [run, frame]),
  );
  const segmentColors = useBufferAttribute(
    useMemo(() => {
      const roles = segmentRoles(run.topology);
      return vertexColors(roles.length * 2, (i) => colors[roles[i >> 1]]);
    }, [run, colorsKey]),
  );

  const points = useBufferAttribute(useMemo(() => pointPositions(frame), [frame]));
  const pointColors = useBufferAttribute(
    useMemo(() => {
      const lit = new Set(
        highlight ? pointGroups(run, highlight.block).get(highlight.name) : [],
      );
      return vertexColors(frame.x.length, (i) =>
        lit.has(i) ? colors.highlight : colors.point,
      );
    }, [run, frame.x.length, highlight?.block, highlight?.name, colorsKey]),
  );

  const anchors = useMemo(
    () =>
      columnValues<string>(run.topology.winches, "winch_point").map((name) =>
        pointIndexOf(run, name, "winch"),
      ),
    [run],
  );
  const anchorHeight = framing(frame).span / 40;

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
      <points
        onClick={(event) => {
          if (!onPick || event.index === undefined) return;
          event.stopPropagation();
          onPick(pickOf(run, event.index));
        }}
      >
        <bufferGeometry>
          <primitive attach="attributes-position" object={points} />
          <primitive attach="attributes-color" object={pointColors} />
        </bufferGeometry>
        <pointsMaterial vertexColors size={pointSize} sizeAttenuation />
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
