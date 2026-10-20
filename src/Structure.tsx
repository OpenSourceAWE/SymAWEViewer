import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import {
  canopyPositions,
  pointPositions,
  segmentPositions,
  tubeAxes,
  type Frame,
  type Run,
  type TubeAxis,
} from "./topology";

/** The simulation frame is z-up; three.js is y-up. */
export const Z_UP_TO_Y_UP: [number, number, number] = [-Math.PI / 2, 0, 0];

export interface StructureProps {
  run: Run;
  frame: Frame;
  segmentColor?: string;
  pointColor?: string;
  canopyColor?: string;
  tubeColor?: string;
  /** Width of the segment lines [px]. */
  lineWidth?: number;
  pointSize?: number;
}

function useBufferAttribute(values: Float32Array) {
  return useMemo(() => new THREE.BufferAttribute(values, 3), [values]);
}

/** A flat `[x, y, z, ...]` buffer as the list of points drei's `Line` takes. */
function toTriples(values: Float32Array): [number, number, number][] {
  const triples: [number, number, number][] = [];
  for (let i = 0; i < values.length; i += 3) {
    triples.push([values[i], values[i + 1], values[i + 2]]);
  }
  return triples;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** A cylinder along `axis`, as three.js builds one along its own y axis. */
function Tube({ axis, color }: { axis: TubeAxis; color: string }) {
  const start = new THREE.Vector3(...axis.start);
  const along = new THREE.Vector3(...axis.end).sub(start);
  const centre = start.addScaledVector(along, 0.5);
  const turn = new THREE.Quaternion().setFromUnitVectors(
    Y_AXIS,
    along.clone().normalize(),
  );
  const radius = axis.diameter / 2;
  return (
    <mesh position={centre} quaternion={turn}>
      <cylinderGeometry args={[radius, radius, along.length(), 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/**
 * The structure itself, as lines, points, tubes and a translucent canopy,
 * already rotated into three.js axes. Render it inside your own `Canvas` when
 * you want custom chrome.
 */
export function Structure({
  run,
  frame,
  segmentColor = "#c4d0e6",
  pointColor = "#ffb454",
  canopyColor = "#6f93d6",
  tubeColor = "#e9edf5",
  lineWidth = 1.5,
  pointSize = 1.2,
}: StructureProps) {
  const segments = useMemo(
    () => toTriples(segmentPositions(run, frame)),
    [run, frame],
  );
  const canopy = useBufferAttribute(
    useMemo(() => canopyPositions(run, frame), [run, frame]),
  );
  const points = useBufferAttribute(
    useMemo(() => pointPositions(run, frame), [run, frame]),
  );
  const tubes = useMemo(() => tubeAxes(run, frame), [run, frame]);

  return (
    <group rotation={Z_UP_TO_Y_UP}>
      {segments.length > 0 && (
        <Line
          points={segments}
          segments
          color={segmentColor}
          lineWidth={lineWidth}
        />
      )}
      <mesh>
        <bufferGeometry>
          <primitive attach="attributes-position" object={canopy} />
        </bufferGeometry>
        <meshBasicMaterial
          color={canopyColor}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {tubes.map((axis, i) => (
        <Tube key={i} axis={axis} color={tubeColor} />
      ))}
      <points>
        <bufferGeometry>
          <primitive attach="attributes-position" object={points} />
        </bufferGeometry>
        <pointsMaterial color={pointColor} size={pointSize} sizeAttenuation />
      </points>
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
