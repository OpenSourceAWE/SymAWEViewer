import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ForceControls, NO_FORCES_SHOWN } from "../src/ForceControls";
import {
  arrowMatrices,
  DEFAULT_PALETTE,
  forceColors,
  resolvePalette,
} from "../src/Structure";
import { arrowEnds, arrowScale, runForces, type RunForces } from "../src/quantities";
import { columnValues, decodeRun, type Run } from "../src/topology";
import type { Vec3 } from "../src/generated/structure";
import { example, fixture, runOf, V3_RUN } from "./fixtures";

const run = decodeRun(fixture(V3_RUN));
const forces = runForces(run);
const palette = resolvePalette();

/** Each row of list column `name`, as the log holds it. */
function rows(name: string): Float32Array[] {
  const column = run.table.getChild(name)!;
  return Array.from({ length: run.table.numRows }, (_, frame) => column.get(frame).toArray());
}

function rgbOf(hex: string): number[] {
  const { r, g, b } = new THREE.Color(hex);
  return [r, g, b];
}

function expectRgb(actual: ArrayLike<number>, hex: string) {
  rgbOf(hex).forEach((channel, i) => expect(actual[i]).toBeCloseTo(channel, 4));
}

const document = example("v3_psm_structure");
const segmentCount = document.segments.data.length;
const pointCount = document.points.data.length;

/** The one-frame run of `document` with `columns` added. */
function oneFrameWith(columns: Record<string, number[]>): Run {
  return decodeRun(runOf(document, undefined, columns));
}

const filled = (count: number, value = 0) => new Array<number>(count).fill(value);

describe("spring force of the V3 run", () => {
  it("has a force per segment of every frame, with tension positive", () => {
    const { rows: forceRows } = forces.spring!;
    expect(forceRows).toHaveLength(61);
    expect(forceRows[30]).toHaveLength(95);
    const names = columnValues<string>(run.topology.segments, "name");
    const winch = rows("winch_force")[30][0];
    expect(winch).toBeGreaterThan(0);
    expect(forceRows[30][names.indexOf("1_seg_6")]).toBeCloseTo(winch, 3);
  });

  it("reports the whole range of the run in N", () => {
    expect(forces.spring!.min).toBeCloseTo(-5593.36, 1);
    expect(forces.spring!.max).toBeCloseTo(700.93, 1);
  });

  it("keeps the flight readable when one frame holds a far larger force", () => {
    const { limit, rows: forceRows } = forces.spring!;
    expect(limit).toBeLessThan(5593 / 5);
    const strongest = Math.max(...Array.from(forceRows[30], Math.abs));
    expect(strongest / limit).toBeGreaterThan(0.8);
  });
});

describe("forceColors", () => {
  it("runs from compression through zero to tension, and saturates beyond the limit", () => {
    const colors = forceColors([-650, 0, 650, -5593, 5593], 650, palette);
    const segment = (i: number) => colors.subarray(i * 6, i * 6 + 3);
    expectRgb(segment(0), palette.compression);
    expectRgb(segment(1), palette.unloaded);
    expectRgb(segment(2), palette.tension);
    expectRgb(segment(3), palette.compression);
    expectRgb(segment(4), palette.tension);
  });

  it("gives equal forces of either sign the same share of the scale", () => {
    const poles = resolvePalette({
      compression: "#ff0000",
      unloaded: "#000000",
      tension: "#00ff00",
    });
    const colors = forceColors([-100, 100], 200, poles);
    expect(colors[0]).toBeGreaterThan(0);
    expect(colors[0]).toBeCloseTo(colors[7], 6);
  });

  it("colours both ends of a segment alike", () => {
    const colors = forceColors([123], 650, palette);
    expect(Array.from(colors.subarray(0, 3))).toEqual(Array.from(colors.subarray(3, 6)));
  });

  it("draws a force the log does not know as unloaded rather than black", () => {
    expectRgb(forceColors([Number.NaN], 650, palette).subarray(0, 3), palette.unloaded);
  });

  it("honours a palette that overrides the scale's colors", () => {
    const custom = resolvePalette({ tension: "#00ff00" });
    expectRgb(forceColors([650], 650, custom).subarray(0, 3), "#00ff00");
    expect(DEFAULT_PALETTE.tension).not.toBe("#00ff00");
  });
});

describe("force arrows of the V3 run", () => {
  const [aero, drag] = forces.arrows;
  const scale = 0.1;

  it("offers the aero and the drag force, in that order", () => {
    expect(forces.arrows.map(({ key }) => key)).toEqual(["aero", "drag"]);
  });

  it("draws one arrow per slot holding a force", () => {
    expect(arrowEnds(aero, 30, scale).length / 6).toBe(20);
    expect(arrowEnds(drag, 30, scale).length / 6).toBe(pointCount);
  });

  it("starts each arrow on its point and points it along the logged force", () => {
    const [x, y, z] = ["x", "y", "z"].map((axis) => rows(`drag_force_${axis}`)[30]);
    const ends = arrowEnds(drag, 30, scale);
    const frame = run.frames[30];
    for (let point = 0; point < pointCount; point++) {
      const at = point * 6;
      expect(ends[at]).toBeCloseTo(frame.x[point], 3);
      expect(ends[at + 1]).toBeCloseTo(frame.y[point], 3);
      expect(ends[at + 2]).toBeCloseTo(frame.z[point], 3);
      expect(ends[at + 3] - ends[at]).toBeCloseTo(x[point] * scale, 3);
      expect(ends[at + 4] - ends[at + 1]).toBeCloseTo(y[point] * scale, 3);
      expect(ends[at + 5] - ends[at + 2]).toBeCloseTo(z[point] * scale, 3);
    }
  });

  it("knows the largest force of each over the run [N]", () => {
    expect(aero.largest).toBeCloseTo(179, 0);
    expect(drag.largest).toBeCloseTo(58.3, 0);
  });
});

