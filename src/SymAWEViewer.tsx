import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { framing, resolvePalette, Structure, type Palette } from "./Structure";
import { plainButton, plainSelect, RunPanels, type PanelsMode } from "./TimePanel";
import { FlightReadout } from "./Readout";
import {
  CameraRig,
  Ground,
  pathPoint,
  resolveScene,
  sceneDepth,
  Trail,
  type SceneTheme,
} from "./Scene";
import {
  prefersReducedMotion,
  SPEEDS,
  trailStart,
  usePlayback,
  useSpaceToggle,
} from "./playback";
import { runQuantities, runTimes } from "./quantities";
import {
  anchorPoints,
  kitePath,
  nextGroup,
  segmentRoles,
  type PointGroup,
  type PointPick,
  type SegmentRole,
} from "./parts";
import { decodeRun, loadRun, type Run } from "./topology";

export interface SymAWEViewerProps {
  /** URL of an exported `.arrow` run. Ignored when `data` is given. */
  src?: string;
  /** Already-fetched run bytes, for hosts that authenticate the request. */
  data?: ArrayBuffer | Uint8Array;
  /** Passed to `fetch`, e.g. `{ credentials: "include" }`. */
  fetchOptions?: RequestInit;
  /** Moves the time cursor to this index into the run's frames. */
  frame?: number;
  /** Called with the frame the time cursor moved to, by playback, the scrubber or a panel. */
  onFrameChange?: (frame: number) => void;
  /** The colour behind the scene, and of its fog. */
  background?: string;
  palette?: Partial<Palette>;
  /** Ground, grid, fog, trail, lighting and text of the scene. */
  theme?: Partial<SceneTheme>;
  /** Whether a run's 2D panels show, start collapsed, or are left out. */
  panels?: PanelsMode;
  /** Name, counts, connectivity hash and a legend, drawn over the top-left corner. */
  showOverlay?: boolean;
  className?: string;
  style?: CSSProperties;
  onLoad?: (run: Run) => void;
  onError?: (error: Error) => void;
  /** Extra chrome drawn above the canvas. */
  children?: ReactNode;
}

const fill: CSSProperties = { position: "relative", width: "100%", height: "100%" };

const column: CSSProperties = { ...fill, display: "flex", flexDirection: "column" };

const sceneStyle: CSSProperties = { position: "relative", flex: "1 1 0", minHeight: 0 };

const centred: CSSProperties = {
  ...fill,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  top: "1.5rem",
  left: "1.5rem",
  pointerEvents: "none",
  font: "12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace",
};

const ROLE_LABELS: Record<SegmentRole, string> = {
  power: "tether, reeled by a winch",
  tether: "tether",
  pulley: "bridle over a pulley",
  bridle: "fixed bridle",
};

interface SwatchProps {
  color: string;
  glyph?: string;
  label: string;
}

function Swatch({ color, glyph = "━━", label }: SwatchProps) {
  return (
    <p style={{ margin: 0 }}>
      <span style={{ color }}>{glyph}</span> {label}
    </p>
  );
}

/** Name, counts, connectivity hash and a legend of `run`, and what is highlighted. */
function RunOverlay({ run, palette, ink, muted, highlight }: {
  run: Run;
  palette?: Partial<Palette>;
  ink: string;
  muted: string;
  highlight: PointGroup | null;
}) {
  const meta = run.topology.metadata;
  const colors = resolvePalette(palette);
  const roles = new Set(segmentRoles(run.topology));
  const tubeCount = run.topology.tubes.data.length;
  const faceCount = run.topology.canopy_faces.data.length;
  const anchorCount = anchorPoints(run.topology).length;
  const anchorLabel =
    anchorCount === 1
      ? "1 fixed point, the ground anchor"
      : `${anchorCount} fixed points, the ground anchors`;
  return (
    <div style={{ ...overlayStyle, color: muted }}>
      <p style={{ color: ink, margin: 0 }}>{meta.name}</p>
      <p style={{ margin: 0 }}>{meta.note}</p>
      <p style={{ margin: "0.6rem 0 0" }}>
        {run.topology.points.data.length} points
        · {run.topology.segments.data.length} segments
        · {run.topology.tethers.data.length} line runs
      </p>
      <p style={{ margin: 0 }}>
        {run.frames.length} frame{run.frames.length === 1 ? "" : "s"} · sha{" "}
        {meta.connectivity_sha.slice(0, 12)}
      </p>
      <div style={{ margin: "0.6rem 0 0" }}>
        {(Object.keys(ROLE_LABELS) as SegmentRole[])
          .filter((role) => roles.has(role))
          .map((role) => (
            <Swatch key={role} color={colors[role]} label={ROLE_LABELS[role]} />
          ))}
        {tubeCount > 0 && (
          <Swatch color={colors.tube} label={`${tubeCount} tubes between bodies`} />
        )}
        {faceCount > 0 && (
          <Swatch color={colors.canopy} glyph="▬" label={`${faceCount} canopy faces`} />
        )}
        {anchorCount > 0 && <Swatch color={colors.anchor} glyph="▲" label={anchorLabel} />}
      </div>
      <p style={{ margin: "0.6rem 0 0", color: colors.highlight }}>
        {highlight
          ? `${highlight.block === "bodies" ? "body" : "station"} ${highlight.name}`
          : "click a point to highlight its body or station"}
      </p>
    </div>
  );
}

