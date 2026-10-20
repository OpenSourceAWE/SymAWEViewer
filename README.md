# @symawe/viewer

> **Work in progress.** Early and unstable. The component API, the run format
> and the package name all change without notice, and there are no tests yet.
> Not on npm — pin a git tag if you depend on it.

Browser viewer for AWE systems described in awesIO's structure schema: the
`.arrow` logs SymAWE exports, or a structure document on its own.

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

A run is either an Arrow IPC log or a bare structure document; `decodeRun` tells
them apart from the first bytes. Both follow awesIO's `structure_schema.yml`:
`headers`/`data` tables, every reference by name.

- **Arrow log**, uncompressed — arrow-js does not implement IPC body
  decompression, so `compress=:lz4` files will not load in a browser. Schema
  metadata key `topology` holds the structure as JSON. Columns `X`, `Y`, `Z`
  hold one world-frame position list per row, one row per frame: the points
  first, then the origins of the wings and of the bodies, as KiteUtils logs
  them.
- **Structure document** as JSON: a one-frame run posed at the `pos_ENU` of its
  points, wings and bodies.

Tubes are drawn between the origins of their two bodies, so they move with the
bodies in a log.

`decodeRun` refuses a file whose frame length disagrees with `n_points` plus the
wings and bodies, or whose points block disagrees with `n_points`. That is the
check that catches a log replayed against a structure it was not recorded with.

## Versioning

Consumers pin a git tag. The site repo records which viewer tag it was built
against, so a site tag identifies exactly one viewer build.

## License

MIT — see [LICENSE](LICENSE).
