import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bodyPositions, pointGroups, segmentRoles } from "../src/parts";
import { tubeMatrices } from "../src/Structure";
import { columnValues, decodeRun } from "../src/topology";
import type { NamePair, Vec3 } from "../src/generated/structure";
import { example, runOf } from "./fixtures";

function countRoles(roles: string[]) {
  const counts: Record<string, number> = {};
  for (const role of roles) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

describe("segmentRoles", () => {
  it("tells the reeled tether and the pulleys from the fixed bridle", () => {
    const beam = decodeRun(runOf(example("v3_beam_structure"))).topology;
    const psm = decodeRun(runOf(example("v3_psm_structure"))).topology;
    expect(countRoles(segmentRoles(beam))).toEqual({ power: 6, pulley: 40, bridle: 320 });
    expect(countRoles(segmentRoles(psm))).toEqual({ power: 6, pulley: 12, bridle: 77 });
  });

  it("calls a tether no winch reels a tether, not the power path", () => {
    const document = example("v3_psm_structure");
    document.winches!.data = [];
    const { topology } = decodeRun(runOf(document));
    expect(countRoles(segmentRoles(topology))).toEqual({ tether: 6, pulley: 12, bridle: 77 });
  });
});

describe("pointGroups", () => {
  const run = decodeRun(runOf(example("v3_beam_structure")));
  const names = columnValues<string>(run.topology.points, "name");

  it("groups the points fixed to each body", () => {
    const bodies = pointGroups(run, "bodies");
    expect(bodies.get("1")).toHaveLength(150);
    expect(bodies.get("wing_le_body_3")!.map((i) => names[i])).toEqual(["wing_le_3"]);
    expect(bodies.has("wing_le_sub_body_1_1")).toBe(false);
  });

  it("groups the points of each station in the order it lists them", () => {
    const flap = pointGroups(run, "stations").get("flap_1")!;
    expect(flap).toHaveLength(13);
    expect(flap.slice(0, 2).map((i) => names[i])).toEqual(["wing_le_1", "wing_te_1"]);
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
});
