import { readFileSync } from "node:fs";
import {
  Field,
  Float64,
  List,
  Table,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { parse } from "yaml";
import { columnValues, type StructureDocument } from "../src/topology";
import type { Vec3 } from "../src/generated/structure";

export const EXAMPLES = ["v3_psm_structure", "v3_beam_structure"];

export function fixture(name: string): Uint8Array {
  return readFileSync(new URL(`fixtures/${name}`, import.meta.url));
}

export function example(name: string): StructureDocument {
  return parse(new TextDecoder().decode(fixture(`${name}.yml`)));
}

/**
 * An uncompressed run of one frame holding `document` at its written positions,
 * or at `positions` when given.
 */
export function runOf(
  document: StructureDocument,
  positions = columnValues<Vec3>(document.points, "pos_ENU"),
): Uint8Array {
  const axis = (i: number) =>
    vectorFromArray(
      [positions.map((position) => position[i])],
      new List(new Field("item", new Float64())),
    );
  const table = new Table({ X: axis(0), Y: axis(1), Z: axis(2) });
  table.schema.metadata.set("topology", JSON.stringify(document));
  return tableToIPC(table, "file");
}
