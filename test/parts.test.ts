import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  anchorPoints,
  bodyPositions,
  nextGroup,
  pointGroups,
  pointPick,
  segmentRoles,
  tubeEnds,
  type PointGroup,
} from "../src/parts";
import { tubeMatrices } from "../src/Structure";
import { canopyPositions, column, columnValues, decodeRun } from "../src/topology";
import type { NamePair, Vec3 } from "../src/generated/structure";
import { example, runOf, withoutColumn } from "./fixtures";

function countRoles(roles: string[]) {
  const counts: Record<string, number> = {};
  for (const role of roles) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

describe("segmentRoles", () => {
  it("tells the reeled tether and the pulleys from the fixed bridle", () => {
    const beam = decodeRun(runOf(example("v3_beam_structure"))).topology;
    const psm = decodeRun(runOf(example("v3_psm_structure"))).topology;
    expect(countRoles(segmentRoles(beam))).toEqual({ power: 6, pulley: 40, bridle: 49 });
    expect(countRoles(segmentRoles(psm))).toEqual({ power: 6, pulley: 12, bridle: 50 });
  });

  it("calls a tether no winch reels a tether, not the power path", () => {
    const document = example("v3_psm_structure");
    document.winches!.data = [];
    const { topology } = decodeRun(runOf(document));
    expect(countRoles(segmentRoles(topology))).toEqual({
      tether: 6,
      pulley: 12,
      bridle: 50,
    });
  });
});

describe("anchorPoints", () => {
  it.each([
    ["v3_beam_structure", "ground_anchor"],
    ["v3_psm_structure", "39"],
  ])("anchors %s at its one fixed point", (name, anchor) => {
    const { topology } = decodeRun(runOf(example(name)));
    const names = columnValues<string>(topology.points, "name");
    expect(anchorPoints(topology).map((i) => names[i])).toEqual([anchor]);
  });
});

describe("canopyPositions", () => {
  it("spans each face's corners, a quadrilateral as two triangles", () => {
    const run = decodeRun(runOf(example("v3_beam_structure")));
    const faces = columnValues<string[]>(run.topology.canopy_faces, "points");
    const corners = canopyPositions(run, run.frames[0]);
    const triangles = faces.reduce((sum, face) => sum + face.length - 2, 0);
    expect(corners).toHaveLength(triangles * 9);

    const [a, b, c, d] = faces[0].map((point) => run.pointIndex.get(point)!);
    const at = (i: number) => [run.frames[0].x[i], run.frames[0].y[i], run.frames[0].z[i]];
    const firstTwo = [a, b, c, a, c, d].flatMap(at);
    expect(Array.from(corners.subarray(0, 18))).toEqual(firstTwo);
  });
});

describe("pointGroups", () => {
  const run = decodeRun(runOf(example("v3_beam_structure")));
  const names = columnValues<string>(run.topology.points, "name");

  it("groups the points fixed to each body", () => {
    const bodies = pointGroups(run, "bodies");
    expect(bodies.size).toBe(22);
    expect(bodies.get("wing_le_body_3")!.map((i) => names[i])).toEqual([
      "wing_le_3",
      "wing_ctrl_3_1",
      "bridle_96",
      "bridle_99",
      "bridle_112",
      "bridle_133",
    ]);
  });

  it("has no group for a body no point is fixed to", () => {
    const document = example("v3_beam_structure");
    const bridle = columnValues<string>(document.points, "name").indexOf("bridle_3");
    (document.points.data![bridle] as unknown[])[column(document.points, "body")] = null;
    const bodies = pointGroups(decodeRun(runOf(document)), "bodies");
    expect(bodies.has("wing_le_sub_body_1_1")).toBe(false);
  });

  it("groups the points of each station in the order it lists them", () => {
    const flap = pointGroups(run, "spanwise_stations").get("flap_1")!;
    expect(flap).toHaveLength(13);
    expect(flap.slice(0, 2).map((i) => names[i])).toEqual(["wing_le_1", "wing_te_1"]);
  });
});

describe("picking a point", () => {
  const run = decodeRun(runOf(example("v3_beam_structure")));
  const index = columnValues<string>(run.topology.points, "name").indexOf("wing_te_7");
  const pick = pointPick(run, index);
  const body: PointGroup = { block: "bodies", name: "wing_te_body_7" };
  const station: PointGroup = { block: "spanwise_stations", name: "flap_7" };

  it("names the point's body first, then its stations", () => {
    expect(pick).toEqual({ point: "wing_te_7", groups: [body, station] });
  });

  it("steps from nothing to the body, through each station, and back", () => {
    expect(nextGroup(pick, null)).toEqual(body);
    expect(nextGroup(pick, body)).toEqual(station);
    expect(nextGroup(pick, station)).toEqual(body);
    expect(nextGroup(pick, { block: "spanwise_stations", name: "flap_1" })).toEqual(body);
  });

  it("has nothing to highlight for a point in no group", () => {
    expect(nextGroup({ point: "loose", groups: [] }, null)).toBeNull();
  });
});

describe("bodyPositions", () => {
  const document = example("v3_beam_structure");
  const shift = [1, -2, 3];
  const moved = columnValues<Vec3>(document.points, "pos_ENU").map(
    (position) => position.map((value, i) => value + shift[i]) as Vec3,
  );
  const run = decodeRun(runOf(document, moved));

  it("carries every body along with the points that place it", () => {
    const placed = bodyPositions(run, run.frames[0]);
    columnValues<Vec3>(document.bodies!, "pos_ENU").forEach((position, body) => {
      position.forEach((value, i) => {
        expect(placed[body * 3 + i]).toBeCloseTo(value + shift[i], 3);
      });
    });
  });

  it("stands each tube between its two bodies at its own diameter", () => {
    const placed = bodyPositions(run, run.frames[0]);
    const bodyNames = columnValues<string>(run.topology.bodies, "name");
    const at = (name: string) =>
      new THREE.Vector3().fromArray(placed, bodyNames.indexOf(name) * 3);
    const [first] = tubeMatrices(run, run.frames[0]);
    const [a, b] = columnValues<NamePair>(run.topology.tubes, "bodies")[0];
    const diameter = columnValues<number>(run.topology.tubes, "diameter")[0];

    const end = (y: number) => new THREE.Vector3(0, y, 0).applyMatrix4(first);
    expect(end(-0.5).distanceTo(at(a))).toBeLessThan(1e-3);
    expect(end(0.5).distanceTo(at(b))).toBeLessThan(1e-3);
    const scale = new THREE.Vector3().setFromMatrixScale(first);
    expect(scale.x).toBeCloseTo(diameter, 6);
    expect(scale.z).toBeCloseTo(diameter, 6);
  });

  it("draws tubes that carry no diameter as lines, not as cylinders", () => {
    const bare = example("v3_beam_structure");
    withoutColumn(bare.tubes!, "diameter");
    const lines = decodeRun(runOf(bare, moved));
    expect(tubeMatrices(lines, lines.frames[0])).toEqual([]);
    expect(tubeEnds(lines, lines.frames[0])).toEqual(tubeEnds(run, run.frames[0]));
  });
});
