# Changelog

## Unreleased

### Added

- `SweepView` draws a chosen quantity at the last frame of each run of a sweep against each parameter that varies: one panel per parameter, with a curve for each combination of the others. Clicking a point calls `onOpen` with it. `sweepQuantities`, `sweepAxes` and `axisCurves` give the same data.
