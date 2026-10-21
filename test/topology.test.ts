import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  column,
  columnValues,
  connectivitySha,
  decodeRun,
  optionalColumnValues,
  segmentPositions,
  type StructureDocument,
  type Topology,
} from "../src/topology";
import type { NamePair, Vec3 } from "../src/generated/structure";
import { EXAMPLES, example, fixture, runOf, withoutColumn } from "./fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(EXAMPLES)("the awesIO example %s", (name) => {
  const document = example(name);
  const run = decodeRun(runOf(document), name);

  it("decodes with every point and segment", () => {
    expect(run.frames).toHaveLength(1);
    expect(run.frames[0].x).toHaveLength(document.metadata.n_points);
    expect(run.topology.segments.data).toHaveLength(document.segments.data.length);
  });

  it("draws each segment between the points it names", () => {
    const [a, b] = columnValues<NamePair>(document.segments, "points")[0];
    const names = columnValues<string>(document.points, "name");
    const positions = columnValues<Vec3>(document.points, "pos_ENU");
    const at = (point: string) => positions[names.indexOf(point)].map(Math.fround);
    const endpoints = Array.from(segmentPositions(run, run.frames[0]).subarray(0, 6));
    expect(endpoints).toEqual([...at(a), ...at(b)]);
  });
});

describe("decodeRun", () => {
  it("reads an absent optional block as an empty one", () => {
    const { topology } = decodeRun(runOf(example("v3_psm_structure")));
    expect(topology.bodies).toEqual({
      headers: ["name", "pos_ENU", "Q_KA2ENU"],
      units: ["-", "m", "-"],
      data: [],
    });
  });

  it("reads an optional column a block leaves out as absent, not as zero", () => {
    const document = example("v3_beam_structure");
    withoutColumn(document.tubes!, "diameter");
    const { topology } = decodeRun(runOf(document));
    expect(optionalColumnValues(topology.tubes, "diameter")).toBeUndefined();
    expect(optionalColumnValues(topology.segments, "diameter")).toHaveLength(95);
  });

  it("warns on an unknown minor awesIO version and still decodes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const document = example("v3_psm_structure");
    document.metadata.awesIO_version = "0.2.0";
    expect(decodeRun(runOf(document)).frames).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("refuses a run written at awesIO 1.0.0, naming both versions", () => {
    const document = example("v3_psm_structure");
    document.metadata.awesIO_version = "1.0.0";
    expect(() => decodeRun(runOf(document), "old.arrow")).toThrow(
      "old.arrow is written against awesIO 1.0.0; this viewer reads the " +
        "awesIO 0.1.0 schema, and so awesIO 0.x only",
    );
  });

  it("refuses a connectivity_sha its blocks do not hash to", () => {
    const document = example("v3_beam_structure");
    document.tubes!.data.reverse();
    expect(() => decodeRun(runOf(document))).toThrow(/connectivity_sha .* hash to/);
  });

  it("refuses a document missing a required block", () => {
    const document: Partial<StructureDocument> = example("v3_psm_structure");
    delete document.segments;
    expect(() => decodeRun(runOf(document as StructureDocument))).toThrow(
      /missing required block "segments"/,
    );
  });

  it("refuses a document missing its metadata block", () => {
    const document: Partial<StructureDocument> = example("v3_psm_structure");
    delete document.metadata;
    expect(() => decodeRun(runOf(document as StructureDocument))).toThrow(
      /missing required block "metadata"/,
    );
  });

  it("names the file and block of a segment joining an unknown point", () => {
    const document = example("v3_psm_structure");
    const endpoints = column(document.segments, "points");
    (document.segments.data![0] as unknown[])[endpoints] = ["nowhere", "nowhere"];
    expect(() => decodeRun(runOf(document), "psm.arrow")).toThrow(
      /psm\.arrow segments names an unknown row in \[nowhere, nowhere\]/,
    );
  });

  it("refuses frames that do not carry one position per point", () => {
    const document = example("v3_psm_structure");
    const positions = columnValues<Vec3>(document.points, "pos_ENU").slice(1);
    expect(() => decodeRun(runOf(document, positions), "psm.arrow")).toThrow(
      /psm\.arrow frames carry \d+ positions but its topology has \d+ points/,
    );
  });

  it("says in plain words that an LZ4-compressed run cannot be read", () => {
    expect(() => decodeRun(fixture("lz4_compressed.arrow"), "lz4.arrow")).toThrow(
      /lz4\.arrow is LZ4_FRAME-compressed.*uncompressed Arrow only/,
    );
  });
});

describe("connectivitySha", () => {
  it("hashes the preimage structure_schema.yml documents", () => {
    const table = (headers: string[], data: unknown[][]) => ({ headers, data });
    const topology = {
      points: table(["name"], [["a"], ["b"], ["c"]]),
      segments: table(["name", "points"], [["s1", ["a", "b"]], ["s2", ["b", "c"]]]),
      bodies: table(["name"], [["x"], ["y"]]),
      tubes: table(["name", "bodies"], [["t1", ["x", "y"]]]),
      canopy_faces: table(["name", "points"], [["f1", ["a", "b", "c"]]]),
    } as unknown as Topology;
    const preimage = "3;1,2;2,3;2;1,2;1;1,2,3;";
    const expected = createHash("sha256").update(preimage).digest("hex");
    expect(connectivitySha(topology)).toBe(expected);
  });
});
