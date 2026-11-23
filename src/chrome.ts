/** Colours of the viewer's own text, grid and plots, drawn over its dark scene. */
export const CHROME = {
  background: "#07070b",
  backdrop: "rgba(7, 7, 11, 0.85)",
  ink: "#d7dae1",
  muted: "#9aa0ad",
  warning: "#e0a44a",
  grid: "#1b2030",
  gridSection: "#2b3348",
  cursor: "#f2f3f5",
};

/** Colours of the lines sharing one plot, in the order they are drawn. */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];

/** The viewer's text at `size` [px] and `lineHeight`, as a CSS `font`. */
export function monospace(size: number, lineHeight: number): string {
  return `${size}px/${lineHeight} ui-monospace, SFMono-Regular, Menlo, monospace`;
}
