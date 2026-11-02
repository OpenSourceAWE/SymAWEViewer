import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  defaultPanels,
  nearestFrame,
  runQuantities,
  runTimes,
  type Quantity,
} from "./quantities";
import type { Run } from "./topology";

const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const INK = "#d7dae1";
const MUTED = "#9aa0ad";
const GRID = "#1b2030";
const CURSOR = "#f2f3f5";

const seriesColor = (line: number) => SERIES_COLORS[line % SERIES_COLORS.length];

const PLOT_HEIGHT = 96;
const MARGIN = { left: 44, right: 8, top: 6, bottom: 18 };
const DEFAULT_WIDTH = 400;

const monospace = "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace";

const stripStyle: CSSProperties = {
  flex: "0 1 auto",
  maxHeight: "45%",
  overflowY: "auto",
  padding: "0.5rem 0.75rem",
  color: MUTED,
  font: monospace,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: "0.5rem 0.75rem",
};

const removeStyle: CSSProperties = {
  background: "none",
  border: 0,
  color: MUTED,
  cursor: "pointer",
  font: "inherit",
};

const barStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "0.75rem" };

/** Round axis ticks inside `min..max`, at most about `count + 1` of them. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const rough = (max - min) / count || 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find((factor) => factor * magnitude >= rough)! * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step); tick * step <= max + step * 1e-9; tick++) {
    ticks.push(Number((tick * step).toPrecision(12)));
  }
  return ticks;
}

/**
 * SVG path of `values` over `times` through the scales `x` and `y`: a gap at a value
 * that is not finite and, for a `periodic` angle, where it wraps.
 */
export function seriesPath(
  values: Float64Array,
  times: Float64Array,
  x: (time: number) => number,
  y: (value: number) => number,
  periodic: boolean,
): string {
  let path = "";
  let joined = false;
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) {
      joined = false;
      return;
    }
    const wrapped = periodic && i > 0 && Math.abs(value - values[i - 1]) > 180;
    path += `${joined && !wrapped ? "L" : "M"}${x(times[i]).toFixed(1)} ${y(value).toFixed(1)}`;
    joined = true;
  });
  return path;
}

/** The time under pixel `px` of a panel `width` wide, clamped to `start..end`. */
export function timeAtX(px: number, width: number, start: number, end: number): number {
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const fraction = Math.max(0, Math.min(1, (px - MARGIN.left) / plotWidth));
  return start + fraction * (end - start);
}

/** The finite range of `quantities`, widened where they are flat. */
function valueRange(quantities: Quantity[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const { values } of quantities) {
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (min === Infinity) return [0, 1];
  const margin = (max - min) * 0.05 || Math.abs(max) * 0.05 || 1;
  return [min - margin, max + margin];
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(4))) : "–";
}

/** The width of the element behind the returned ref, following it as it resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The labelled value of each line at frame `read`, the legend of a panel. */
function PanelReadout({ quantities, read, onRemove }: {
  quantities: Quantity[];
  read: number;
  onRemove?: () => void;
}) {
  return (
    <div style={{ ...barStyle, justifyContent: "space-between" }}>
      <span>
        {quantities.map((quantity, line) => (
          <span key={quantity.id} style={{ marginRight: "0.75rem", whiteSpace: "nowrap" }}>
            {quantities.length > 1 && <span style={{ color: seriesColor(line) }}>━ </span>}
            <span style={{ color: INK }}>{quantity.label}</span>{" "}
            {formatValue(quantity.values[read])}
          </span>
        ))}
        <span>{quantities[0].unit}</span>
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`remove ${quantities.map(({ label }) => label).join(", ")}`}
          onClick={onRemove}
          style={removeStyle}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Horizontal gridlines with their values, and the time ticks along the bottom. */
function PanelAxes({ valueTicks, timeTicks, x, y, right }: {
  valueTicks: number[];
  timeTicks: number[];
  x: (time: number) => number;
  y: (value: number) => number;
  right: number;
}) {
  return (
    <>
      {valueTicks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} x2={right} y1={y(tick)} y2={y(tick)} stroke={GRID} />
          <text x={MARGIN.left - 4} y={y(tick) + 3} textAnchor="end" fontSize={10} fill={MUTED}>
            {formatValue(tick)}
          </text>
        </g>
      ))}
      {timeTicks.map((tick) => (
        <text
          key={tick}
          x={x(tick)}
          y={PLOT_HEIGHT - 5}
          textAnchor="middle"
          fontSize={10}
          fill={MUTED}
        >
          {formatValue(tick)}
        </text>
      ))}
    </>
  );
}

