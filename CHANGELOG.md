# Changelog

## [1.2.0] - 2026-08-18

### Added

- `bin.ruah` so npm itself installs the `ruah` command
- Multi-root discovery: cwd, CLI tree, npm prefix. A CLI nested under
  `@ruah-dev/opt` still sees other `@ruah-dev/*` packages
- Any package with `"ruah": { "namespace" }` is registered — not just the
  hard-coded pool list

### Changed

- Help and docs treat `ruah <tool>` as the front door