describe("arrows of any run", () => {
  it("makes the longest arrow of a run the same share of its span", () => {
    expect(arrowScale(forces, 100) * forces.arrows[0].largest).toBeCloseTo(6, 6);
  });

  it("gives a run without arrows no scale", () => {
    expect(arrowScale({ arrows: [] }, 100)).toBe(0);
  });

  it("draws a force on a slot behind the points from that slot's position", () => {
    const positions = columnValues<Vec3>(document.points, "pos_ENU");
    const slots: Vec3[] = [...positions, [1, 2, 3]];
    const axis = [...filled(pointCount), 10];
    const behind = decodeRun(
      runOf(document, slots, { drag_force_x: axis, drag_force_y: axis, drag_force_z: axis }),
    );
    const [drag] = runForces(behind).arrows;
    expect(Array.from(arrowEnds(drag, 0, 0.5))).toEqual([1, 2, 3, 6, 7, 8]);
  });
});

describe("arrowMatrices", () => {
  const tipOfCone = new THREE.Vector3(0, 0.5, 0);
  const baseOfShaft = new THREE.Vector3(0, -0.5, 0);
  const ends = new Float32Array([1, 2, 3, 1, 2, 13]);

  it("runs the shaft from the arrow's start and puts the head's tip on its end", () => {
    const { shafts, heads } = arrowMatrices(ends, 0.1, 1);
    const start = baseOfShaft.clone().applyMatrix4(shafts[0]).toArray();
    const tip = tipOfCone.clone().applyMatrix4(heads[0]).toArray();
    [1, 2, 3].forEach((value, i) => expect(start[i]).toBeCloseTo(value, 5));
    [1, 2, 13].forEach((value, i) => expect(tip[i]).toBeCloseTo(value, 5));
  });

  it("keeps a short arrow's head inside the arrow", () => {
    const short = new Float32Array([0, 0, 0, 0, 0, 0.5]);
    const { heads } = arrowMatrices(short, 0.1, 1);
    const base = baseOfShaft.clone().applyMatrix4(heads[0]);
    expect(base.z).toBeCloseTo(0.25, 5);
  });
});

describe("what a run offers", () => {
  it("offers no force on a run without the columns", () => {
    const none = runForces(decodeRun(runOf(document)));
    expect(none).toEqual({ arrows: [] });
    expect(
      renderToStaticMarkup(
        <ForceControls
          forces={none}
          shown={NO_FORCES_SHOWN}
          palette={palette}
          onChange={() => {}}
        />,
      ),
    ).toBe("");
  });

  it("does not offer a spring force holding only zeros", () => {
    const empty = oneFrameWith({ spring_force: filled(segmentCount) });
    expect(runForces(empty).spring).toBeUndefined();
  });

  it("does not offer a spring force whose rows do not match the segments", () => {
    const short = oneFrameWith({ spring_force: filled(segmentCount - 1, 5) });
    expect(runForces(short).spring).toBeUndefined();
  });

  it("does not offer an arrow missing an axis, or holding only zeros", () => {
    const partial = oneFrameWith({
      aero_force_x: filled(pointCount, 1),
      aero_force_y: filled(pointCount, 1),
      drag_force_x: filled(pointCount),
      drag_force_y: filled(pointCount),
      drag_force_z: filled(pointCount),
    });
    expect(runForces(partial).arrows).toEqual([]);
  });

  it("does not offer an arrow with more slots than the frames have positions", () => {
    const axis = filled(pointCount + 1, 1);
    const long = oneFrameWith({ drag_force_x: axis, drag_force_y: axis, drag_force_z: axis });
    expect(runForces(long).arrows).toEqual([]);
  });

  it("offers forces on a one-frame run", () => {
    const steady = oneFrameWith({ spring_force: filled(segmentCount, 5) });
    expect(runForces(steady).spring!.limit).toBe(5);
  });
});

describe("ForceControls", () => {
  const render = (shown: Partial<typeof NO_FORCES_SHOWN>, offered: RunForces = forces) =>
    renderToStaticMarkup(
      <ForceControls
        forces={offered}
        shown={{ ...NO_FORCES_SHOWN, ...shown }}
        palette={palette}
        onChange={() => {}}
      />,
    );

  it("offers a toggle per force of the run, all off by default", () => {
    const html = render({});
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain("checked");
    for (const label of ["spring force", "aero force arrows", "drag force arrows"]) {
      expect(html).toContain(label);
    }
  });

  it("gives no legend for a force that is switched off", () => {
    const html = render({});
    expect(html).not.toContain("compression");
    expect(html).not.toContain("longest");
  });

  it("gives the diverging scale and the run's range in N with spring force on", () => {
    const html = render({ spring: true });
    expect(html).toContain("compression");
    expect(html).toContain("tension");
    expect(html).toContain(`-${Math.round(forces.spring!.limit)} N`);
    expect(html).toContain(`+${Math.round(forces.spring!.limit)} N`);
    expect(html).toContain("-5593");
    expect(html).toContain("701");
  });

  it("names the longest arrow in N with arrows on", () => {
    expect(render({ aero: true })).toContain("longest 179 N");
    expect(render({ drag: true })).toContain("longest 58 N");
  });

  it("leaves out a toggle the run has nothing for", () => {
    const html = render({}, { arrows: forces.arrows.slice(0, 1) });
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).not.toContain("spring force");
  });
});