/** Play or pause, the playback speed, and whether the camera follows the kite. */
function Transport({ playing, onPlaying, speed, onSpeed, follow, onFollow, ink }: {
  playing: boolean;
  onPlaying: (playing: boolean) => void;
  speed: number;
  onSpeed: (speed: number) => void;
  /** Whether the camera follows the kite, or undefined for a run with no kite. */
  follow?: boolean;
  onFollow: (follow: boolean) => void;
  ink: string;
}) {
  return (
    <>
      <button
        type="button"
        aria-label={playing ? "pause" : "play"}
        onClick={() => onPlaying(!playing)}
        style={{ ...plainButton, color: ink, width: "1.5em" }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <select
        aria-label="speed"
        value={speed}
        onChange={(event) => onSpeed(Number(event.target.value))}
        style={plainSelect}
      >
        {SPEEDS.map((choice) => (
          <option key={choice} value={choice}>
            {choice}×
          </option>
        ))}
      </select>
      {follow !== undefined && (
        <button
          type="button"
          aria-pressed={follow}
          onClick={() => onFollow(!follow)}
          style={{ ...plainButton, color: follow ? ink : undefined }}
        >
          {follow ? "◉" : "○"} follow kite
        </button>
      )}
    </>
  );
}

/** Whether the primary pointer is a mouse or pen, which may orbit the camera. */
function finePointer(): boolean {
  return typeof matchMedia !== "function" || matchMedia("(pointer: fine)").matches;
}

type LoadedRunProps = Pick<
  SymAWEViewerProps,
  "frame" | "onFrameChange" | "palette" | "theme" | "panels" | "showOverlay" | "children"
> & { run: Run; background: string };

/** The scene, overlays and panels of a loaded `run`, playing from `frame` on load. */
function LoadedRun({
  run,
  frame = 0,
  onFrameChange,
  background,
  palette,
  theme,
  panels = "open",
  showOverlay = true,
  children,
}: LoadedRunProps) {
  const scene = resolveScene(theme);
  const times = useMemo(() => runTimes(run), [run]);
  const quantities = useMemo(() => runQuantities(run), [run]);
  const path = useMemo(() => kitePath(run), [run]);
  const { centre, span } = useMemo(() => framing(run.frames[0]), [run]);
  const lastFrame = run.frames.length - 1;

  const [highlight, setHighlight] = useState<PointGroup | null>(null);
  const [cursor, setCursor] = useState(frame);
  const [cleared, setCleared] = useState(frame);
  const [playing, setPlaying] = useState(() => lastFrame > 0 && !prefersReducedMotion());
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(false);
  const [orbit] = useState(finePointer);
  useEffect(() => setCursor(frame), [frame]);

  const current = Math.min(cursor, lastFrame);
  const moveTo = (next: number, clear: boolean) => {
    setCursor(next);
    if (clear) setCleared(next);
    onFrameChange?.(next);
  };
  usePlayback({ times, frame: current, playing, speed, onFrame: moveTo });
  useSpaceToggle(() => setPlaying((was) => !was && lastFrame > 0));

  const kite = path.length > 0;
  const followed = useMemo(
    () => (follow && kite ? pathPoint(path, current) : null),
    [follow, kite, path, current],
  );

  return (
    <>
      <div style={sceneStyle}>
        <Canvas
          camera={{
            position: [centre.x + span, centre.y + span * 0.4, centre.z + span],
            fov: 45,
            near: 0.1,
            far: sceneDepth(scene, span),
          }}
          style={orbit ? undefined : { touchAction: "pan-y" }}
          onPointerMissed={() => setHighlight(null)}
        >
          <color attach="background" args={[background]} />
          {scene.fog && <fog attach="fog" args={[background, ...scene.fog]} />}
          <ambientLight intensity={0.9} />
          <directionalLight position={[1, 2, 1]} intensity={1.5} />
          <Structure
            run={run}
            frame={run.frames[current]}
            palette={palette}
            highlight={highlight}
            unlit={scene.unlit}
            onPick={(pick: PointPick) => setHighlight((group) => nextGroup(pick, group))}
          />
          {kite && (
            <Trail
              path={path}
              from={trailStart(times, cleared, current)}
              to={current}
              color={scene.trail}
            />
          )}
          <Ground theme={scene} span={span} />
          <CameraRig centre={centre} follow={followed} orbit={orbit} />
        </Canvas>
        {showOverlay && (
          <RunOverlay
            run={run}
            palette={palette}
            ink={scene.ink}
            muted={scene.muted}
            highlight={highlight}
          />
        )}
        {lastFrame > 0 && (
          <FlightReadout
            quantities={quantities}
            times={times}
            timed={Boolean(run.table.getChild("time"))}
            frame={current}
            ink={scene.ink}
            muted={scene.muted}
          />
        )}
        {children}
      </div>
      {lastFrame > 0 && (
        <RunPanels
          run={run}
          frame={current}
          onSeek={(next) => moveTo(next, true)}
          panels={panels}
          theme={scene}
          controls={
            <Transport
              playing={playing}
              onPlaying={setPlaying}
              speed={speed}
              onSpeed={setSpeed}
              follow={kite ? follow : undefined}
              onFollow={setFollow}
              ink={scene.ink}
            />
          }
        />
      )}
    </>
  );
}

/**
 * Drop-in run viewer: give it a `src` or `data` and size its parent. It brings
 * its own canvas, camera framing and styling, and depends on no CSS framework.
 * A run of more than one frame plays on load, looping at real time.
 */
export function SymAWEViewer({
  src,
  data,
  fetchOptions,
  background = "#07070b",
  theme,
  className,
  style,
  onLoad,
  onError,
  ...view
}: SymAWEViewerProps) {
  const [loaded, setLoaded] = useState<{ run: Run; id: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ink, muted } = resolveScene(theme);

  const latest = useRef({ fetchOptions, onLoad, onError });
  latest.current = { fetchOptions, onLoad, onError };

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current && box.current.clientHeight === 0) {
      console.warn(
        "SymAWEViewer rendered into a zero-height box. It fills its parent, " +
          "so give the parent a height — a className on the viewer itself " +
          "cannot override its inline height.",
      );
    }
  });

  useEffect(() => {
    let live = true;
    const fail = (err: unknown) => {
      if (!live) return;
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped.message);
      latest.current.onError?.(wrapped);
    };
    const succeed = (run: Run) => {
      if (!live) return;
      setLoaded((last) => ({ run, id: (last?.id ?? 0) + 1 }));
      latest.current.onLoad?.(run);
    };

    setLoaded(null);
    setError(null);

    if (data) {
      try {
        succeed(decodeRun(data));
      } catch (err) {
        fail(err);
      }
    } else if (src) {
      loadRun(src, latest.current.fetchOptions).then(succeed, fail);
    } else {
      fail(new Error("SymAWEViewer needs either a src or data prop"));
    }

    return () => {
      live = false;
    };
  }, [src, data]);

  if (error) {
    return (
      <div ref={box} className={className} style={{ ...centred, ...style }}>
        <div style={{ maxWidth: "36rem", padding: "2rem" }}>
          <p style={{ color: "#e0a44a", margin: 0 }}>failed to load run</p>
          <p style={{ color: ink, marginTop: "0.75rem" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div ref={box} className={className} style={{ ...centred, ...style }}>
        <p style={{ color: muted, margin: 0 }}>loading…</p>
      </div>
    );
  }

  return (
    <div ref={box} className={className} style={{ ...column, background, ...style }}>
      <LoadedRun
        key={loaded.id}
        run={loaded.run}
        background={background}
        theme={theme}
        {...view}
      />
    </div>
  );
}
