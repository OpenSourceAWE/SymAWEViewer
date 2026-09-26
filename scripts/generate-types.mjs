import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";
import { parse } from "yaml";

const SCHEMA = "schema/structure_schema.yml";
const OUT_DIR = new URL("../src/generated/", import.meta.url);

/** The leading columns a table block requires, as the schema lists them. */
function requiredColumns(block) {
  const headers = block.allOf.find((part) => part.properties?.headers);
  return headers.properties.headers.items.map((item) => item.const);
}

const schema = parse(readFileSync(new URL(`../${SCHEMA}`, import.meta.url), "utf8"));
const types = await compile(schema, schema.title, {
  bannerComment: `/* Generated from ${SCHEMA} by scripts/generate-types.mjs. */`,
  additionalProperties: false,
});

const blocks = Object.entries(schema.properties).filter(([name]) => name !== "metadata");
const columns = Object.fromEntries(
  blocks.map(([name, block]) => [name, requiredColumns(block)]),
);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  new URL("structure.ts", OUT_DIR),
  `${types}
/** The blocks a structure document must carry. */
export const REQUIRED_BLOCKS = ${JSON.stringify(schema.required)} as const;

/** Every block the schema defines, with the columns it requires, in order. */
export const BLOCK_COLUMNS = ${JSON.stringify(columns, null, 2)} as const;
`,
);
