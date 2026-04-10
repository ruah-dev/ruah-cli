#!/usr/bin/env node

// @ruah-dev/cli — top-level CLI router for the ruah ecosystem
//
// Usage:
//   ruah orch <command>     Multi-agent orchestration (delegates to @ruah-dev/orch)
//   ruah conv <command>     (future) Conversation tools
//   ruah <command>          Shorthand — delegates to orch if the command matches
//
// Architecture:
//   ruah (this package) is the single CLI users install.
//   Each subcommand namespace maps to a separate @ruah-dev/* package.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Package registry ────────────────────────────────────────────────
// Maps subcommand namespaces to their @ruah-dev/* package entry points.
// Add new packages here as the ecosystem grows.

const PACKAGES = {
	orch: {
		pkg: "@ruah-dev/orch",
		description: "Multi-agent orchestration",
		resolve: () => {
			const pkgJson = require.resolve("@ruah-dev/orch/package.json");
			return resolve(dirname(pkgJson), "dist", "cli.js");
		},
	},
	// conv: {
	//   pkg: "@ruah-dev/conv",
	//   description: "Conversation tools",
	//   resolve: () => { ... },
	// },
};

// ── Orch commands that can be used as direct shortcuts ───────────────
// These let users type `ruah task create` instead of `ruah orch task create`

const ORCH_SHORTCUTS = new Set([
	"init",
	"task",
	"workflow",
	"setup",
	"clean",
	"config",
	"doctor",
	"status",
	"demo",
]);

// ── Version ─────────────────────────────────────────────────────────

function getVersion() {
	try {
		const pkg = require(resolve(__dirname, "..", "package.json"));
		return pkg.version;
	} catch {
		return "unknown";
	}
}

// ── Help ────────────────────────────────────────────────────────────

function printHelp() {
	const version = getVersion();
	console.log(`
  ruah v${version} — multi-agent developer toolkit

  Usage:
    ruah <namespace> <command> [options]
    ruah <command> [options]              (shorthand for ruah orch)

  Namespaces:
    orch        Multi-agent orchestration (workspace isolation, file locking, DAG merges)

  Shortcuts (delegated to ruah orch):
    ruah init                   Initialize .ruah/ in a git repo
    ruah task <subcommand>      Task management (create, start, done, merge, list, cancel)
    ruah workflow <subcommand>  Workflow DAG execution (run, plan, explain, list, create)
    ruah setup                  Register with AI agents
    ruah status [--json]        Dashboard
    ruah doctor [--json]        Validate repo health
    ruah clean [--dry-run]      Remove stale tasks
    ruah config                 Show resolved configuration
    ruah demo [--fast]          Interactive demo

  Options:
    --help, -h       Show this help
    --version, -v    Show version

  Examples:
    ruah orch task create api --files "src/api/**" --executor claude-code
    ruah task create api --files "src/api/**"      # same thing (shorthand)
    ruah workflow run .ruah/workflows/feature.md
    ruah status --json

  Packages:
    @ruah-dev/cli   v${version}  (this CLI)`);

	// Show installed package versions
	for (const [name, entry] of Object.entries(PACKAGES)) {
		try {
			const pkgJson = require.resolve(`${entry.pkg}/package.json`);
			const pkg = require(pkgJson);
			console.log(`    ${entry.pkg}  v${pkg.version}  ${entry.description}`);
		} catch {
			console.log(`    ${entry.pkg}  (not installed)  ${entry.description}`);
		}
	}

	console.log();
}

// ── Delegate to a package CLI ───────────────────────────────────────

function delegate(entry, args) {
	try {
		const cli = entry.resolve();
		execFileSync(process.execPath, [cli, ...args], {
			stdio: "inherit",
			env: process.env,
		});
	} catch (err) {
		if (err.status != null) {
			process.exit(err.status);
		}
		console.error(`ruah: failed to run ${entry.pkg}: ${err.message}`);
		process.exit(1);
	}
}

// ── Main ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// No args or help flag
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	printHelp();
	process.exit(0);
}

// Version flag
if (args[0] === "--version" || args[0] === "-v") {
	const version = getVersion();

	console.log(`ruah v${version}`);

	for (const [name, entry] of Object.entries(PACKAGES)) {
		try {
			const pkgJson = require.resolve(`${entry.pkg}/package.json`);
			const pkg = require(pkgJson);
			console.log(`  ${name}: v${pkg.version}`);
		} catch {
			console.log(`  ${name}: not installed`);
		}
	}

	process.exit(0);
}

const command = args[0];

// Explicit namespace: ruah orch <...>
if (PACKAGES[command]) {
	delegate(PACKAGES[command], args.slice(1));
}
// Shortcut: ruah task <...> → ruah orch task <...>
else if (ORCH_SHORTCUTS.has(command)) {
	delegate(PACKAGES.orch, args);
}
// Unknown command
else {
	console.error(`ruah: unknown command '${command}'`);
	console.error();
	console.error("Available namespaces:");
	for (const [name, entry] of Object.entries(PACKAGES)) {
		console.error(`  ${name}  ${entry.description}`);
	}
	console.error();
	console.error("Run 'ruah --help' for usage.");
	process.exit(1);
}
