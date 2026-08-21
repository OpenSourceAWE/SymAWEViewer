import { useMemo } from "react";
import * as THREE from "three";
import {
  pointPositions,
  segmentPositions,
  type Frame,
  type Run,
} from "./topology";

/** The simulation frame is z-up; three.js is y-up. */
export const Z_UP_TO_Y_UP: [number, number, number] = [-Math.PI / 2, 0, 0];

export interface StructureProps {
  run: Run;
  frame: Frame;
  segmentColor?: string;
  pointColor?: string;
  pointSize?: number;
}

function useBufferAttribute(values: Float32Array) {
  return useMemo(() => new THREE.BufferAttribute(values, 3), [values]);
}

/**
 * The structure itself, as lines plus points, already rotated into three.js
 * axes. Render it inside your own `Canvas` when you want custom chrome.
 */
export function Structure({
  run,
  frame,
  segmentColor = "#8fa4c8",
  pointColor = "#ffb454",
  pointSize = 1.2,
}: StructureProps) {
  const segments = useBufferAttribute(
    useMemo(() => segmentPositions(run, frame), [run, frame]),
  );
  const points = useBufferAttribute(
    useMemo(() => pointPositions(frame), [frame]),
  );

  return (
    <group rotation={Z_UP_TO_Y_UP}>
      <lineSegments>
        <bufferGeometry>
          <primitive attach="attributes-position" object={segments} />
        </bufferGeometry>
        <lineBasicMaterial color={segmentColor} transparent opacity={0.75} />
      </lineSegments>
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
