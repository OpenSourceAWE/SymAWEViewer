# Changelog

## Unreleased

### Added

- A run of more than one frame shows a scrubber and 2D panels under the 3D view, on one time cursor with it. The panels open on winch force, apparent wind, AoA, heading/course, tether length and depower/steering, and a list adds the run's other columns, roll, pitch and yaw, lift, drag, L/D and estimated CL and CD. Angles are in degrees.
- `onFrameChange` reports the frame the cursor moved to; `runQuantities`, `defaultPanels`, `runTimes`, `nearestFrame`, `kiteAttitude`, `RunPanels`, `TimePanel` and `Run.table` give the same data for a custom layout.
- Toggles over the 3D view colour each segment by its spring force, from compression through zero to tension with a legend in N, and draw the aero and drag forces as arrows. `runForces`, `forceColors`, `arrowScale`, `arrowEnds`, `ForceArrowsView` and `ForceControls` give the same for a custom layout, and `palette` takes `compression`, `unloaded`, `tension`, `aero` and `drag`.

### Fixed

- A log written by SymbolicAWEModels is read: its frames carry panel corners and wing and body origins after the points, which were refused before.
- A pan or orbit of the 3D view is kept when the cursor moves; any redraw used to put the camera's target back on the run's centre.

### Changed

- The camera frames the run's first frame and stays put while the cursor moves.
