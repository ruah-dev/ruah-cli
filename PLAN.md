# ruah-cli — Deep Build Plan

> Read first: `../GROK_BUILD_PLAN.md` (order & ground rules), `../ENGINEERING_STANDARDS.md` (how to write code & tests).
> Package: `@ruah-dev/cli` · Binary: `ruah` · State: **shipped v1.2.2**
>
> **Status 2026-08-22.** W1–W4 are in source: pool-six registry, workspace
> sibling resolution (`.ruah-workspace` / `RUAH_WORKSPACE`), `ruah doctor`,
> installed > workspace. Tests skip orch/conv if not installed. Remaining:
> npm publish (`NPM_TOKEN` cannot write `@ruah-dev`; GitHub install path is
> `github:ruah-dev/ruah-cli#v1.2.2`).

## 0. Product requirement (the one that matters)

Every pool tool must be invocable as:

```
ruah <tool> <command> [flags]     # ruah verify run --json
ruah guard check --cmd "rm -rf /"
ruah opt analyze ~/.claude/projects/x/
```

with identical behavior to calling the tool's own binary directly. `ruah` is the
front door of the ecosystem; the per-tool binaries remain for standalone installs.

## 1. Where the code is today (verified 2026-08-18)

- `src/cli.ts` (~470 lines): router with a **plugin contract** — any `@ruah-dev/*`
  package declaring `"ruah": { "namespace": "x" }` in its package.json becomes
  `ruah x ...`. Discovery + `execFileSync` delegation to the resolved package bin.
  This architecture is correct. Keep it.
- All 6 pool packages + schema already declare their `ruah` namespace field
  (conv declares none — verify and add it).
- **Gap A:** resolution only searches installed `node_modules` — in this workspace
  `ruah verify ...` fails with "not installed" even though `../ruah-verify` sits
  right there, built.
- **Gap B:** the fallback namespace registry lists ~19 tools including everything
  now in `_parked/` — help output advertises tools that must not be surfaced.
- **Gap C:** bare shorthand (`ruah init`) delegates to `orch`; behavior to keep,
  but help must present the pool-of-6 first.
- `src/verify.ts` — self-check module; audit what it does before touching.
- Has git. Version 1.1.3. Tests: minimal — bring up to standards §4.

## 2. Work plan

### W1 — Registry hygiene
- The built-in fallback registry (used when a namespace isn't installed) shrinks to:
  pool six (`conv opt verify guard watch eval`) + `schema` + `orch`. Parked
  namespaces are removed entirely — unknown namespace → error with install hint,
  not advertisement.
- Help output groups: "Tools" (the six, one-line each), "Foundation" (schema, orch),
  shortcuts last. Order = build order from the big plan.

### W2 — Workspace resolution (fixes Gap A)
Resolution order for namespace `x`:
1. `@ruah-dev/x` resolvable from cwd's `node_modules` (existing behavior)
2. resolvable from the CLI's own install tree (global installs; existing)
3. **NEW — workspace sibling:** if `RUAH_WORKSPACE` env var is set, or a marker
   file `.ruah-workspace` exists in an ancestor of the CLI's real path, probe
   `<workspace>/ruah-<x>/dist/cli.js`; if present but stale/missing, error with
   "found workspace copy — run `npm run build` in ruah-<x>".
4. Not found → exit 1: `ruah <x> is not installed. npm i -g @ruah-dev/<x>`.
Sibling resolution must go through `realpathSync` (CLI may itself be npm-linked)
and never silently shadow an installed copy — precedence is exactly 1→2→3, and
`--debug` prints which path won.
- Add the `.ruah-workspace` marker file to this repo's root as part of W2.

### W3 — Delegation correctness
- Preserve argv verbatim (no re-parsing of tool flags in the router), propagate the
  child's exit code exactly, keep stdin/stdout/stderr wired for piping
  (`ruah verify run --json | jq` must work — no injected banners on stdout, ever).
- `ruah <x> --help` = the tool's own help; `ruah --help` = router help only.

### W4 — `ruah doctor`
One diagnostic command: for each pool namespace print resolution result (installed
/ workspace / missing), version, and bin path. `--json` per contract. This is the
support tool for every future "why doesn't ruah see X" issue.

### W5 — Tests to standards
- `cli.test.ts` (subprocess, per standards §4.1): help lists exactly the pool
  namespaces; unknown namespace exit 1 with hint; delegation passes flags verbatim
  and propagates exit codes 0/1/2 (use a fixture package with a stub bin that
  echoes argv and exits on demand — no dependency on real tools being built);
  workspace resolution: fake workspace in a temp dir with marker + stub
  `ruah-x/dist/cli.js`; precedence test: installed beats workspace.
- Determinism: `--help` byte-identical across runs.

## 3. Acceptance criteria (all must hold)

- From this workspace root, after building the six: `ruah verify --version`,
  `ruah guard check --cmd "rm -rf /"`, `ruah opt --help`, `ruah eval --version`,
  `ruah watch --version`, `ruah conv --version` all work via workspace resolution.
- `ruah verify run --json | jq .` produces valid JSON (nothing else on stdout).
- Help mentions no parked tool. `ruah arch` → exit 1, "not installed" hint.
- `ruah doctor --json` reports all six with a `source` of `workspace` here, and
  `missing` on a machine with nothing else installed.
- `npm run verify` green; README updated (front-door story, doctor, workspace mode).

## 4. Don'ts

- Don't merge tool code into the CLI package. Router only.
- Don't re-implement flag parsing for tools. Pass-through only.
- Don't print anything to a delegated command's stdout.
- Don't touch `ruah-orch` delegation semantics beyond help ordering.
