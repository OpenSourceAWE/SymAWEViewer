# Changelog

## Unreleased

### Added

- A run of more than one frame shows a scrubber and 2D panels under the 3D view, on one time cursor with it. The panels open on winch force, apparent wind, AoA, heading/course, tether length and depower/steering, and a list adds the run's other columns, roll, pitch and yaw, lift, drag, L/D and estimated CL and CD. Angles are in degrees.
- `onFrameChange` reports the frame the cursor moved to; `runQuantities`, `defaultPanels`, `runTimes`, `nearestFrame`, `kiteAttitude`, `RunPanels`, `TimePanel` and `Run.table` give the same data for a custom layout.
- A run of more than one frame plays on load at real time and loops, paused under reduced motion; play/pause, speed (0.25×–4×) and Space drive the time cursor.
- A 3 s trail behind the kite, cleared on a seek; `kitePath` and `kitePoints` give the kite's mean position.
- A "follow kite" camera beside orbit; on a touch screen the canvas lets the page scroll and orbits only for a fine pointer.
- A readout of kite speed, height, winch force and time at the cursor.
- `theme` sets ground, grid, fog, trail, unlit materials and text colours; `background` is also the fog colour. `DEFAULT_SCENE` and `resolveScene` give the scene drawn.
- `panels` starts the 2D panels `"open"`, `"collapsed"` or `"hidden"`.

### Fixed

- A log written by SymbolicAWEModels is read: its frames carry panel corners and wing and body origins after the points, which were refused before.

### Changed

- The orbit camera frames the run's first frame and stays put while the cursor moves.
- The kite's height is a panel quantity, so a run of positions only now lists one quantity rather than none.
