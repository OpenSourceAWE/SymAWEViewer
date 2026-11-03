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

## What it draws

Everything is read from the structure document, and nothing is guessed from
names:

- **Segments by role.** A segment of a tether some winch reels is the power
  path; of a tether no winch reels, a tether; one of the pair a pulley trades
  length between, a pulley line; anything else, fixed bridle.
- **Tubes** as cylinders at their `diameter`, between their two bodies, or as
  lines where the file gives no `diameter`. Frames carry points only, so a body
  moves with the mean displacement of the points fixed to it, and a body with
  none with the bodies its tubes join it to.
- **Canopy faces** as a translucent surface over their corners.
- **Each `fixed` point** as a cone: the ground anchor.
- **Bodies and spanwise stations** as groups of points. Clicking a point
  highlights its body, clicking again each station it belongs to.

`palette` recolors any of these; the overlay carries a legend of the roles the
run has.

## Forces

Toggles over the 3D view draw the forces a run carries, at the time cursor, and work on a run of any length. They are all off when a viewer opens, and a force the run does not hold is not offered.

- **Spring force** colours each segment by `spring_force` on a diverging scale: compression, zero, tension. Off, the segments wear their role colours again. The scale spans the same force on both sides of zero, and that force is the 99.9th percentile of the run's magnitudes, so a single spike cannot turn the rest of the flight grey; anything beyond it saturates. The legend gives the scale and the range the run really reaches, in N.
- **Aero and drag force arrows** start at each slot of `aero_force_*` or `drag_force_*` holding a force. All arrows of a run share one length per newton, so they can be compared with each other and across frames, and the legend names the longest of each.

`palette` recolors them through `compression`, `unloaded`, `tension`, `aero` and `drag`.

## Time and panels

A run of more than one frame gets a scrubber and 2D panels under the 3D view, all on one time cursor: drag the scrubber, or click or drag in a panel, to seek. `frame` moves the cursor from the host and `onFrameChange` reports where it went. A run with no `time` column runs its cursor in frame numbers.

The panels open on winch force, apparent wind, AoA, heading/course, tether length and depower/steering, and the list above them adds the run's other named scalar and vector columns and generic variables. Angles are shown in degrees. The list leaves out a column holding only zeros or NaN, unless a default panel opens on it.

Three kinds of quantity are computed rather than read:

- **Roll, pitch and yaw** of the first wing, from its quaternion, as KiteUtils' `euler_KS`: against NED, so a level kite has zero yaw facing north, +90° facing east and -90° facing west.
- **Lift, drag and L/D**, the summed `aero_force_*` split along the apparent wind `v_wind_kite - vel_kite`. Drag is the part along it and lift all the rest, so side force in a turn counts as lift.
- **CL and CD**, labelled as estimates: at an assumed air density of 1.225 kg/m³ and the canopy's area projected along the kite's z axis in the first frame. A run without `canopy_faces` has neither.

The same data is yours to draw in your own layout:

| Export | What it gives |
| --- | --- |
| `runQuantities(run)` | every quantity above, as plain arrays with a label and unit |
| `defaultPanels(quantities)` | the panels a run opens on, as lists of quantity ids |
| `runTimes(run)` | the time of each frame [s], or the frame numbers without a `time` column |
| `nearestFrame(times, time)` | the frame nearest a time |
| `kiteAttitude(w, x, y, z)` | roll, pitch and yaw [rad] of a quaternion |
| `run.table` | the run's Arrow table, for any column not listed |
| `RunPanels`, `TimePanel` | the scrubber and panels, and one panel |
| `runForces(run)` | the spring force and force arrows a run offers |
| `forceColors(forces, limit, palette)` | one frame's spring forces as segment colours, for `Structure`'s `segmentColors` |
| `arrowEnds(arrows, frame, scale)` | one frame's arrows, for `ForceArrowsView` |
| `ForceControls`, `NO_FORCES_SHOWN` | the force toggles with their legends, and all of them off |

For custom chrome, drop `Structure` into your own `Canvas`, with `highlight`
and `onPick` for the groups:

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
  `headers`/`units`/`data` blocks referencing each other by name.
- Columns `X`, `Y`, `Z` hold one world-frame position list per row, one row per
  frame, starting with one position per row of the `points` block. Slots after
  those draw no point.
- `spring_force` holds one force per row of the `segments` block, tension positive.
- `aero_force_*` and `drag_force_*` hold one force per slot of `X`, `Y` and `Z`.
- Any other `KiteUtils` `sysstate.yaml` column feeds the panels.

The document is read against `schema/structure_schema.yml`, vendored from
1-Bart-1/awesIO@99a36e2, awesIO 0.1.0; `pnpm generate` writes its TypeScript
types to `src/generated/`. `decodeRun` refuses an unknown major `awesIO_version`
and warns on an unknown minor, reads an absent optional block as an empty one
and an absent optional column as absent, and refuses a document whose
`connectivity_sha` its own blocks do not hash to.

## Development

```sh
pnpm install
pnpm test        # generates the types, then runs vitest
pnpm typecheck
```

`test/fixtures/v3_psm_sim.arrow` is 3 s of real V3 flight. `scripts/export_v3_fixture.jl`
flies it and `scripts/v3_fixture_document.mjs` brings its document to the vendored schema.

## Versioning

Consumers pin a git tag. The site repo records which viewer tag it was built
against, so a site tag identifies exactly one viewer build.

## License

MIT — see [LICENSE](LICENSE).
