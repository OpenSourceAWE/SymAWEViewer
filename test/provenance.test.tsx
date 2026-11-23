import { tableFromIPC, tableToIPC } from "apache-arrow";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunInfo } from "../src/SymAWEViewer";
import { decodeRun } from "../src/topology";
import { fixture, V3_RUN } from "./fixtures";

const PROVENANCE = {
  kind: "simulation",
  parameters: { v_wind: 8.5, duration: 3, model: "psm", segments: [6, 4] },
  commits: { "OpenSourceAWE/SymbolicAWEModels.jl": "1356f45e0c2b" },
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

  it("refuses a run key that is not JSON, naming it", () => {
    expect(() => decodeRun(withRunKey("kind=simulation"), "v3.arrow")).toThrow(
      'v3.arrow carries "run" metadata that is not JSON: kind=simulation',
    );
  });
});

describe("RunInfo", () => {
  const html = renderToStaticMarkup(<RunInfo provenance={PROVENANCE} />);

  it("opens from an info button", () => {
    expect(html).toMatch(/^<details[^>]*><summary aria-label="how this run was made"/);
  });

  it("lists the kind, each parameter with its value, and each commit", () => {
    expect(html).toContain(">simulation<");
    expect(html).toContain(">v_wind</th><td");
    expect(html).toContain(">8.5<");
    expect(html).toContain(">psm<");
    expect(html).toContain(">[6,4]<");
    expect(html).toContain(">OpenSourceAWE/SymbolicAWEModels.jl</th>");
    expect(html).toContain(">1356f45e0c2b<");
  });

  it("leaves out a section the run does not give", () => {
    const bare = renderToStaticMarkup(<RunInfo provenance={{ kind: "flight log" }} />);
    expect(bare).toContain(">flight log<");
    expect(bare).not.toContain("<tbody");
  });
});