export interface TimePanelProps {
  /** The lines to draw on one axis, all in the first one's unit. */
  quantities: Quantity[];
  times: Float64Array;
  /** The frame the cursor stands at. */
  frame: number;
  onSeek: (frame: number) => void;
  onRemove?: () => void;
}

/** One 2D plot over time: click or drag to seek, hover to read a frame off it. */
export function TimePanel({ quantities, times, frame, onSeek, onRemove }: TimePanelProps) {
  const [box, width] = useWidth();
  const [hovered, setHovered] = useState<number | null>(null);

  const start = times[0];
  const end = times[times.length - 1];
  const bottom = PLOT_HEIGHT - MARGIN.bottom;

  const { x, y, valueTicks, paths } = useMemo(() => {
    const [min, max] = valueRange(quantities);
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const x = (time: number) => MARGIN.left + ((time - start) / (end - start)) * plotWidth;
    const y = (value: number) =>
      MARGIN.top + ((max - value) / (max - min)) * (bottom - MARGIN.top);
    return {
      x,
      y,
      valueTicks: niceTicks(min, max, 2),
      paths: quantities.map(({ values, periodic }) => seriesPath(values, times, x, y, periodic)),
    };
  }, [quantities, times, width, start, end, bottom]);

  const frameUnder = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    return nearestFrame(times, timeAtX(event.clientX - left, width, start, end));
  };

  return (
    <div ref={box}>
      <PanelReadout quantities={quantities} read={hovered ?? frame} onRemove={onRemove} />
      <svg
        width={width}
        height={PLOT_HEIGHT}
        style={{ display: "block", cursor: "crosshair", touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onSeek(frameUnder(event));
        }}
        onPointerMove={(event) => {
          const under = frameUnder(event);
          setHovered(under);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(under);
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <PanelAxes
          valueTicks={valueTicks}
          timeTicks={niceTicks(start, end, 4)}
          x={x}
          y={y}
          right={width - MARGIN.right}
        />
        {paths.map((path, line) => (
          <path
            key={quantities[line].id}
            data-series={quantities[line].id}
            d={path}
            fill="none"
            stroke={seriesColor(line)}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hovered !== null && hovered !== frame && (
          <line
            x1={x(times[hovered])}
            x2={x(times[hovered])}
            y1={MARGIN.top}
            y2={bottom}
            stroke={MUTED}
            strokeDasharray="2 3"
          />
        )}
        <line
          data-cursor="time"
          x1={x(times[frame])}
          x2={x(times[frame])}
          y1={MARGIN.top}
          y2={bottom}
          stroke={CURSOR}
        />
      </svg>
    </div>
  );
}

export interface RunPanelsProps {
  run: Run;
  frame: number;
  onSeek: (frame: number) => void;
}

/** The scrubber and the 2D panels of a run, chosen from the columns it carries. */
export function RunPanels({ run, frame, onSeek }: RunPanelsProps) {
  const quantities = useMemo(() => runQuantities(run), [run]);
  const times = useMemo(() => runTimes(run), [run]);
  const [panels, setPanels] = useState(() => defaultPanels(quantities));

  const byId = new Map(quantities.map((quantity) => [quantity.id, quantity]));
  const shown = new Set(panels.flat());

  return (
    <div style={stripStyle}>
      <div style={barStyle}>
        <input
          type="range"
          aria-label="time"
          min={0}
          max={times.length - 1}
          value={frame}
          onChange={(event) => onSeek(Number(event.target.value))}
          style={{ flex: 1, minWidth: 0, accentColor: CURSOR }}
        />
        <span style={{ color: INK, whiteSpace: "nowrap" }}>{times[frame].toFixed(2)} s</span>
        <select
          aria-label="add a panel"
          value=""
          onChange={(event) => setPanels([...panels, [event.target.value]])}
          style={{ maxWidth: "9rem", background: "transparent", color: MUTED, font: "inherit" }}
        >
          <option value="" disabled>
            add a panel…
          </option>
          {quantities
            .filter(({ id }) => !shown.has(id))
            .map(({ id, label, unit }) => (
              <option key={id} value={id}>
                {label} [{unit}]
              </option>
            ))}
        </select>
      </div>
      <div style={gridStyle}>
        {panels.map((panel) => (
          <TimePanel
            key={panel.join()}
            quantities={panel.map((id) => byId.get(id)!)}
            times={times}
            frame={frame}
            onSeek={onSeek}
            onRemove={() => setPanels(panels.filter((other) => other !== panel))}
          />
        ))}
      </div>
    </div>
  );
}
