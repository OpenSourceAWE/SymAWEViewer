# @symawe/viewer

> **Work in progress.** Early and unstable. The component API, the run format
> and the package name all change without notice. Not on npm — pin a git tag
> if you depend on it.

Browser viewer for SymbolicAWEModels runs. Reads the `.arrow` files SymAWE
exports: frame columns plus an awesIO structure topology carried in the schema
metadata.

Consumed by `symawe.com`.

## Use

```tsx
import { SymAWEViewer } from "@symawe/viewer";

<div style={{ height: "100dvh" }}>
  <SymAWEViewer src="/sim/v3_beam_pose.arrow" />
</div>;
```

**Size the parent, not the viewer.** The component sets `height: 100%` inline,
which a `className` cannot override — so `<SymAWEViewer className="h-dvh" />`
collapses to nothing. Give the wrapper the height, or pass `style`, which does
win. It warns on the console when it lands in a zero-height box.

It brings its own canvas and camera framing, and depends on no CSS framework.
Pass `data` instead of `src` when the host has already fetched the bytes behind
authentication, or `fetchOptions` to let the component send credentials itself.

For custom chrome, drop `Structure` into your own `Canvas`:

```tsx
import { framing, loadRun, Structure } from "@symawe/viewer";
```

## Peer dependencies

`react`, `react-dom`, `three`, `@react-three/fiber` and `@react-three/drei` are
peer dependencies on purpose. A consumer that bundles its own copy of three.js
alongside one from here gets two `THREE` namespaces, and every `instanceof`
check silently fails. Hosts should `resolve.dedupe` all five.

## Run format

A run is one Arrow IPC file, uncompressed. `decodeRun` refuses a compressed one
by name: arrow-js decodes only codecs the host registers, and this viewer
registers none.

- Schema metadata key `topology` holds an awesIO structure document as JSON:
  `headers`/`data` blocks referencing each other by name.
- Columns `X`, `Y`, `Z` hold one world-frame position list per row, one row per
  frame, one position per row of the `points` block.

The document is read against `schema/structure_schema.yml`, vendored from
1-Bart-1/awesIO@2568e27; `pnpm generate` writes its TypeScript types to
`src/generated/`. `decodeRun` refuses an unknown major `awesIO_version` and
warns on an unknown minor, reads an absent optional block as an empty one, and
refuses a document whose `connectivity_sha` its own blocks do not hash to.

## Development

```sh
pnpm install
pnpm test        # generates the types, then runs vitest
pnpm typecheck
```

## Versioning

Consumers pin a git tag. The site repo records which viewer tag it was built
against, so a site tag identifies exactly one viewer build.

## License

MIT — see [LICENSE](LICENSE).
