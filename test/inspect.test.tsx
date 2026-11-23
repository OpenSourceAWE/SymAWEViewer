import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Inspector } from "../src/Inspector";
import { partFacts, partPoints, partSegments, type Part } from "../src/parts";
import {
  findQuantity,
  partQuantities,
  quantitiesCsv,
  runQuantities,
  runTimes,
  type Quantity,
} from "../src/quantities";
import { RunPanels } from "../src/TimePanel";
import { columnValues, decodeRun, wingOriginSlots } from "../src/topology";
import { example, fixture, runOf, V3_RUN } from "./fixtures";

const run = decodeRun(fixture(V3_RUN));
const quantities = runQuantities(run);
const FRAME = 30;

/** Slot `slot` of list column `name` in frame `frame`, as the log holds it. */
function logged(name: string, slot: number, frame = FRAME): number {
  return run.table.getChild(name)!.get(frame).toArray()[slot];
}

/** The quantity `key` of `part`, read at `FRAME`, with its unit. */
function stateOf(part: Part, key: string): { value: number; unit: string } {
  const quantity = partQuantities(run, part).find(({ id }) => id.endsWith(`/${key}`))!;
  return { value: quantity.values[FRAME], unit: quantity.unit };
}

const segmentNames = columnValues<string>(run.topology.segments, "name");
const pointNames = columnValues<string>(run.topology.points, "name");

describe("the state of a selected part of the V3 run", () => {
  it("gives a point its position and velocity, from its own slot of the frame", () => {
    const part: Part = { kind: "point", name: "1_point_5" };
    const slot = pointNames.indexOf("1_point_5");
    expect(stateOf(part, "x")).toEqual({ value: logged("X", slot), unit: "m" });
    expect(stateOf(part, "z")).toEqual({ value: logged("Z", slot), unit: "m" });
    expect(stateOf(part, "vy")).toEqual({ value: logged("VY", slot), unit: "m/s" });
    const speed = Math.hypot(logged("VX", slot), logged("VY", slot), logged("VZ", slot));
    expect(stateOf(part, "speed").value).toBeCloseTo(speed, 9);
  });

  it("gives a segment the force the log holds for it, and its length and strain", () => {
    const part: Part = { kind: "segment", name: "1_seg_6" };
    const row = segmentNames.indexOf("1_seg_6");
    expect(stateOf(part, "force")).toEqual({ value: logged("spring_force", row), unit: "N" });
    expect(stateOf(part, "force").value).toBeCloseTo(logged("winch_force", 0), 3);
    const [a, b] = ["1_point_5", "39"].map((name) => pointNames.indexOf(name));
    const { x, y, z } = run.frames[FRAME];
    const length = Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
    expect(stateOf(part, "length")).toEqual({ value: length, unit: "m" });
    expect(stateOf(part, "strain").value).toBeCloseTo((length - 25) / 25, 9);
    expect(stateOf(part, "strain").unit).toBe("-");
  });

  it("finds a wing's origin behind the panel corners, and turns its quaternion to degrees", () => {
    expect(wingOriginSlots(run.table, 1)).toEqual([332]);
    const part: Part = { kind: "wing", name: "1" };
    expect(stateOf(part, "x")).toEqual({ value: logged("X", 332), unit: "m" });
    expect(run.frames[FRAME].wings[2]).toBeCloseTo(logged("Z", 332), 4);
    for (const angle of ["roll", "pitch", "yaw"]) {
      const ofRun = quantities.find(({ id }) => id === angle)!;
      expect(stateOf(part, angle)).toEqual({ value: ofRun.values[FRAME], unit: "deg" });
    }
  });

  it("gives a winch its tether length, reel-out speed and force from its own slot", () => {
    const part: Part = { kind: "winch", name: "1" };
    expect(stateOf(part, "l_tether")).toEqual({ value: logged("l_tether", 0), unit: "m" });
    expect(stateOf(part, "v_reelout").unit).toBe("m/s");
    expect(stateOf(part, "winch_force")).toEqual({ value: logged("winch_force", 0), unit: "N" });
  });

  it("gives a tether the length of its segments together, and the force at each end", () => {
    const part: Part = { kind: "tether", name: "1" };
    const members = ["1_seg_1", "1_seg_2", "1_seg_3", "1_seg_4", "1_seg_5", "1_seg_6"];
    const length = members.reduce(
      (sum, name) => sum + stateOf({ kind: "segment", name }, "length").value,
      0,
    );
    expect(stateOf(part, "length").value).toBeCloseTo(length, 9);
    expect(stateOf(part, "length").value).toBeCloseTo(logged("l_tether", 0), 1);
    expect(stateOf(part, "force_end_point").value).toBeCloseTo(logged("winch_force", 0), 3);
    const kiteEnd = logged("spring_force", segmentNames.indexOf("1_seg_1"));
    expect(stateOf(part, "force_start_point")).toEqual({ value: kiteEnd, unit: "N" });
  });

  it("has no state for a part the run does not hold", () => {
    expect(partQuantities(run, { kind: "segment", name: "no such segment" })).toEqual([]);
    const oneFrame = decodeRun(runOf(example("v3_psm_structure")));
    expect(partQuantities(oneFrame, { kind: "wing", name: "1" })).toEqual([]);
    expect(oneFrame.frames[0].wings).toHaveLength(0);
  });
});

