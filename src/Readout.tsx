import type { CSSProperties } from "react";
import type { Quantity } from "./quantities";

interface ReadoutLine {
  /** The column of the quantity read. */
  column: string;
  label: string;
  unit: string;
  /** Factor from the quantity's unit to `unit`. */
  scale: number;
  digits: number;
}

const LINES: ReadoutLine[] = [
  { column: "kite_speed", label: "speed", unit: "m/s", scale: 1, digits: 1 },
  { column: "height", label: "height", unit: "m", scale: 1, digits: 0 },
  { column: "winch_force", label: "force", unit: "kN", scale: 1e-3, digits: 2 },
];

/** Each line of the readout `quantities` carry, with its value at `frame`. */
export function readoutValues(quantities: Quantity[], frame: number) {
  return LINES.flatMap(({ column, label, unit, scale, digits }) => {
    const quantity = quantities.find((candidate) => candidate.column === column);
    if (!quantity) return [];
    return [{ label, unit, value: (quantity.values[frame] * scale).toFixed(digits) }];
  });
}

const readoutStyle: CSSProperties = {
  position: "absolute",
  bottom: "1rem",
  right: "1.5rem",
  margin: 0,
  pointerEvents: "none",
  textAlign: "right",
  font: "12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** Kite speed, height, winch force and time at `frame`, those the run carries. */
export function FlightReadout({ quantities, times, timed, frame, ink, muted }: {
  quantities: Quantity[];
  times: Float64Array;
  /** Whether `times` are seconds rather than frame numbers. */
  timed: boolean;
  frame: number;
  ink: string;
  muted: string;
}) {
  const lines = readoutValues(quantities, frame);
  if (timed) lines.push({ label: "time", unit: "s", value: times[frame].toFixed(2) });
  return (
    <dl style={{ ...readoutStyle, color: muted }}>
      {lines.map(({ label, unit, value }) => (
        <div key={label}>
          <dt style={{ display: "inline" }}>{label} </dt>
          <dd style={{ display: "inline", margin: 0, color: ink }}>
            {value} {unit}
          </dd>
        </div>
      ))}
    </dl>
  );
}
