import type { CSSProperties } from "react";
import { partFacts, type Part } from "./parts";
import type { Quantity } from "./quantities";
import { buttonStyle, formatValue, INK, MUTED, monospace } from "./TimePanel";
import type { Run } from "./topology";

/** The part to show, its quantities, the frame they are read at, and what pinning reports. */
export interface InspectorProps {
  run: Run;
  part: Part;
  /** The quantities of `part`, as `partQuantities` gives them. */
  quantities: Quantity[];
  frame: number;
  /** The ids of the quantities a panel already shows. */
  pinned: Set<string>;
  /** Adds the quantity with `id` as a panel; without it, nothing is offered for pinning. */
  onPin?: (id: string) => void;
  /** Called with a part the document names beside this one, when it is clicked. */
  onSelect: (part: Part) => void;
  onClose: () => void;
}

/** The width of the inspector, which chrome beside it leaves free. */
export const INSPECTOR_WIDTH = "17rem";

const boxStyle: CSSProperties = {
  position: "absolute",
  top: "0.75rem",
  right: "0.75rem",
  width: INSPECTOR_WIDTH,
  maxWidth: "calc(100% - 1.5rem)",
  maxHeight: "calc(100% - 1.5rem)",
  overflowY: "auto",
  padding: "0.4rem 0.6rem",
  borderRadius: 4,
  background: "rgba(7, 7, 11, 0.85)",
  color: MUTED,
  font: monospace,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: "0.4rem",
};

const linkStyle: CSSProperties = {
  ...buttonStyle,
  padding: 0,
  marginRight: "0.5rem",
  color: INK,
  textDecoration: "underline",
};

/** A part's name and role from the structure document, and its state at `frame` with units. */
export function Inspector({
  run,
  part,
  quantities,
  frame,
  pinned,
  onPin,
  onSelect,
  onClose,
}: InspectorProps) {
  return (
    <div style={boxStyle} data-inspector={`${part.kind} ${part.name}`}>
      <div style={{ display: "flex", justifyContent: "space-between", color: INK }}>
        <span>
          {part.kind} {part.name}
        </span>
        <button type="button" aria-label="close" onClick={onClose} style={buttonStyle}>
          ×
        </button>
      </div>
      {partFacts(run, part).map(({ label, value, parts }) => (
        <div key={label}>
          {label}{" "}
          {value ?? null}
          {parts?.map((other) => (
            <button
              key={other.name}
              type="button"
              onClick={() => onSelect(other)}
              style={linkStyle}
            >
              {other.name}
            </button>
          ))}
        </div>
      ))}
      <table style={tableStyle}>
        <tbody>
          {quantities.map(({ id, label, unit, values }) => (
            <tr key={id}>
              <td>{label}</td>
              <td style={{ color: INK, textAlign: "right" }}>{formatValue(values[frame])}</td>
              <td style={{ paddingLeft: "0.4rem" }}>{unit}</td>
              {onPin && (
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    aria-label={`pin ${part.kind} ${part.name} ${label}`}
                    disabled={pinned.has(id)}
                    onClick={() => onPin(id)}
                    style={{ ...buttonStyle, opacity: pinned.has(id) ? 0.4 : 1 }}
                  >
                    pin
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
