import { Table, vectorFromArray } from "apache-arrow";
import { describe, expect, it } from "vitest";
import {
  defaultPanels,
  kiteAttitude,
  nearestFrame,
  runQuantities,
  runTimes,
  type Quantity,
} from "../src/quantities";
import { decodeRun, type Run } from "../src/topology";
import { example, fixture, runOf, V3_RUN } from "./fixtures";

const run = decodeRun(fixture(V3_RUN));
const quantities = runQuantities(run);
const raw = (name: string) => run.table.getChild(name)!;

/** `flown` with each value of the named columns, and each element of a list, set by `value`. */
function withValues(flown: Run, names: string[], value: (element: number) => number): Run {
  const replaced = names.map((name) => {
    const column = flown.table.getChild(name)!;
    const rows = Array.from({ length: flown.table.numRows }, (_, frame) => {
      const row = column.get(frame);
      return typeof row === "number" ? value(0) : Array.from(row, (_, i) => value(i));
    });
    return [name, vectorFromArray(rows, column.type)];
  });
  return { ...flown, table: flown.table.assign(new Table(Object.fromEntries(replaced))) };
}

function quantity(id: string): Quantity {
  const found = quantities.find((candidate) => candidate.id === id);
  const known = quantities.map((candidate) => candidate.id).join(" ");
  if (!found) throw new Error(`no quantity ${id}: ${known}`);
  return found;
}

describe("runQuantities", () => {
  it("shows every angle in degrees and every other column unscaled", () => {
    const heading = quantity("heading");
    expect(heading.unit).toBe("deg");
    expect(heading.values[60]).toBeCloseTo((raw("heading").get(60) * 180) / Math.PI, 3);
    expect(quantity("v_app").unit).toBe("m/s");
    expect(quantity("v_app").values[60]).toBeCloseTo(raw("v_app").get(60), 5);
  });

  it("gives a column of one element one quantity, and a vector one per element", () => {
    expect(quantity("winch_force").values[60]).toBeCloseTo(609.8, 1);
    expect(quantity("vel_kite/x").values[60]).toBeCloseTo(-1.234, 3);
    expect(quantity("vel_kite/z").values[60]).toBeCloseTo(0.4807, 3);
  });

  it("leaves out a column every run carries but this one never filled", () => {
    const ids = quantities.map((candidate) => candidate.id);
    for (const unfilled of ["CL2", "CD2", "alpha3", "v_wind_200m/x", "var_01"]) {
      expect(ids).not.toContain(unfilled);
    }
  });

  it("keeps a default panel's line for a run flown without that control", () => {
    const unsteered = runQuantities(withValues(run, ["steering"], () => 0));
    expect(defaultPanels(unsteered)).toContainEqual(["depower", "steering"]);
  });

  it("keeps a vector whole where only one of its elements is zero", () => {
    const flown = withValues(run, ["vel_kite"], (element) => (element === 1 ? 0 : 1));
    expect(runQuantities(flown).map(({ id }) => id)).toContain("vel_kite/y");
  });

  it("offers a filled generic variable under the name its column carries", () => {
    expect(quantity("var_15").label).toBe("var_15");
  });

  it("has no quantity at all for a run of positions only", () => {
    const positionsOnly = decodeRun(runOf(example("v3_psm_structure")));
    expect(runQuantities(positionsOnly)).toEqual([]);
  });
});

