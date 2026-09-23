import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { CompressionType, MessageReader, tableFromIPC } from "apache-arrow";
import {
  BLOCK_COLUMNS,
  REQUIRED_BLOCKS,
  type AWESystemStructureSchema,
  type Table,
} from "./generated/structure";

/** A `headers`/`data` block of the structure document. */
export type TopologyTable = Table;

/** A structure document as `structure_schema.yml` defines it. */
export type StructureDocument = AWESystemStructureSchema;

/** A decoded structure document, with every block it left out present and empty. */
export type Topology = Required<StructureDocument>;

/** The `metadata` block of a structure document. */
export type TopologyMetadata = Topology["metadata"];

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

/** The `awesIO_version` of the vendored `structure_schema.yml`. */
export const AWESIO_VERSION = "1.0.0";

const ARROW_FILE_MAGIC = "ARROW1";

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

/** The compression of the first record batch in Arrow IPC `bytes`, or null. */
function bodyCompression(bytes: Uint8Array): CompressionType | null {
  const magic = new TextDecoder().decode(bytes.subarray(0, ARROW_FILE_MAGIC.length));
  // The file format is the stream format behind the magic, padded to 8 bytes.
  const reader = new MessageReader(
    magic === ARROW_FILE_MAGIC ? bytes.subarray(8) : bytes,
  );
  for (let message = reader.readMessage(); message; message = reader.readMessage()) {
    if (message.isRecordBatch()) {
      return message.header().compression?.type ?? null;
    }
    reader.readMessageBody(message.bodyLength);
  }
  return null;
}

/** Refuse a document of an unknown major awesIO version, and warn on an unknown minor. */
function checkVersion(version: string, source: string) {
  const [major, minor] = version.split(".").map(Number);
  const [knownMajor, knownMinor] = AWESIO_VERSION.split(".").map(Number);
  if (major !== knownMajor) {
    throw new Error(
      `${source} is written against awesIO ${version}; ` +
        `this viewer reads awesIO ${knownMajor}.x only`,
    );
  }
  if (minor > knownMinor) {
    console.warn(
      `${source} is written against awesIO ${version}, newer than the ` +
        `${AWESIO_VERSION} this viewer implements; what it added is ignored`,
    );
  }
}

/** `document` with its required blocks checked and every absent block read as empty. */
function readBlocks(document: StructureDocument, source: string): Topology {
  for (const name of REQUIRED_BLOCKS) {
    if (!document[name]) {
      throw new Error(`${source} topology is missing required block "${name}"`);
    }
  }
  const topology: Record<string, unknown> = { ...document };
  for (const [name, columns] of Object.entries(BLOCK_COLUMNS)) {
    topology[name] ??= { headers: [...columns], data: [] };
  }
  return topology as Topology;
}

/**
 * The part of the connectivity preimage for one pair of blocks: the number of rows
 * of `nodes`, then the one-based row numbers each `pairs` row joins in `pairColumn`.
 */
function connectivitySection(
  nodes: TopologyTable,
  pairs: TopologyTable,
  pairColumn: string,
  label: string,
) {
  const rowNumber = new Map(
    columnValues<string>(nodes, "name").map((name, i) => [name, i + 1]),
  );
  let section = `${nodes.data.length};`;
  for (const pair of columnValues<[string, string]>(pairs, pairColumn)) {
    const [a, b] = pair.map((name) => rowNumber.get(name));
    if (a === undefined || b === undefined) {
      throw new Error(`${label} names an unknown row in [${pair.join(", ")}]`);
    }
    section += `${a},${b};`;
  }
  return section;
}

/**
 * The `connectivity_sha` `structure_schema.yml` defines, computed from the blocks.
 * `source` only labels error messages.
 */
export function connectivitySha(topology: Topology, source = "topology"): string {
  const { points, segments, bodies, tubes } = topology;
  const preimage =
    connectivitySection(points, segments, "points", `${source} segments`) +
    connectivitySection(bodies, tubes, "bodies", `${source} tubes`);
  return bytesToHex(sha256(utf8ToBytes(preimage)));
}

/**
 * Decode both halves of an exported run: the structure document carried in the
 * Arrow schema metadata, and the world-frame coordinate columns.
 *
 * Refuses a compressed file, an unknown major `awesIO_version`, a document missing
 * a required block, a `connectivity_sha` that disagrees with the blocks, and frames
 * that do not carry one position per point. `source` only labels error messages.
 */
export function decodeRun(
  bytes: ArrayBuffer | Uint8Array,
  source = "run",
): Run {
  const ipc = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const compression = bodyCompression(ipc);
  if (compression !== null) {
    throw new Error(
      `${source} is ${CompressionType[compression]}-compressed, and this viewer ` +
        `reads uncompressed Arrow only. Write the run again without compression.`,
    );
  }

  const table = tableFromIPC(ipc);
  const raw = table.schema.metadata.get("topology");
  if (!raw) {
    throw new Error(`${source} carries no "topology" metadata`);
  }

  const document = JSON.parse(raw) as StructureDocument;
  const topology = readBlocks(document, source);
  checkVersion(topology.metadata.awesIO_version, source);
  const sha = connectivitySha(topology, source);
  if (sha !== topology.metadata.connectivity_sha) {
    throw new Error(
      `${source} declares connectivity_sha ${topology.metadata.connectivity_sha} ` +
        `but its blocks hash to ${sha}: they are not the structure it was written for.`,
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
  if (frames[0].x.length !== topology.points.data.length) {
    throw new Error(
      `${source} frames carry ${frames[0].x.length} positions but its topology ` +
        `has ${topology.points.data.length} points`,
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

/** The index of point `name` into every frame, throwing where `referrer` names none. */
export function pointIndexOf(run: Run, name: string, referrer: string): number {
  const index = run.pointIndex.get(name);
  if (index === undefined) {
    throw new Error(`${referrer} references unknown point "${name}"`);
  }
  return index;
}

/**
 * Flat `[x, y, z, ...]` line-segment endpoints for every structural segment,
 * ready for a `LineSegments` buffer.
 *
 * Segments reference points by name; an unresolvable name is a hard error
 * rather than a silently dropped line.
 */
export function segmentPositions(run: Run, frame: Frame): Float32Array {
  const endpoints = columnValues<[string, string]>(run.topology.segments, "points");
  const out = new Float32Array(endpoints.length * 6);

  endpoints.forEach((pair, i) => {
    pair.forEach((name, end) => {
      const index = pointIndexOf(run, name, "segment");
      out[i * 6 + end * 3] = frame.x[index];
      out[i * 6 + end * 3 + 1] = frame.y[index];
      out[i * 6 + end * 3 + 2] = frame.z[index];
    });
  });

  return out;
}

/** Flat `[x, y, z, ...]` positions in `frame` of the points at `indices`, or of all. */
export function pointPositions(frame: Frame, indices?: number[]): Float32Array {
  const count = indices?.length ?? frame.x.length;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const point = indices ? indices[i] : i;
    out[i * 3] = frame.x[point];
    out[i * 3 + 1] = frame.y[point];
    out[i * 3 + 2] = frame.z[point];
  }
  return out;
}
