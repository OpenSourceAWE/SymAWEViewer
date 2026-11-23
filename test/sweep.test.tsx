// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  axisCurves,
  sweepAxes,
  sweepQuantities,
  SweepView,
  type SweepPoint,
} from "../src/SweepView";
import { runQuantities } from "../src/quantities";
import { decodeRun, type Run } from "../src/topology";
import { fixture, V3_RUN } from "./fixtures";

const run = decodeRun(fixture(V3_RUN));

/** The V3 run cut off after its first `frames` frames. */
function flownFor(frames: number): Run {
  return { ...run, frames: run.frames.slice(0, frames), table: run.table.slice(0, frames) };
}

/** `run` without column `name`. */
function withoutColumn(flown: Run, name: string): Run {
  const kept = flown.table.schema.fields
    .map((field) => field.name)
    .filter((other) => other !== name);
  return { ...flown, table: flown.table.select(kept) };
}

/** A grid sweep, out of order: `frames` 21, 41 and 61, each at `gain` 1 and 2. */
const points: SweepPoint[] = [
  [61, 1],
  [21, 1],
  [41, 1],
  [61, 2],
  [21, 2],
  [41, 2],
].map(([frames, gain]) => ({ parameters: { frames, gain }, run: flownFor(frames) }));

function winchForce() {
  return sweepQuantities(points).find(({ id }) => id === "winch_force")!;
}

describe("sweepQuantities", () => {
  it("reads each quantity at the last frame of each point's run", () => {
    const atFrame = (frame: number) =>
      runQuantities(run).find(({ id }) => id === "winch_force")!.values[frame];
    const values = winchForce().values;
    expect(values[0]).toBeCloseTo(609.8, 1);
    expect(Array.from(values)).toEqual([60, 20, 40, 60, 20, 40].map(atFrame));
    expect(values[1]).not.toBeCloseTo(values[0], 0);
  });

  it("names each quantity once, with its label and unit, and NaN where a run lacks it", () => {
    const unforced = withoutColumn(flownFor(30), "winch_force");
    const lacking = [...points, { parameters: { frames: 30, gain: 1 }, run: unforced }];
    const quantities = sweepQuantities(lacking);
    const force = quantities.find(({ id }) => id === "winch_force")!;
    expect(quantities.filter(({ id }) => id === "winch_force")).toHaveLength(1);
    expect(force.unit).toBe("N");
    expect(force.label).toBe("winch force");
    expect(force.values).toHaveLength(7);
    expect(force.values[6]).toBeNaN();
  });
});

describe("the axes of a sweep", () => {
  it("are the parameters that vary, in the order the first point names them", () => {
    const fixed = points.map(({ parameters, run }) => ({
      parameters: { ...parameters, v_wind: 9 },
      run,
    }));
    expect(sweepAxes(fixed)).toEqual(["frames", "gain"]);
  });

  it("each carry a curve per combination of the other parameters, ordered along it", () => {
    expect(axisCurves(points, "frames")).toEqual([
      { held: { gain: 1 }, indices: [1, 2, 0] },
      { held: { gain: 2 }, indices: [4, 5, 3] },
    ]);
    expect(axisCurves(points, "gain")).toEqual([
      { held: { frames: 61 }, indices: [0, 3] },
      { held: { frames: 21 }, indices: [1, 4] },
      { held: { frames: 41 }, indices: [2, 5] },
    ]);
  });

  it("give a sweep over one parameter a single curve through every point", () => {
    const line = points
      .slice(0, 3)
      .map(({ parameters, run }) => ({ parameters: { frames: parameters.frames }, run }));
    expect(sweepAxes(line)).toEqual(["frames"]);
    expect(axisCurves(line, "frames")).toEqual([{ held: {}, indices: [1, 2, 0] }]);
  });
});

describe("SweepView", () => {
  it("draws a panel per axis and every point on each, opening on winch force", () => {
    const html = renderToStaticMarkup(<SweepView points={points} onOpen={() => {}} />);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.match(/data-series/g)).toHaveLength(5);
    expect(html.match(/data-point=/g)).toHaveLength(12);
    expect(html).toContain("winch force</span> [N] against");
    expect(html).toContain("gain 2");
    expect(html).toContain("frames 41");
    expect(html).toContain("<title>frames 61, gain 1: 609.8 N</title>");
  });

  it("opens the run of the point clicked, and draws the quantity chosen", async () => {
    const opened: [SweepPoint, number][] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<SweepView points={points} onOpen={(point, i) => opened.push([point, i])} />),
    );

    const marker = container.querySelector('[data-point="3"]')!;
    await act(async () => marker.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(opened).toHaveLength(1);
    expect(opened[0][0]).toBe(points[3]);
    expect(opened[0][1]).toBe(3);

    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "v_app";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("apparent wind [m/s] against frames");
    expect(container.textContent).not.toContain("winch force [N] against");
    await act(async () => root.unmount());
  });
});
