import { useMemo, useState } from "react";
import { runQuantities } from "./quantities";
import {
  barStyle,
  formatValue,
  gridStyle,
  INK,
  MARGIN,
  MUTED,
  niceTicks,
  PanelAxes,
  plotScales,
  PLOT_HEIGHT,
  seriesColor,
  seriesPath,
  stripStyle,
  useWidth,
  valueRange,
} from "./TimePanel";
import type { Run } from "./topology";

const viewStyle = { ...stripStyle, maxHeight: undefined };

/** One run of a sweep, with the value of each parameter it was run at. */
export interface SweepPoint {
  parameters: Record<string, number>;
  run: Run;
}

/** A quantity read at the last frame of each point's run. */
export interface SweepQuantity {
  id: string;
  label: string;
  unit: string;
  /** One value per point, in `unit`; NaN where that point's run lacks the quantity. */
  values: Float64Array;
}

/** Every quantity any point's run carries, read at the last frame of each run. */
export function sweepQuantities(points: SweepPoint[]): SweepQuantity[] {
  const byId = new Map<string, SweepQuantity>();
  points.forEach(({ run }, point) => {
    for (const { id, label, unit, values } of runQuantities(run)) {
      if (!byId.has(id)) {
        byId.set(id, { id, label, unit, values: new Float64Array(points.length).fill(NaN) });
      }
      byId.get(id)!.values[point] = values[values.length - 1];
    }
  });
  return [...byId.values()];
}

/** The parameters whose value differs between points, in the order they are first named. */
export function sweepAxes(points: SweepPoint[]): string[] {
  const names = new Set(points.flatMap(({ parameters }) => Object.keys(parameters)));
  return [...names].filter(
    (name) => new Set(points.map(({ parameters }) => parameters[name])).size > 1,
  );
}

/** The points of one curve, ordered along its axis, and the other parameters it holds. */
export interface SweepCurve {
  /** The value of every other swept parameter, shared by all its points. */
  held: Record<string, number>;
  /** Indices into the points. */
  indices: number[];
}

/** One curve along `axis` for each combination of the other swept parameters' values. */
export function axisCurves(points: SweepPoint[], axis: string): SweepCurve[] {
  const others = sweepAxes(points).filter((name) => name !== axis);
  const curves = new Map<string, SweepCurve>();
  points.forEach(({ parameters }, i) => {
    const held = Object.fromEntries(others.map((name) => [name, parameters[name]]));
    const key = JSON.stringify(held);
    if (!curves.has(key)) curves.set(key, { held, indices: [] });
    curves.get(key)!.indices.push(i);
  });
  for (const { indices } of curves.values()) {
    indices.sort((a, b) => points[a].parameters[axis] - points[b].parameters[axis]);
  }
  return [...curves.values()];
}

/** The parameters a curve holds, as `name value` pairs. */
function curveLabel({ held }: SweepCurve): string {
  return Object.entries(held)
    .map(([name, value]) => `${name} ${formatValue(value)}`)
    .join(", ");
}

/** What the marker of point `i` reads: its parameters, and its value of `quantity`. */
function markerTitle(quantity: SweepQuantity, point: SweepPoint, i: number) {
  const parameters = Object.entries(point.parameters)
    .map(([name, value]) => `${name} ${formatValue(value)}`)
    .join(", ");
  return `${parameters}: ${formatValue(quantity.values[i])} ${quantity.unit}`;
}

interface SweepPanelProps {
  quantity: SweepQuantity;
  points: SweepPoint[];
  axis: string;
  onOpen: (point: SweepPoint, index: number) => void;
}

/** `quantity` against parameter `axis`, a curve per combination of the others: click to open. */
function SweepPanel({ quantity, points, axis, onOpen }: SweepPanelProps) {
  const [box, width] = useWidth();

  const { curves, x, y, xTicks, valueTicks, paths } = useMemo(() => {
    const curves = axisCurves(points, axis);
    const along = (indices: number[]) =>
      Float64Array.from(indices, (i) => points[i].parameters[axis]);
    const valuesOf = (indices: number[]) => Float64Array.from(indices, (i) => quantity.values[i]);
    const [left, right] = valueRange([along(points.map((_, i) => i))]);
    const [min, max] = valueRange([quantity.values]);
    const { x, y } = plotScales(width, [left, right], [min, max]);
    return {
      curves,
      x,
      y,
      xTicks: niceTicks(left, right, 4),
      valueTicks: niceTicks(min, max, 2),
      paths: curves.map(({ indices }) =>
        seriesPath(valuesOf(indices), along(indices), x, y, false),
      ),
    };
  }, [quantity, points, axis, width]);

  return (
    <div ref={box}>
      <div style={barStyle}>
        <span>
          <span style={{ color: INK }}>{quantity.label}</span> [{quantity.unit}] against{" "}
          <span style={{ color: INK }}>{axis}</span>
        </span>
      </div>
      {curves.length > 1 && (
        <div>
          {curves.map((curve, line) => (
            <span key={line} style={{ marginRight: "0.75rem", whiteSpace: "nowrap" }}>
              <span style={{ color: seriesColor(line) }}>━ </span>
              {curveLabel(curve)}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={PLOT_HEIGHT} style={{ display: "block" }}>
        <PanelAxes
          valueTicks={valueTicks}
          xTicks={xTicks}
          x={x}
          y={y}
          right={width - MARGIN.right}
        />
        {curves.map((curve, line) => (
          <g key={line} data-series={curveLabel(curve) || axis}>
            <path d={paths[line]} fill="none" stroke={seriesColor(line)} strokeWidth={2} />
            {curve.indices
              .filter((i) => Number.isFinite(quantity.values[i]))
              .map((i) => (
                <circle
                  key={i}
                  data-point={i}
                  cx={x(points[i].parameters[axis])}
                  cy={y(quantity.values[i])}
                  r={4}
                  fill={seriesColor(line)}
                  style={{ cursor: "pointer" }}
                  onClick={() => onOpen(points[i], i)}
                >
                  <title>{markerTitle(quantity, points[i], i)}</title>
                </circle>
              ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

export interface SweepViewProps {
  points: SweepPoint[];
  /** Called with the point clicked, and its index in `points`, to open its run. */
  onOpen: (point: SweepPoint, index: number) => void;
}

/** A chosen quantity at the last frame of each point's run, against each swept parameter. */
export function SweepView({ points, onOpen }: SweepViewProps) {
  const quantities = useMemo(() => sweepQuantities(points), [points]);
  const axes = useMemo(() => sweepAxes(points), [points]);
  const [chosen, setChosen] = useState<string | null>(null);
  const quantity = quantities.find(({ id }) => id === chosen) ?? quantities[0];

  if (!quantity || axes.length === 0) {
    return <div style={viewStyle}>No parameter varies between these runs.</div>;
  }
  return (
    <div style={viewStyle}>
      <div style={barStyle}>
        <select
          aria-label="quantity"
          value={quantity.id}
          onChange={(event) => setChosen(event.target.value)}
          style={{ background: "transparent", color: MUTED, font: "inherit" }}
        >
          {quantities.map(({ id, label, unit }) => (
            <option key={id} value={id}>
              {label} [{unit}]
            </option>
          ))}
        </select>
      </div>
      <div style={gridStyle}>
        {axes.map((axis) => (
          <SweepPanel
            key={axis}
            quantity={quantity}
            points={points}
            axis={axis}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
