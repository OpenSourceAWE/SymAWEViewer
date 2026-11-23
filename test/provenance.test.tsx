import { tableFromIPC, tableToIPC } from "apache-arrow";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunInfo } from "../src/SymAWEViewer";
import { decodeRun } from "../src/topology";
import { fixture, V3_RUN } from "./fixtures";

/** A `run` key as the job runner writes it: kind, kite, parameters, job, runner, wall time. */
const PROVENANCE = {
  kind: "steady",
  kite: "v3",
  parameters: { v_wind: 8.5, elevation: 30, model: "psm", axes: [6, 4] },
  job_key: "9f2c41",
  runner_version: {
    packages: { SymbolicAWEModels: "0.9.1" },
    commits: { "OpenSourceAWE/SymbolicAWEModels.jl": "1356f45e0c2b" },
  },
  wall_time: 41.2,
};

/** The V3 run with its `run` metadata key set to `raw`. */
function withRunKey(raw: string): Uint8Array {
  const table = tableFromIPC(fixture(V3_RUN));
  table.schema.metadata.set("run", raw);
  return tableToIPC(table, "file");
}

describe("a run's provenance", () => {
  it("is read from the run metadata key", () => {
    expect(decodeRun(withRunKey(JSON.stringify(PROVENANCE))).provenance).toEqual(PROVENANCE);
  });

  it("is absent from a run without the key", () => {
    expect(decodeRun(fixture(V3_RUN)).provenance).toBeUndefined();
  });

  it("refuses a run key that is not a JSON object, naming it", () => {
    for (const raw of ["kind=steady", "[1,2]", "null"]) {
      expect(() => decodeRun(withRunKey(raw), "v3.arrow")).toThrow(
        `v3.arrow carries "run" metadata that is not a JSON object: ${raw}`,
      );
    }
  });
});

describe("RunInfo", () => {
  const html = renderToStaticMarkup(<RunInfo provenance={PROVENANCE} />);
  const row = (name: string, value: string) => `>${name}</th><td style="color:#d7dae1;vertical-align:top">${value}<`;

  it("opens from an info button", () => {
    expect(html).toMatch(/^<details[^>]*><summary aria-label="how this run was made"/);
  });

  it("heads it with the kind and lists the plain entries", () => {
    expect(html).toContain(">steady</p>");
    expect(html).toContain(row("kite", "v3"));
    expect(html).toContain(row("wall_time", "41.2"));
  });

  it("lists each parameter with its value under parameters", () => {
    expect(html).toContain(">parameters</th>");
    expect(html).toContain(row("v_wind", "8.5"));
    expect(html).toContain(row("model", "psm"));
    expect(html).toContain(row("axes", "[6,4]"));
  });

  it("lists the commits the runner ran from, named by their path", () => {
    expect(html).toContain(">runner_version</th>");
    expect(html).toContain(row("commits/OpenSourceAWE/SymbolicAWEModels.jl", "1356f45e0c2b"));
    expect(html).toContain(row("packages/SymbolicAWEModels", "0.9.1"));
  });

  it("shows only the kind of a run key that gives nothing else", () => {
    const bare = renderToStaticMarkup(<RunInfo provenance={{ kind: "sim" }} />);
    expect(bare).toContain(">sim</p>");
    expect(bare).not.toContain("<tbody");
  });
});
