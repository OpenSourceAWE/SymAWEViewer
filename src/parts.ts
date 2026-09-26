import {
  columnValues,
  pointIndexOf,
  type Frame,
  type Run,
  type Topology,
} from "./topology";
import type {
  NameList,
  NamePair,
  OptionalName,
  Vec3,
} from "./generated/structure";

/**
 * What a segment is in the system: part of a tether a winch reels (`power`), of a
 * tether no winch reels (`tether`), one of the pair a pulley trades length between
 * (`pulley`), or fixed bridle (`bridle`).
 */
export type SegmentRole = "power" | "tether" | "pulley" | "bridle";

/** The role of every row of the `segments` block, in row order. */
export function segmentRoles(topology: Topology): SegmentRole[] {
  const role = new Map<string, SegmentRole>();
  for (const pair of columnValues<NamePair>(topology.pulleys, "segments")) {
    for (const segment of pair) role.set(segment, "pulley");
  }
  const reeled = new Set(columnValues<NameList>(topology.winches, "tethers").flat());
  const tethers = columnValues<string>(topology.tethers, "name");
  columnValues<NameList>(topology.tethers, "segments").forEach((segments, i) => {
    for (const segment of segments) {
      role.set(segment, reeled.has(tethers[i]) ? "power" : "tether");
    }
  });
  return columnValues<string>(topology.segments, "name").map(
    (name) => role.get(name) ?? "bridle",
  );
}

/** The blocks whose rows group points: the points fixed to a body, or a station's. */
export type PointGroupBlock = "bodies" | "stations";

/** A body's or a station's points, named by the block and row they come from. */
export interface PointGroup {
  block: PointGroupBlock;
  name: string;
}

/**
 * Each body's or each station's name to the indices of its points, in the order
 * the document lists them. A body no point is fixed to has no entry.
 */
export function pointGroups(run: Run, block: PointGroupBlock): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  const { points, stations } = run.topology;
  if (block === "bodies") {
    columnValues<OptionalName>(points, "body").forEach((body, point) => {
      if (body === null) return;
      const group = groups.get(body) ?? [];
      group.push(point);
      groups.set(body, group);
    });
    return groups;
  }
  const names = columnValues<string>(stations, "name");
  columnValues<NameList>(stations, "points").forEach((members, i) => {
    groups.set(
      names[i],
      members.map((point) => pointIndexOf(run, point, `station ${names[i]}`)),
    );
  });
  return groups;
}

/** A clicked point, with the body and the stations it belongs to. */
export interface PointPick {
  point: string;
  groups: PointGroup[];
}

/** The point at `index` with the groups it belongs to, its body first. */
export function pointPick(run: Run, index: number): PointPick {
  const body = columnValues<OptionalName>(run.topology.points, "body")[index];
  const groups: PointGroup[] = body === null ? [] : [{ block: "bodies", name: body }];
  for (const [name, members] of pointGroups(run, "stations")) {
    if (members.includes(index)) groups.push({ block: "stations", name });
  }
  return { point: columnValues<string>(run.topology.points, "name")[index], groups };
}

/**
 * The group after `current` among those of `pick`: its body, then each station, then
 * its body again; the first of them when `current` is not one of them.
 */
export function nextGroup(
  pick: PointPick,
  current: PointGroup | null,
): PointGroup | null {
  const at = pick.groups.findIndex(
    (group) => group.block === current?.block && group.name === current?.name,
  );
  return pick.groups[(at + 1) % pick.groups.length] ?? null;
}

/** Each body's name to its row in the `bodies` block. */
export function bodyRows(run: Run): Map<string, number> {
  return new Map(
    columnValues<string>(run.topology.bodies, "name").map((name, i) => [name, i]),
  )
}

/** The mean of `vectors`, or null when there are none. */
function mean(vectors: Vec3[]): Vec3 | null {
  if (vectors.length === 0) return null;
  const sum: Vec3 = [0, 0, 0];
  for (const vector of vectors) {
    for (let axis = 0; axis < 3; axis++) sum[axis] += vector[axis];
  }
  return sum.map((value) => value / vectors.length) as Vec3;
}

/**
 * Flat `[x, y, z, ...]` positions of every body in `frame`: its document position
 * moved by the mean displacement of the points fixed to it, or, for a body with
 * none, by the mean displacement of the bodies its tubes join it to.
 */
export function bodyPositions(run: Run, frame: Frame): Float32Array {
  const { points, bodies, tubes } = run.topology;
  const names = columnValues<string>(bodies, "name");
  const fixed = pointGroups(run, "bodies");
  const reference = columnValues<Vec3>(points, "pos_ENU");
  const own = names.map((name) =>
    mean(
      (fixed.get(name) ?? []).map((i): Vec3 => [
        frame.x[i] - reference[i][0],
        frame.y[i] - reference[i][1],
        frame.z[i] - reference[i][2],
      ]),
    ),
  );

  const row = bodyRows(run);
  const neighbours: Vec3[][] = names.map(() => []);
  for (const [a, b] of columnValues<NamePair>(tubes, "bodies")) {
    const [i, j] = [row.get(a)!, row.get(b)!];
    if (own[j]) neighbours[i].push(own[j]);
    if (own[i]) neighbours[j].push(own[i]);
  }

  const out = new Float32Array(names.length * 3);
  columnValues<Vec3>(bodies, "pos_ENU").forEach((position, i) => {
    const displacement = own[i] ?? mean(neighbours[i]) ?? [0, 0, 0];
    position.forEach((value, axis) => {
      out[i * 3 + axis] = value + displacement[axis];
    });
  });
  return out;
}
