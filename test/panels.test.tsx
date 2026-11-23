import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  niceTicks,
  panelsOfRun,
  RunPanels,
  seriesPath,
  TimePanel,
  timeAtX,
} from "../src/TimePanel";
import { defaultPanels, runQuantities, runTimes } from "../src/quantities";
import { decodeRun } from "../src/topology";
import { example, fixture, runOf, V3_RUN } from "./fixtures";

const run = decodeRun(fixture(V3_RUN));
const quantities = runQuantities(run);
const times = runTimes(run);
const identity = (value: number) => value;

function render(frame: number) {
  return renderToStaticMarkup(<RunPanels run={run} frame={frame} onSeek={() => {}} />);
}

describe("RunPanels", () => {
  it("draws the six default panels of the V3 run, with a line per quantity", () => {
    const html = render(0);
    expect(html.match(/<svg/g)).toHaveLength(6);
    expect(html.match(/data-series/g)).toHaveLength(8);
    expect(html).toContain("winch force");
    expect(html).toContain("AoA");
  });

  it("offers what no panel shows, including attitude and the aero coefficients", () => {
    const html = render(0);
    for (const label of ["roll", "pitch", "yaw", "CL (estimate)", "CD (estimate)", "L/D"]) {
      expect(html).toContain(`>${label} [`);
    }
    expect(html).not.toContain(">winch force [");
  });

  it("moves the scrubber and every panel's cursor with the frame", () => {
    expect(render(30)).toContain('value="30"');
    const panel = (frame: number) =>
      renderToStaticMarkup(
        <TimePanel quantities={[quantities[0]]} times={times} frame={frame} onSeek={() => {}} />,
      );
    const cursorAt = (html: string) => Number(html.match(/data-cursor="[^"]*" x1="([\d.]+)"/)![1]);
    expect(cursorAt(panel(60))).toBeGreaterThan(cursorAt(panel(0)));
    expect(panel(60)).toContain("609.8");
  });

  it("reads the cursor in seconds, or as a frame number for a run with no time column", () => {
    expect(render(60)).toContain("3.00 s");
    const columns = run.table.schema.fields.map(({ name }) => name);
    const untimed = { ...run, table: run.table.select(columns.filter((name) => name !== "time")) };
    const html = renderToStaticMarkup(<RunPanels run={untimed} frame={60} onSeek={() => {}} />);
    expect(html).toContain("frame 60");
    expect(html).not.toContain("60.00 s");
  });

  it("holds the cursor at the last frame of a run shorter than the frame it is given", () => {
    expect(render(1000)).toContain('value="60"');
  });
});

describe("panelsOfRun", () => {
  const other = decodeRun(runOf(example("v3_psm_structure")));

  it("keeps the panels chosen on a run for that run", () => {
    const panels = [["steering"]];
    expect(panelsOfRun({ run, panels }, run, quantities)).toBe(panels);
  });

  it("opens another run on its own defaults, not on panels it may have no column for", () => {
    const choice = { run, panels: [["steering"]] };
    expect(panelsOfRun(choice, other, [])).toEqual([]);
    expect(panelsOfRun(null, run, quantities)).toEqual(defaultPanels(quantities));
  });
});

describe("clicking a panel", () => {
  it("seeks to the time under the pointer, clamped to the plot", () => {
    const width = 400;
    const plotRight = width - 8;
    expect(timeAtX(44, width, 0, 3)).toBeCloseTo(0, 9);
    expect(timeAtX(plotRight, width, 0, 3)).toBeCloseTo(3, 9);
    expect(timeAtX((44 + plotRight) / 2, width, 0, 3)).toBeCloseTo(1.5, 9);
    expect(timeAtX(-20, width, 0, 3)).toBe(0);
    expect(timeAtX(width + 20, width, 0, 3)).toBe(3);
  });
});

describe("seriesPath", () => {
  const steps = Float64Array.from([0, 1, 2, 3]);

  it("joins finite values into one line", () => {
    const path = seriesPath(Float64Array.from([1, 2, 3, 4]), steps, identity, identity, false);
    expect(path).toBe("M0.0 1.0L1.0 2.0L2.0 3.0L3.0 4.0");
  });

  it("leaves a gap at a value that is not finite", () => {
    const path = seriesPath(Float64Array.from([1, NaN, 3, 4]), steps, identity, identity, false);
    expect(path).toBe("M0.0 1.0M2.0 3.0L3.0 4.0");
  });

  it("breaks a periodic angle where it wraps instead of drawing across the plot", () => {
    const wrapping = Float64Array.from([170, 179, -179, -170]);
    expect(seriesPath(wrapping, steps, identity, identity, true)).toBe(
      "M0.0 170.0L1.0 179.0M2.0 -179.0L3.0 -170.0",
    );
    expect(seriesPath(wrapping, steps, identity, identity, false)).toContain("L2.0 -179.0");
  });
});

describe("niceTicks", () => {
  it("lands on round numbers inside the range", () => {
    expect(niceTicks(472, 1000, 3)).toEqual([600, 800, 1000]);
    expect(niceTicks(0, 3, 4)).toEqual([0, 1, 2, 3]);
  });
});
