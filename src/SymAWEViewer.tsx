import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { DEFAULT_PALETTE, framing, Structure, type Palette, type Pick } from "./Structure";
import { segmentRoles, type PointGroup, type SegmentRole } from "./parts";
import { decodeRun, loadRun, type Run } from "./topology";

export interface SymAWEViewerProps {
  /** URL of an exported `.arrow` run. Ignored when `data` is given. */
  src?: string;
  /** Already-fetched run bytes, for hosts that authenticate the request. */
  data?: ArrayBuffer | Uint8Array;
  /** Passed to `fetch`, e.g. `{ credentials: "include" }`. */
  fetchOptions?: RequestInit;
  /** Index into the run's frames. */
  frame?: number;
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

const ROLE_LABELS: Record<SegmentRole, string> = {
  power: "tether, reeled by a winch",
  tether: "tether",
  pulley: "bridle over a pulley",
  bridle: "fixed bridle",
};

/** The group after `current` among those of `pick`: its body, then each station. */
function nextGroup(pick: Pick, current: PointGroup | null): PointGroup | null {
  const at = pick.groups.findIndex(
    (group) => group.block === current?.block && group.name === current?.name,
  );
  return pick.groups[(at + 1) % pick.groups.length] ?? null;
}

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

  if (!run) {
    return (
      <div ref={box} className={className} style={{ ...centred, ...style }}>
        <p style={{ color: "#9aa0ad", margin: 0 }}>loading…</p>
      </div>
    );
  }

  const pose = run.frames[Math.min(frame, run.frames.length - 1)];
  const { centre, span } = framing(pose);
  const meta = run.topology.metadata;
  const colors = { ...DEFAULT_PALETTE, ...palette };
  const roles = new Set(segmentRoles(run.topology));

  return (
    <div ref={box} className={className} style={{ ...fill, ...style }}>
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
          frame={pose}
          palette={palette}
          highlight={highlight}
          onPick={(pick) => setHighlight((current) => nextGroup(pick, current))}
        />
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
            {run.topology.tubes.data.length > 0 &&
              ` · ${run.topology.tubes.data.length} tubes`}
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
            {run.topology.tubes.data.length > 0 && (
              <Swatch color={colors.tube} label="tube between bodies" />
            )}
            {run.topology.winches.data.length > 0 && (
              <Swatch color={colors.anchor} glyph="▲" label="winch, the ground anchor" />
            )}
          </div>
          <p style={{ margin: "0.6rem 0 0", color: colors.highlight }}>
            {highlight
              ? `${highlight.block === "bodies" ? "body" : "station"} ${highlight.name}`
              : "click a point to highlight its body or station"}
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
