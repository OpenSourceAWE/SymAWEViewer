# Changelog

## Unreleased

### Added

- A run of one frame lists its quantities as a table of name, value and unit under the 3D view, where a longer run gets the timeline and panels.
- A run's optional `run` metadata key, its kind, parameters and commits, shows under an info button over the scene and is decoded as `run.provenance`; `decodeRun` refuses one that is not JSON.
