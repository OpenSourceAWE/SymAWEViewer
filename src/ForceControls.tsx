import type { CSSProperties, ReactNode } from "react";
import type { Palette } from "./Structure";
import { INK, MUTED, monospace } from "./TimePanel";
import type { RunForces, SpringForces } from "./quantities";

/** Which of a run's forces are drawn. */
export interface ForcesShown {
  spring: boolean;
  aero: boolean;
  drag: boolean;
}

/** The forces drawn when a run opens: none, so segments wear their role colours. */
export const NO_FORCES_SHOWN: ForcesShown = { spring: false, aero: false, drag: false };

export interface ForceControlsProps {
  forces: RunForces;
  shown: ForcesShown;
  palette: Palette;
  onChange: (shown: ForcesShown) => void;
}

const boxStyle: CSSProperties = {
  position: "absolute",
  left: "0.75rem",
  bottom: "0.75rem",
  maxWidth: "calc(100% - 1.5rem)",
  padding: "0.4rem 0.6rem",
  borderRadius: 4,
  background: "rgba(7, 7, 11, 0.8)",
  color: MUTED,
  font: monospace,
};

const scaleEndsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "0.75rem",
  color: INK,
};

const newtons = (force: number) => `${Math.round(force)} N`;

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}

function Toggle({ label, checked, onChange, children }: ToggleProps) {
  return (
    <div>
      <label style={{ display: "block", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          style={{ margin: "0 0.4rem 0 0", verticalAlign: "middle" }}
        />
        {label}
      </label>
      {checked && children}
    </div>
  );
}

/** The diverging scale of the spring force, and the range the run really reaches. */
function SpringLegend({ spring, palette }: { spring: SpringForces; palette: Palette }) {
  const { limit, min, max } = spring;
  const { compression, unloaded, tension } = palette;
  return (
    <div style={{ margin: "0.2rem 0 0.3rem" }}>
      <div
        style={{
          height: 8,
          borderRadius: 2,
          background: `linear-gradient(to right, ${compression}, ${unloaded}, ${tension})`,
        }}
      />
      <div style={scaleEndsStyle}>
        <span>-{newtons(limit)}</span>
        <span>0</span>
        <span>+{newtons(limit)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
        <span>compression</span>
        <span>tension</span>
      </div>
      <div>
        run {Math.round(min)} to {newtons(max)}
      </div>
    </div>
  );
}

/** A toggle per force `forces` offers, with the legend of each one shown. */
export function ForceControls({ forces, shown, palette, onChange }: ForceControlsProps) {
  const { spring, arrows } = forces;
  if (!spring && arrows.length === 0) return null;
  return (
    <div style={boxStyle}>
      {spring && (
        <Toggle
          label="spring force"
          checked={shown.spring}
          onChange={(checked) => onChange({ ...shown, spring: checked })}
        >
          <SpringLegend spring={spring} palette={palette} />
        </Toggle>
      )}
      {arrows.map(({ key, label, largest }) => (
        <Toggle
          key={key}
          label={label}
          checked={shown[key]}
          onChange={(checked) => onChange({ ...shown, [key]: checked })}
        >
          <div>
            <span style={{ color: palette[key] }}>━▶</span> longest {newtons(largest)}
          </div>
        </Toggle>
      ))}
    </div>
  );
}
