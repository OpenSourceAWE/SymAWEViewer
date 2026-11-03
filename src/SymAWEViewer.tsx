import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { ForceControls, NO_FORCES_SHOWN, type ForcesShown } from "./ForceControls";
import {
  ForceArrowsView,
  forceColors,
  framing,
  resolvePalette,
  Structure,
  type Palette,
} from "./Structure";
import { RunPanels } from "./TimePanel";
import {
  anchorPoints,
  nextGroup,
  segmentRoles,
  type PointGroup,
  type PointPick,
  type SegmentRole,
} from "./parts";
import { arrowEnds, runForces } from "./quantities";
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
  /** Called with the frame the time cursor moved to, by the scrubber or a panel. */
  onFrameChange?: (frame: number) => void;
  background?: string;
  palette?: Partial<Palette>;
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
  color: "#9aa0ad",
  font: "12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** The longest force arrow of a run, as a share of the run's scale. */
const LONGEST_ARROW_SHARE = 0.06;

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

/**
 * Drop-in run viewer: give it a `src` or `data` and size its parent. It brings
 * its own canvas, camera framing and styling, and depends on no CSS framework.
 */
export function SymAWEViewer({
  src,
  data,
  fetchOptions,
  frame = 0,
  onFrameChange,
  background = "#07070b",
  palette,
  showOverlay = true,
  className,
  style,
  onLoad,
  onError,
  children,
}: SymAWEViewerProps) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<PointGroup | null>(null);
  const [cursor, setCursor] = useState(frame);
  useEffect(() => setCursor(frame), [frame]);
  const [shownForces, setShownForces] = useState<ForcesShown>(NO_FORCES_SHOWN);
  const scene = useMemo(
    () => run && { forces: runForces(run), ...framing(run.frames[0]) },
    [run],
  );

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
    const succeed = (loaded: Run) => {
      if (!live) return;
      setRun(loaded);
      latest.current.onLoad?.(loaded);
    };

    setRun(null);
    setError(null);
    setHighlight(null);
    setCursor(frame);

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
          <p style={{ color: "#c8ccd4", marginTop: "0.75rem" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!run || !scene) {
    return (
      <div ref={box} className={className} style={{ ...centred, ...style }}>
        <p style={{ color: "#9aa0ad", margin: 0 }}>loading…</p>
      </div>
    );
  }

  const lastFrame = run.frames.length - 1;
  const current = Math.min(cursor, lastFrame);
  const { forces, centre, span } = scene;
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
  const pickNext = (pick: PointPick) =>
    setHighlight((group) => nextGroup(pick, group));
  const seek = (next: number) => {
    setCursor(next);
    onFrameChange?.(next);
  };
  const spring = shownForces.spring ? forces.spring : undefined;
  const newtonLength =
    (span * LONGEST_ARROW_SHARE) / Math.max(...forces.arrows.map(({ largest }) => largest));

  return (
    <div ref={box} className={className} style={{ ...column, background, ...style }}>
      <div style={sceneStyle}>
        <Canvas
          camera={{
            position: [centre.x + span, centre.y + span * 0.4, centre.z + span],
            fov: 45,
            near: 0.1,
            far: span * 40,
          }}
          onPointerMissed={() => setHighlight(null)}
        >
          <color attach="background" args={[background]} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[1, 2, 1]} intensity={1.5} />
          <Structure
            run={run}
            frame={run.frames[current]}
            palette={palette}
            highlight={highlight}
            onPick={pickNext}
            segmentColors={spring && forceColors(spring.rows[current], spring.limit, colors)}
          />
          {forces.arrows
            .filter(({ key }) => shownForces[key])
            .map((arrows) => (
              <ForceArrowsView
                key={arrows.key}
                ends={arrowEnds(arrows, current, newtonLength)}
                color={colors[arrows.key]}
                span={span}
              />
            ))}
          <Grid
            args={[span * 4, span * 4]}
            cellSize={10}
            sectionSize={50}
            cellColor="#1b2030"
            sectionColor="#2b3348"
            fadeDistance={span * 6}
            infiniteGrid
          />
          <OrbitControls target={centre} makeDefault />
        </Canvas>

        {showOverlay && (
          <div style={overlayStyle}>
            <p style={{ color: "#d7dae1", margin: 0 }}>{meta.name}</p>
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
                .filter((role) => roles.has(role) && !spring)
                .map((role) => (
                  <Swatch key={role} color={colors[role]} label={ROLE_LABELS[role]} />
                ))}
              {tubeCount > 0 && (
                <Swatch color={colors.tube} label={`${tubeCount} tubes between bodies`} />
              )}
              {faceCount > 0 && (
                <Swatch
                  color={colors.canopy}
                  glyph="▬"
                  label={`${faceCount} canopy faces`}
                />
              )}
              {anchorCount > 0 && (
                <Swatch
                  color={colors.anchor}
                  glyph="▲"
                  label={anchorLabel}
                />
              )}
            </div>
            <p style={{ margin: "0.6rem 0 0", color: colors.highlight }}>
              {highlight
                ? `${highlight.block === "bodies" ? "body" : "station"} ${highlight.name}`
                : "click a point to highlight its body or station"}
            </p>
          </div>
        )}
        <ForceControls
          forces={forces}
          shown={shownForces}
          palette={colors}
          onChange={setShownForces}
        />
        {children}
      </div>
      {lastFrame > 0 && <RunPanels run={run} frame={current} onSeek={seek} />}
    </div>
  );
}
