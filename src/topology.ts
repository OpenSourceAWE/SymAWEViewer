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

export interface Topology {
  metadata: TopologyMetadata;
  points: TopologyTable;
  segments: TopologyTable;
  tethers: TopologyTable;
  winches: TopologyTable;
  pulleys: TopologyTable;
  wing_sections?: TopologyTable;
}

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
 * Decode both halves of an exported run: the structural topology carried in the
 * Arrow schema metadata, and the world-frame coordinate columns.
 *
 * Refuses files whose declared point count disagrees with the frame arrays,
 * which is what catches a log replayed against a structure it was not recorded
 * with. `source` only labels error messages.
 */
export function decodeRun(
  bytes: ArrayBuffer | Uint8Array,
  source = "run",
): Run {
  const table = tableFromIPC(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
  const raw = table.schema.metadata.get("topology");
  if (!raw) {
    throw new Error(`${source} carries no "topology" metadata`);
  }

  const topology = JSON.parse(raw) as Topology;
  if (topology.metadata.schema !== SUPPORTED_SCHEMA) {
    throw new Error(
      `unsupported schema "${topology.metadata.schema}", ` +
        `this viewer implements ${SUPPORTED_SCHEMA}`,
    );
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
  if (frames.length === 0) {
    throw new Error(`${source} contains no frames`);
  }

  const declared = topology.metadata.n_points;
  if (frames[0].x.length !== declared) {
    throw new Error(
      `point-count mismatch: topology declares ${declared} points but frames ` +
        `carry ${frames[0].x.length}. The log and the structure do not match.`,
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

/**
 * Flat `[x, y, z, ...]` line-segment endpoints for every structural segment,
 * ready for a `LineSegments` buffer.
 *
 * Segments reference points by name; an unresolvable name is a hard error
 * rather than a silently dropped line.
 */
export function segmentPositions(run: Run, frame: Frame): Float32Array {
  const { segments } = run.topology;
  const a = column(segments, "point_a");
  const b = column(segments, "point_b");
  const out = new Float32Array(segments.data.length * 6);

  segments.data.forEach((row, i) => {
    for (const [slot, col] of [
      [0, a],
      [3, b],
    ] as const) {
      const name = row[col] as string;
      const index = run.pointIndex.get(name);
      if (index === undefined) {
        throw new Error(`segment references unknown point "${name}"`);
      }
      out[i * 6 + slot] = frame.x[index];
      out[i * 6 + slot + 1] = frame.y[index];
      out[i * 6 + slot + 2] = frame.z[index];
    }
  });

  return out;
}

/** Flat `[x, y, z, ...]` positions for every point in `frame`. */
export function pointPositions(frame: Frame): Float32Array {
  const out = new Float32Array(frame.x.length * 3);
  for (let i = 0; i < frame.x.length; i++) {
    out[i * 3] = frame.x[i];
    out[i * 3 + 1] = frame.y[i];
    out[i * 3 + 2] = frame.z[i];
  }
  return out;
}
