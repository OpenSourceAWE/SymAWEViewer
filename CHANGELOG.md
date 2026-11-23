# Changelog

## Unreleased

### Added

- A run of one frame lists its quantities as a table of name, value and unit under the 3D view, where a longer run gets the timeline and panels.
- A run's optional `run` metadata key, how it was made, shows under an info button over the scene: its kind, its parameters, the commits it ran from and whatever else it records. It is decoded as `run.provenance`, and `decodeRun` refuses one that is not a JSON object.
- A run of more than one frame shows a scrubber and 2D panels under the 3D view, on one time cursor with it. The panels open on winch force, apparent wind, AoA, heading/course, tether length and depower/steering, and a list adds the run's other columns, roll, pitch and yaw, lift, drag, L/D and estimated CL and CD. Angles are in degrees.
- `onFrameChange` reports the frame the cursor moved to; `runQuantities`, `defaultPanels`, `runTimes`, `nearestFrame`, `kiteAttitude`, `RunPanels`, `TimePanel` and `Run.table` give the same data for a custom layout.

### Fixed

- A log written by SymbolicAWEModels is read: its frames carry panel corners and wing and body origins after the points, which were refused before.

### Changed

- The camera frames the run's first frame and stays put while the cursor moves.
