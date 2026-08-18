# Changelog

## [1.2.2] - 2026-08-18

### Fixed

- Release tests no longer require orch/conv to be installed. The CLI
  publishes as a router with zero runtime dependencies.

## [1.2.1] - 2026-08-18

### Changed

- CLI is a router only: dropped runtime deps on `@ruah-dev/orch-core` and
  `@ruah-dev/conv-core`. Install those packages (or any other `@ruah-dev/*`
  tool) separately; `ruah` auto-detects them.
- Release workflow no longer waits for an unpublished orch-core version.

## [1.2.0] - 2026-08-18

### Added

- `bin.ruah` so npm itself installs the `ruah` command
- Multi-root discovery: cwd, CLI tree, npm prefix. A CLI nested under
  `@ruah-dev/opt` still sees other `@ruah-dev/*` packages
- Any package with `"ruah": { "namespace" }` is registered — not just the
  hard-coded pool list

### Changed

- Help and docs treat `ruah <tool>` as the front door
