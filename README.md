# @vandelint/symawe-viewer

Browser viewer for SymbolicAWEModels runs. Reads the `.arrow` files SymAWE
exports: frame columns plus an awesIO structure topology carried in the schema
metadata.

Private package. Consumed by `bart.vandelint.net` and `symawe.com`.

## Use

```tsx
import { SymAWEViewer } from "@vandelint/symawe-viewer";

<div style={{ height: "100dvh" }}>
  <SymAWEViewer src="/sim/v3_beam_pose.arrow" />
</div>;
```

The component fills its parent, brings its own canvas and camera framing, and
depends on no CSS framework. Pass `data` instead of `src` when the host has
already fetched the bytes behind authentication, or `fetchOptions` to let the
component send credentials itself.

For custom chrome, drop `Structure` into your own `Canvas`:

```tsx
import { Structure, framing, loadRun } from "@vandelint/symawe-viewer";
```

## Peer dependencies

`react`, `react-dom`, `three`, `@react-three/fiber` and `@react-three/drei` are
peer dependencies on purpose. A consumer that bundles its own copy of three.js
alongside one from here gets two `THREE` namespaces, and every `instanceof`
check silently fails. Hosts should `resolve.dedupe` all five.

## Run format

A run is one Arrow IPC file, uncompressed — arrow-js does not implement IPC body
decompression, so `compress=:lz4` files will not load in a browser.

- Schema metadata key `topology` holds the structure as JSON, in the
  `headers`/`data` table dialect, referencing points by name.
- Columns `X`, `Y`, `Z` hold one world-frame position list per row, one row per
  frame.

`decodeRun` refuses a file whose declared `n_points` disagrees with the frame
arrays or the points block. That is the check that catches a log replayed
against a structure it was not recorded with.

## Versioning

Consumers pin a git tag. The site repo records which viewer tag it was built
against, so a site tag identifies exactly one viewer build.
