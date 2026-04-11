# ruah

[![npm version](https://img.shields.io/npm/v/@ruah-dev/cli)](https://www.npmjs.com/package/@ruah-dev/cli)
[![license](https://img.shields.io/npm/l/@ruah-dev/cli)](LICENSE)

**Multi-agent developer toolkit.**

`ruah` is the top-level CLI for the ruah ecosystem. Install one package, get access to all ruah tools.

<p align="center">
  <img src="https://raw.githubusercontent.com/ruah-dev/ruah-orch/main/.github/demo.gif" alt="ruah demo" width="100%" />
</p>

## Install

```bash
npm install -g @ruah-dev/cli
```

This installs the `ruah` command and pulls in all packages:

```
@ruah-dev/cli               <- primary install target, provides `ruah`
  ├── @ruah-dev/orch-core   <- orch implementation
  └── @ruah-dev/conv-core   <- conv implementation

@ruah-dev/orch              <- thin installer, installs `ruah` + orch core
@ruah-dev/conv              <- thin installer, installs `ruah` + conv core
```

## Usage

```bash
# Explicit namespace
ruah orch task create api --files "src/api/**" --executor claude-code

# Shorthand (orch commands work directly)
ruah task create api --files "src/api/**" --executor claude-code
ruah workflow run .ruah/workflows/feature.md
ruah status --json

# Conversion tools
ruah conv inspect petstore.yaml
ruah conv generate petstore.yaml --json
```

## Namespaces

| Namespace | Package | Description |
|---|---|---|
| `orch` | [@ruah-dev/orch](https://npmjs.com/package/@ruah-dev/orch) | Multi-agent orchestration — workspace isolation, file locking, DAG merges |
| `conv` | [@ruah-dev/conv](https://npmjs.com/package/@ruah-dev/conv) | Convert API specs to agent-ready tool surfaces |

## Orch Shortcuts

These commands delegate directly to `ruah orch` — no namespace needed:

```
ruah init                   Initialize .ruah/ in a git repo
ruah task <subcommand>      Task management (create, start, done, merge, list, cancel)
ruah workflow <subcommand>  Workflow DAG execution (run, plan, explain, list)
ruah setup                  Register with AI agents
ruah status [--json]        Dashboard
ruah doctor [--json]        Validate repo health
ruah clean [--dry-run]      Remove stale tasks
ruah config                 Show resolved configuration
ruah demo [--fast]          Interactive demo
```

## Quick Start

```bash
ruah init
ruah demo                    # see it in action

# Create isolated parallel tasks
ruah task create backend --files "src/api/**" --executor claude-code
ruah task create frontend --files "src/ui/**" --executor aider

# Start, complete, merge
ruah task start backend && ruah task start frontend
ruah task done backend && ruah task merge backend
ruah task done frontend && ruah task merge frontend
```

## Links

- **Top-level CLI:** [@ruah-dev/cli](https://github.com/ruah-dev/ruah-cli)
- **Orch installer:** [@ruah-dev/orch](https://github.com/ruah-dev/ruah-orch)
- **Conv installer:** [@ruah-dev/conv](https://github.com/ruah-dev/ruah-conv)
- **Issues:** [github.com/ruah-dev/ruah-cli/issues](https://github.com/ruah-dev/ruah-cli/issues)

## License

MIT
