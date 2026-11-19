import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Z_UP_TO_Y_UP } from "./Structure";

/** The colours and lighting of the scene around the structure. */
export interface SceneTheme {
  /** The ground plane at zero height, or null for none. */
  ground: string | null;
  gridCell: string;
  gridSection: string;
  /** Distances [m] from the camera where fog in the background colour starts and is whole. */
  fog: [number, number] | null;
  /** The kite's trail. */
  trail: string;
  /** Draw tubes and anchors flat in their colour, without lights. */
  unlit: boolean;
  /** Text: values, labels and controls. */
  ink: string;
  /** Secondary text, axes and hints. */
  muted: string;
}

/** The scene the viewer draws where its `theme` names nothing else. */
export const DEFAULT_SCENE: SceneTheme = {
  ground: null,
  gridCell: "#1b2030",
  gridSection: "#2b3348",
  fog: null,
  trail: "#ff7a45",
  unlit: false,
  ink: "#d7dae1",
  muted: "#9aa0ad",
};

/** `theme` over `DEFAULT_SCENE`. */
export function resolveScene(theme?: Partial<SceneTheme>): SceneTheme {
  return { ...DEFAULT_SCENE, ...theme };
}

/** The point at `frame` of a flat `[x, y, z, ...]` simulation-frame path, in three.js axes. */
export function pathPoint(path: Float32Array, frame: number): THREE.Vector3 {
  return new THREE.Vector3(path[frame * 3], path[frame * 3 + 2], -path[frame * 3 + 1]);
}

/** How far the scene reaches from the camera [m], for a system of size `span` [m]. */
export function sceneDepth(theme: SceneTheme, span: number): number {
  return Math.max(span * 40, (theme.fog?.[1] ?? 0) * 2);
}

/** Ground plane and grid at zero height, `span` the size of the system [m]. */
export function Ground({ theme, span }: { theme: SceneTheme; span: number }) {
  const size = sceneDepth(theme, span);
  return (
    <>
      {theme.ground && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -span * 1e-3, 0]}>
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial color={theme.ground} />
        </mesh>
      )}
      <Grid
        args={[span * 4, span * 4]}
        cellSize={10}
        sectionSize={50}
        cellColor={theme.gridCell}
        sectionColor={theme.gridSection}
        fadeDistance={theme.fog?.[1] ?? span * 6}
        infiniteGrid
      />
    </>
  );
}

/** The kite's path from frame `from` to frame `to`, of a flat path in the simulation frame. */
export function Trail({ path, from, to, color }: {
  path: Float32Array;
  from: number;
  to: number;
  color: string;
}) {
  const points = useMemo(() => Array.from(path.subarray(from * 3, (to + 1) * 3)), [path, from, to]);
  if (to - from < 1) return null;
  return (
    <group rotation={Z_UP_TO_Y_UP}>
      <Line points={points} color={color} lineWidth={2} />
    </group>
  );
}

/**
 * Orbit controls round `centre`, where `orbit` allows them, and, given `follow`, the
 * camera carried along with the kite at that point so it stays in view at the same
 * offset while the user orbits round it.
 */
export function CameraRig({ centre, follow, orbit }: {
  centre: THREE.Vector3;
  follow: THREE.Vector3 | null;
  orbit: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3 } | null;
  const target = useRef(centre.clone());

  useEffect(() => {
    const aim = controls?.target ?? target.current;
    if (follow) {
      camera.position.add(follow.clone().sub(aim));
      aim.copy(follow);
    }
    camera.lookAt(aim);
  }, [follow?.x, follow?.y, follow?.z, camera, controls]);

  return orbit ? <OrbitControls target={centre} makeDefault /> : null;
}
