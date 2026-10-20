import { tableFromIPC } from "apache-arrow";

/** A `headers`/`data` block, mirroring the structural YAML table dialect. */
export interface TopologyTable {
  headers: string[];
  data: unknown[][];
}

export interface TopologyMetadata {
  name: string;
  description: string;
  note: string;
  awesIO_version: string;
  schema: string;
  n_points: number;
  connectivity_sha: string;
}

/** A structure document; every block but `points` and `segments` is optional. */
export interface Topology {
  metadata: TopologyMetadata;
  points: TopologyTable;
  segments: TopologyTable;
  tethers?: TopologyTable;
  winches?: TopologyTable;
  pulleys?: TopologyTable;
  spanwise_stations?: TopologyTable;
  wings?: TopologyTable;
  canopy_faces?: TopologyTable;
  bodies?: TopologyTable;
  tubes?: TopologyTable;
}

/**
 * World-frame positions of one instant: the points first, then the wings' and
 * the bodies' origins, as KiteUtils logs them.
 */
export interface Frame {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export interface Run {
  topology: Topology;
  frames: Frame[];
  /** Point name to its index into every frame's coordinate arrays. */
  pointIndex: Map<string, number>;
}

/** The schema file this viewer implements. Loading anything else is refused. */
export const SUPPORTED_SCHEMA = "structure_schema.yml";

/** Column `name` of `table` as an index, throwing when the column is absent. */
export function column(table: TopologyTable, name: string): number {
  const index = table.headers.indexOf(name);
  if (index < 0) {
    throw new Error(
      `topology block is missing required column "${name}" ` +
        `(has: ${table.headers.join(", ")})`,
    );
  }
  return index;
}

/** Values of column `name` for every row of `table`. */
export function columnValues<T>(table: TopologyTable, name: string): T[] {
  const index = column(table, name);
  return table.data.map((row) => row[index] as T);
}

/**
 * Decode a run from its bytes: either an exported Arrow run, or a bare structure
 * document as JSON, which becomes a one-frame run at its `pos_ENU` positions.
 *
 * Refuses files whose frames hold more or fewer positions than the structure
 * declares, which is what catches a log replayed against a structure it was not
 * recorded with. `source` only labels error messages.
 */
export function decodeRun(
  bytes: ArrayBuffer | Uint8Array,
  source = "run",
): Run {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = new TextDecoder().decode(view.subarray(0, 64)).trimStart();
  return text.startsWith("{")
    ? decodeStructure(new TextDecoder().decode(view), source)
    : decodeArrowRun(view, source);
}

/**
 * A structure document as a one-frame run, posed at the `pos_ENU` of its points,
 * then its wings, then its bodies.
 */
export function decodeStructure(json: string, source = "structure"): Run {
  const topology = JSON.parse(json) as Topology;
  const positions = [topology.points, topology.wings, topology.bodies].flatMap(
    (block) =>
      block ? columnValues<[number, number, number]>(block, "pos_ENU") : [],
  );
  const frame: Frame = {
    x: Float32Array.from(positions, (pos) => pos[0]),
    y: Float32Array.from(positions, (pos) => pos[1]),
    z: Float32Array.from(positions, (pos) => pos[2]),
  };
  return makeRun(topology, [frame], source);
}

/** The structure in the schema metadata plus the world-frame position columns. */
function decodeArrowRun(bytes: Uint8Array, source: string): Run {
  const table = tableFromIPC(bytes);
  const raw = table.schema.metadata.get("topology");
  if (!raw) {
    throw new Error(`${source} carries no "topology" metadata`);
  }

  const xs = table.getChild("X");
  const ys = table.getChild("Y");
  const zs = table.getChild("Z");
  if (!xs || !ys || !zs) {
    throw new Error(`${source} is missing X/Y/Z coordinate columns`);
  }

  const frames: Frame[] = [];
  for (let i = 0; i < table.numRows; i++) {
    frames.push({
      x: Float32Array.from(xs.get(i) as ArrayLike<number>),
      y: Float32Array.from(ys.get(i) as ArrayLike<number>),
      z: Float32Array.from(zs.get(i) as ArrayLike<number>),
    });
  }
  return makeRun(JSON.parse(raw) as Topology, frames, source);
}

/** Rows in `table`, zero for an absent block. */
function rowCount(table?: TopologyTable): number {
  return table ? table.data.length : 0;
}

/** Check `topology` against its frames and index its points by name. */
function makeRun(topology: Topology, frames: Frame[], source: string): Run {
  if (topology.metadata.schema !== SUPPORTED_SCHEMA) {
    throw new Error(
      `unsupported schema "${topology.metadata.schema}", ` +
        `this viewer implements ${SUPPORTED_SCHEMA}`,
    );
  }
  if (frames.length === 0) {
    throw new Error(`${source} contains no frames`);
  }

  const declared = topology.metadata.n_points;
  const slots = declared + rowCount(topology.wings) + rowCount(topology.bodies);
  if (frames[0].x.length !== slots) {
    throw new Error(
      `position-count mismatch: topology declares ${declared} points plus ` +
        `${slots - declared} wings and bodies but frames carry ` +
        `${frames[0].x.length}. The log and the structure do not match.`,
    );
  }
  if (topology.points.data.length !== declared) {
    throw new Error(
      `point-count mismatch: topology declares ${declared} points but its ` +
        `points block has ${topology.points.data.length} rows.`,
    );
  }

  const names = columnValues<string>(topology.points, "name");
  const pointIndex = new Map(names.map((name, i) => [name, i]));

  return { topology, frames, pointIndex };
}

/**
 * Fetch and decode a run. Pass `init` when the host gates the file, so the
 * viewer never needs to know how a deployment authenticates.
 */
export async function loadRun(url: string, init?: RequestInit): Promise<Run> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`could not fetch ${url}: ${response.status}`);
  }
  return decodeRun(await response.arrayBuffer(), url);
}

