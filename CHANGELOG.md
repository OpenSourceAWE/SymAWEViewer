# Changelog

## Unreleased

### Added

- A run of one frame lists its quantities as a table of name, value and unit under the 3D view, where a longer run gets the timeline and panels.
- A run's optional `run` metadata key, how it was made, shows under an info button over the scene: its kind, its parameters, the commits it ran from and whatever else it records. It is decoded as `run.provenance`, and `decodeRun` refuses one that is not a JSON object.
