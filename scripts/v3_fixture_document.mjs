// node scripts/v3_fixture_document.mjs <log.arrow>: the fixture run, its document at awesIO 0.1.0.
import { readFileSync, writeFileSync } from "node:fs";
import { tableFromIPC, tableToIPC } from "apache-arrow";
import { createServer } from "vite";
import { parse } from "yaml";

const table = tableFromIPC(readFileSync(process.argv[2]));
const log = JSON.parse(table.schema.metadata.get("topology"));
// The source of the canopy faces, its point names being the log's.
const example = parse(readFileSync("test/fixtures/v3_psm_structure.yml", "utf8"));

/** Block `name` of the log in its row order, with `columns` (written header to log header). */
function block(name, columns, transform = {}) {
  const source = log[name];
  const headers = Object.keys(columns);
  const unit = (header) => source.units[source.headers.indexOf(columns[header])];
  return {
    headers,
    units: headers.map(unit),
    data: source.data.map((row) =>
      headers.map((header) => {
        const value = row[source.headers.indexOf(columns[header])];
        return transform[header] ? transform[header](value) : value;
      }),
    ),
  };
}

const named = (...headers) => Object.fromEntries(headers.map((header) => [header, header]));
const frame = block("bodies", named("pos_ENU", "Q_KA_to_ENU")).data[0];
const document = {
  metadata: {
    ...log.metadata,
    awesIO_version: "0.1.0",
    note:
      "A short flight of OpenSourceAWE/V3Kite.jl@fd73944 data/system_psm.yaml, its document " +
      "rewritten from awesIO 1.0.0 by scripts/v3_fixture_document.mjs.",
  },
  points: block(
    "points",
    { name: "name", fixed: "type", body: "body", pos_ENU: "pos_ENU", extra_mass: "extra_mass" },
    { fixed: (type) => type === "STATIC" },
  ),
  segments: block("segments", {
    ...named("name", "points"),
    rest_length: "l0",
    diameter: "diameter",
  }),
  spanwise_stations: block("stations", named("name", "wing", "points")),
  pulleys: block("pulleys", named("name", "segments", "efficiency")),
  tethers: block("tethers", named("name", "start_point", "end_point", "segments")),
  winches: block("winches", named("name", "tethers", "winch_point", "gear_ratio", "drum_radius")),
  wings: {
    headers: ["name", "pos_ENU", "Q_KA2ENU"],
    units: ["-", "m", "-"],
    data: [[log.wings.data[0][0], ...frame]],
  },
  canopy_faces: example.canopy_faces,
};

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { connectivitySha } = await vite.ssrLoadModule("/src/topology.ts");
document.metadata.connectivity_sha = connectivitySha(
  {
    ...document,
    bodies: { headers: ["name"], data: [] },
    tubes: { headers: ["bodies"], data: [] },
  },
  "fixture",
);
await vite.close();

table.schema.metadata.set("topology", JSON.stringify(document));
writeFileSync("test/fixtures/v3_psm_sim.arrow", tableToIPC(table, "file"));
