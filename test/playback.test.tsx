import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { kitePath, kitePoints } from "../src/parts";
import { advanceTime, TRAIL_SECONDS, trailStart } from "../src/playback";
import { runQuantities, runTimes } from "../src/quantities";
import { FlightReadout, readoutValues } from "../src/Readout";
import { resolveScene } from "../src/Scene";
import { RunPanels } from "../src/TimePanel";
import { decodeRun } from "../src/topology";
import { fixture, V3_RUN } from "./fixtures";

const run = decodeRun(fixture(V3_RUN));
const times = runTimes(run);
const quantities = runQuantities(run);
const valueOf = (id: string, frame: number) =>
  quantities.find((quantity) => quantity.id === id)!.values[frame];

describe("advanceTime", () => {
  it("moves on by the step it is given, in seconds", () => {
    expect(advanceTime(times, 1, 0.5)).toBeCloseTo(1.5);
    expect(advanceTime(times, 1, 0.4 * 4)).toBeCloseTo(2.6);
  });

  it("loops from the end of the run back to its start", () => {
    expect(advanceTime(times, 2.9, 0.2)).toBeCloseTo(0.1);
    expect(advanceTime(times.slice(0, 1), 0, 0.2)).toBe(0);
  });
});

describe("trailStart", () => {
  const frameAt = (time: number) => times.findIndex((at) => at >= time - 1e-9);

  it(`reaches ${TRAIL_SECONDS} s behind the cursor`, () => {
    expect(trailStart(times, 0, 60)).toBe(frameAt(3 - TRAIL_SECONDS));
    const longRun = Float64Array.from({ length: 201 }, (_, i) => i * 0.05);
    expect(longRun[trailStart(longRun, 0, 200)]).toBeCloseTo(10 - TRAIL_SECONDS);
  });

  it("starts again at the frame of the last seek", () => {
    expect(trailStart(times, 40, 50)).toBe(40);
    expect(trailStart(times, 40, 40)).toBe(40);
  });

  it("starts at the cursor once it is back before the last seek", () => {
    expect(trailStart(times, 40, 10)).toBe(10);
  });
});

describe("the kite's path", () => {
  it("is the mean of the wing's station points in every frame", () => {
    const path = kitePath(run);
    const members = kitePoints(run);
    expect(members).toHaveLength(20);
    expect(path).toHaveLength(run.frames.length * 3);
    const frame = run.frames[30];
    const meanZ = members.reduce((sum, point) => sum + frame.z[point], 0) / members.length;
    expect(path[30 * 3 + 2]).toBeCloseTo(meanZ, 3);
    expect(meanZ).toBeGreaterThan(100);
  });

  it("gives the kite's height and speed as quantities", () => {
    expect(valueOf("height", 30)).toBeCloseTo(kitePath(run)[30 * 3 + 2], 3);
    const velocity = ["x", "y", "z"].map((axis) => valueOf(`vel_kite/${axis}`, 60));
    expect(valueOf("kite_speed", 60)).toBeCloseTo(Math.hypot(...velocity));
  });
});

describe("FlightReadout", () => {
  it("reads speed, height, the winch force in kN and the time at the cursor", () => {
    const lines = readoutValues(quantities, 60);
    expect(lines.map(({ label }) => label)).toEqual(["speed", "height", "force"]);
    expect(lines[2]).toEqual({ label: "force", unit: "kN", value: "0.61" });
    const html = renderToStaticMarkup(
      <FlightReadout quantities={quantities} times={times} timed frame={60} ink="#505880" muted="#8f95b8" />,
    );
    expect(html).toContain("3.00 s");
    expect(html).toContain(`${valueOf("kite_speed", 60).toFixed(1)} m/s`);
    expect(html).toContain("color:#505880");
  });

  it("leaves out what the run does not carry", () => {
    const columns = run.table.schema.fields.map(({ name }) => name);
    const bare = { ...run, table: run.table.select(columns.filter((name) => name !== "vel_kite" && name !== "winch_force")) };
    expect(readoutValues(runQuantities(bare), 0).map(({ label }) => label)).toEqual(["height"]);
  });
});

describe("RunPanels' modes", () => {
  const render = (panels: "open" | "collapsed" | "hidden") =>
    renderToStaticMarkup(
      <RunPanels
        run={run}
        frame={0}
        onSeek={() => {}}
        panels={panels}
        controls={<button type="button">play</button>}
        theme={resolveScene({ ink: "#505880" })}
      />,
    );

  it("draws the panels when open, and folds them behind a toggle when collapsed", () => {
    expect(render("open").match(/<svg/g)).toHaveLength(6);
    expect(render("open")).toContain('aria-expanded="true"');
    expect(render("collapsed")).not.toContain("<svg");
    expect(render("collapsed")).toContain('aria-expanded="false"');
  });

  it("keeps the controls and the scrubber with the panels hidden, and no toggle", () => {
    const hidden = render("hidden");
    expect(hidden).not.toContain("<svg");
    expect(hidden).not.toContain("aria-expanded");
    expect(hidden).not.toContain("add a panel");
    expect(hidden).toContain(">play</button>");
    expect(hidden).toContain('aria-label="time"');
    expect(hidden).toContain("accent-color:#505880");
  });
});