describe("what the structure document says about a part", () => {
  const facts = (part: Part) =>
    Object.fromEntries(
      partFacts(run, part).map(({ label, value, parts }) => [label, value ?? parts]),
    );

  it("names a segment's role, ends, rest length with its unit, and its tether", () => {
    expect(facts({ kind: "segment", name: "1_seg_6" })).toEqual({
      role: "tether, reeled by a winch",
      points: [
        { kind: "point", name: "1_point_5" },
        { kind: "point", name: "39" },
      ],
      "rest length": "25 m",
      diameter: "0.0135 m",
      tether: [{ kind: "tether", name: "1" }],
    });
  });

  it("names a winch's tether and winch point, and a point's winch", () => {
    const winch = facts({ kind: "winch", name: "1" });
    expect(winch["winch point"]).toEqual([{ kind: "point", name: "39" }]);
    expect(winch.tethers).toEqual([{ kind: "tether", name: "1" }]);
    expect(winch["drum radius"]).toBe("0.11 m");
    expect(facts({ kind: "point", name: "39" }).winch).toEqual([{ kind: "winch", name: "1" }]);
  });

  it("leads from a point on a station to the station's wing", () => {
    const point = facts({ kind: "point", name: "2" });
    expect(point.stations).toBe("1");
    expect(point.wing).toEqual([{ kind: "wing", name: "1" }]);
    expect(facts({ kind: "point", name: "39" }).wing).toBeUndefined();
  });

  it("draws a tether as its segments and a winch as its winch point", () => {
    const tether = partSegments(run, { kind: "tether", name: "1" });
    expect(tether.map((row) => segmentNames[row])).toEqual([
      "1_seg_1",
      "1_seg_2",
      "1_seg_3",
      "1_seg_4",
      "1_seg_5",
      "1_seg_6",
    ]);
    expect(partPoints(run, { kind: "winch", name: "1" })).toEqual([pointNames.indexOf("39")]);
  });
});

describe("Inspector", () => {
  const part: Part = { kind: "segment", name: "1_seg_6" };
  const render = (pinned: string[], pinnable = true) =>
    renderToStaticMarkup(
      <Inspector
        run={run}
        part={part}
        quantities={partQuantities(run, part)}
        frame={FRAME}
        pinned={new Set(pinned)}
        onPin={pinnable ? () => {} : undefined}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

  it("shows the part's name and role and its state at the cursor, with units", () => {
    const html = render([]);
    expect(html).toContain("<span>segment 1_seg_6</span>");
    expect(html).toContain("tether, reeled by a winch");
    expect(html).toMatch(/force<\/td><td[^>]*>532.6<\/td><td[^>]*>N</);
    expect(html).toMatch(/strain<\/td><td[^>]*>[\d.e-]+<\/td><td[^>]*>-</);
  });

  it("offers a pin per quantity, and none for one a panel already shows", () => {
    expect(render([]).match(/>pin</g)).toHaveLength(3);
    const pinnedForce = render(["segment:1_seg_6/force"]);
    expect(pinnedForce).toMatch(/aria-label="pin segment 1_seg_6 force" disabled/);
    expect(render([], false)).not.toContain(">pin<");
  });
});

describe("a pinned quantity", () => {
  it("is found by its id, so a panel can hold it beside the run's own", () => {
    const force = findQuantity(run, quantities, "segment:1_seg_6/force")!;
    expect(force.of).toBe("segment 1_seg_6");
    expect(findQuantity(run, quantities, "winch_force")).toBe(quantities[0]);
    expect(findQuantity(run, quantities, "segment:no such segment/force")).toBeUndefined();
  });

  it("gets a panel naming its part", () => {
    const html = renderToStaticMarkup(
      <RunPanels
        run={run}
        quantities={quantities}
        frame={FRAME}
        onSeek={() => {}}
        panels={[["winch_force"], ["segment:1_seg_6/force"]]}
        onPanelsChange={() => {}}
      />,
    );
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain("segment 1_seg_6 force");
    expect(html).toContain(">CSV<");
  });
});

describe("quantitiesCsv", () => {
  const times = runTimes(run);
  const pinned = ["winch_force", "segment:1_seg_6/force", "segment:1_seg_6/strain"].map(
    (id) => findQuantity(run, quantities, id)!,
  );

  it("writes a row per frame, the time first and each quantity with its unit", () => {
    const lines = quantitiesCsv(times, "time [s]", pinned).trimEnd().split("\n");
    expect(lines).toHaveLength(62);
    expect(lines[0].split(",")).toEqual([
      "time [s]",
      "winch force [N]",
      "segment 1_seg_6 force [N]",
      "segment 1_seg_6 strain [-]",
    ]);
    const row = lines[1 + FRAME].split(",").map(Number);
    expect(row[0]).toBeCloseTo(1.5, 9);
    expect(row[1]).toBe(pinned[0].values[FRAME]);
    expect(row[2]).toBe(pinned[1].values[FRAME]);
  });

  it("quotes a header holding a comma, and leaves a value that is not finite empty", () => {
    const odd: Quantity = {
      id: "odd",
      column: "odd",
      label: "lift, total",
      unit: "N",
      values: Float64Array.from([NaN, 2]),
      periodic: false,
    };
    expect(quantitiesCsv(Float64Array.from([0, 1]), "frame", [odd])).toBe(
      'frame,"lift, total [N]"\n0,\n1,2\n',
    );
  });
});