/** Write the position of point `name` in `frame` into `out` at `offset`. */
function writePoint(
  run: Run,
  frame: Frame,
  name: string,
  out: Float32Array,
  offset: number,
) {
  const index = run.pointIndex.get(name);
  if (index === undefined) {
    throw new Error(`reference to unknown point "${name}"`);
  }
  out[offset] = frame.x[index];
  out[offset + 1] = frame.y[index];
  out[offset + 2] = frame.z[index];
}

/**
 * Flat `[x, y, z, ...]` line-segment endpoints for every structural segment,
 * ready for a `LineSegments` buffer.
 *
 * Segments reference points by name; an unresolvable name is a hard error
 * rather than a silently dropped line.
 */
export function segmentPositions(run: Run, frame: Frame): Float32Array {
  const ends = columnValues<[string, string]>(run.topology.segments, "points");
  const out = new Float32Array(ends.length * 6);
  ends.forEach(([a, b], i) => {
    writePoint(run, frame, a, out, i * 6);
    writePoint(run, frame, b, out, i * 6 + 3);
  });
  return out;
}

/**
 * Flat `[x, y, z, ...]` triangle corners for every canopy face, a
 * quadrilateral split along its first diagonal, ready for a `Mesh` buffer.
 */
export function canopyPositions(run: Run, frame: Frame): Float32Array {
  const faces = run.topology.canopy_faces;
  if (!faces) return new Float32Array(0);

  const triangles = columnValues<string[]>(faces, "points").flatMap((corners) =>
    corners.length === 4
      ? [
          [corners[0], corners[1], corners[2]],
          [corners[0], corners[2], corners[3]],
        ]
      : [corners],
  );
  const out = new Float32Array(triangles.length * 9);
  triangles.forEach((triangle, i) =>
    triangle.forEach((name, corner) =>
      writePoint(run, frame, name, out, i * 9 + corner * 3),
    ),
  );
  return out;
}

/** Flat `[x, y, z, ...]` positions for every point in `frame`. */
export function pointPositions(run: Run, frame: Frame): Float32Array {
  const count = run.topology.metadata.n_points;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = frame.x[i];
    out[i * 3 + 1] = frame.y[i];
    out[i * 3 + 2] = frame.z[i];
  }
  return out;
}

/** A tube as the two ends of its axis and its diameter [m]. */
export interface TubeAxis {
  start: [number, number, number];
  end: [number, number, number];
  diameter: number;
}

/** Diameter [m] of a tube whose row gives none. */
export const DEFAULT_TUBE_DIAMETER = 0.05;

/**
 * Every tube between the origins of its two bodies in `frame`, which hold the
 * slots behind the points and the wings.
 */
export function tubeAxes(run: Run, frame: Frame): TubeAxis[] {
  const { tubes, bodies, wings } = run.topology;
  if (!tubes || !bodies) return [];

  const offset = run.topology.metadata.n_points + rowCount(wings);
  const bodyNames = columnValues<string>(bodies, "name");
  const bodySlots = new Map(bodyNames.map((name, i) => [name, offset + i]));

  const bodiesColumn = column(tubes, "bodies");
  const diameterColumn = tubes.headers.indexOf("diameter");
  return tubes.data.map((row) => {
    const [a, b] = row[bodiesColumn] as [string, string];
    const diameter = diameterColumn < 0 ? null : (row[diameterColumn] as number);
    return {
      start: bodyOrigin(frame, bodySlots, a),
      end: bodyOrigin(frame, bodySlots, b),
      diameter: diameter ?? DEFAULT_TUBE_DIAMETER,
    };
  });
}

/** Origin of body `name` in `frame`, its slot looked up in `bodySlots`. */
function bodyOrigin(
  frame: Frame,
  bodySlots: Map<string, number>,
  name: string,
): [number, number, number] {
  const slot = bodySlots.get(name);
  if (slot === undefined) {
    throw new Error(`tube references unknown body "${name}"`);
  }
  return [frame.x[slot], frame.y[slot], frame.z[slot]];
}