describe("kiteAttitude", () => {
  it("reads the identity KA orientation as level, facing west", () => {
    const { roll, pitch, yaw } = kiteAttitude(1, 0, 0, 0);
    expect(roll).toBeCloseTo(0, 12);
    expect(pitch).toBeCloseTo(0, 12);
    expect(yaw).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("has zero yaw facing north and +90 degrees facing east", () => {
    const half = -Math.PI / 4;
    expect(kiteAttitude(Math.cos(half), 0, 0, Math.sin(half)).yaw).toBeCloseTo(0, 12);
    expect(kiteAttitude(0, 0, 0, 1).yaw).toBeCloseTo(Math.PI / 2, 12);
  });

  it("reads a rotation about the east-up plane's normal as pitching the nose up", () => {
    const half = Math.PI / 12;
    const { roll, pitch } = kiteAttitude(Math.cos(half), 0, Math.sin(half), 0);
    expect(roll).toBeCloseTo(0, 12);
    expect(pitch).toBeCloseTo(Math.PI / 6, 12);
  });

  it("has the V3 kite nosing into its wind from the west, pitched up", () => {
    expect(quantity("yaw").unit).toBe("deg");
    expect(quantity("yaw").values[0]).toBeCloseTo(-90, -1);
    expect(quantity("pitch").values[0]).toBeCloseTo(8.76, 1);
    expect(Math.abs(quantity("roll").values[0])).toBeLessThan(5);
  });
});

describe("aerodynamic quantities", () => {
  it("splits the whole aero force into lift and drag", () => {
    for (const frame of [0, 30, 60]) {
      const total = Math.hypot(
        raw("aero_force_KA_x").get(frame).get(0),
        raw("aero_force_KA_y").get(frame).get(0),
        raw("aero_force_KA_z").get(frame).get(0),
      );
      const lift = quantity("lift").values[frame];
      const drag = quantity("drag").values[frame];
      expect(Math.hypot(lift, drag)).toBeCloseTo(total, 0);
    }
  });

  it("has L/D as lift over drag, and CL/CD agreeing with it", () => {
    const frame = 30;
    const ratio = quantity("lift_over_drag").values[frame];
    expect(ratio).toBeCloseTo(quantity("lift").values[frame] / quantity("drag").values[frame], 6);
    expect(quantity("CL").values[frame] / quantity("CD").values[frame]).toBeCloseTo(ratio, 6);
  });

  it("refers CL to the kite's projected canopy and dynamic pressure", () => {
    const frame = 60;
    const speed = raw("v_app").get(frame);
    const force = quantity("lift").values[frame];
    const area = force / (0.5 * 1.225 * speed * speed * quantity("CL").values[frame]);
    expect(area).toBeCloseTo(17.56, 1);
  });

  it("offers no aero quantity for a run that never filled its aero forces", () => {
    const unfilled = withValues(run, ["aero_force_x", "aero_force_y", "aero_force_z"], () => 0);
    const ids = runQuantities(unfilled).map(({ id }) => id);
    for (const aero of ["lift", "drag", "lift_over_drag", "CL", "CD"]) {
      expect(ids).not.toContain(aero);
    }
  });

  it("labels CL and CD as the estimates their assumed density and area make them", () => {
    expect(quantity("CL").label).toBe("CL (estimate)");
    expect(quantity("CD").label).toBe("CD (estimate)");
  });

  it("has no CL or CD without canopy faces to take an area from, but keeps L/D", () => {
    const withoutCanopy = { ...run, topology: { ...run.topology } };
    withoutCanopy.topology.canopy_faces = { ...run.topology.canopy_faces, data: [] };
    const ids = runQuantities(withoutCanopy).map((candidate) => candidate.id);
    expect(ids).toContain("lift_over_drag");
    expect(ids).not.toContain("CL");
  });
});

describe("defaultPanels", () => {
  it("opens on winch force, v_app, AoA, heading/course, tether length, depower/steering", () => {
    expect(defaultPanels(quantities)).toEqual([
      ["winch_force"],
      ["v_app"],
      ["AoA"],
      ["heading", "course"],
      ["l_tether"],
      ["depower", "steering"],
    ]);
  });

  it("gives one line per winch, and no panel where nothing fills it", () => {
    const line = (id: string, column: string): Quantity => ({
      id,
      column,
      label: id,
      unit: "N",
      periodic: false,
      values: new Float64Array(2),
    });
    const twoWinches = [line("winch_force/1", "winch_force"), line("winch_force/2", "winch_force")];
    expect(defaultPanels(twoWinches)).toEqual([["winch_force/1", "winch_force/2"]]);
  });
});

describe("the time cursor", () => {
  it("has the run's time column", () => {
    const times = runTimes(run);
    expect(times[0]).toBe(0);
    expect(times[60]).toBeCloseTo(3, 9);
  });

  it("falls back to frame numbers for a run with no time column", () => {
    const positionsOnly = decodeRun(runOf(example("v3_psm_structure")));
    expect([...runTimes(positionsOnly)]).toEqual([0]);
  });

  it("finds the frame nearest a time, clamped to the run", () => {
    const times = runTimes(run);
    expect(nearestFrame(times, 1.01)).toBe(20);
    expect(nearestFrame(times, 1.04)).toBe(21);
    expect(nearestFrame(times, -5)).toBe(0);
    expect(nearestFrame(times, 99)).toBe(60);
  });
});
