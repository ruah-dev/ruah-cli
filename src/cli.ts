#!/usr/bin/env node

// @ruah-dev/cli — top-level CLI router for the ruah ecosystem
//
// Architecture:
//   ruah (this package) is the single CLI users install.
//   Each subcommand namespace maps to a separate @ruah-dev/* package.
//   Packages are auto-discovered via the "ruah" field in their package.json.
//
// Plugin contract:
//   Any @ruah-dev/* package can declare itself as a ruah subcommand by adding:
//   "ruah": { "namespace": "conv", "description": "Convert API specs..." }
//   to its package.json. When installed alongside @ruah-dev/cli, it is
//   automatically available as `ruah <namespace> <command>`.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type DiscoveredPackage,
	discoverPackages,
	type PackageJson,
	readPackageJson,
	resolveBinFromPackage,
	resolveDiscoveredCli,
} from "./discover.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// ── Types ────────────────────────────────────────────────────────────

interface PackageEntry {
	pkg: string;
	description: string;
	defaultBin: string;
}

interface InstalledPackage {
	path: string;
	json: PackageJson;
}

interface ExecError extends Error {
	status?: number | null;
}

// ── Known packages (pool of six + foundation). Parked tools are gone. ─

const POOL_ORDER = ["guard", "verify", "opt", "watch", "eval", "conv"] as const;
const FOUNDATION_ORDER = ["schema", "orch"] as const;

const KNOWN_PACKAGES: Record<string, PackageEntry> = {
	guard: {
		pkg: "@ruah-dev/guard",
		description: "Policies for agent tool calls",
		defaultBin: "dist/cli.js",
	},
	verify: {
		pkg: "@ruah-dev/verify",
		description: "Definition of done as code",
		defaultBin: "dist/cli.js",
	},
	opt: {
		pkg: "@ruah-dev/opt",
		description: "Token X-ray — where spend went",
		defaultBin: "dist/cli.js",
	},
	watch: {
		pkg: "@ruah-dev/watch",
		description: "Static HTML replay of one session",
		defaultBin: "dist/cli.js",
	},
	eval: {
		pkg: "@ruah-dev/eval",
		description: "Same task, N executors, receipts",
		defaultBin: "dist/cli.js",
	},
	conv: {
		pkg: "@ruah-dev/conv",
		description: "API specs → agent-shaped tools",
		defaultBin: "dist/cli.js",
	},
	schema: {
		pkg: "@ruah-dev/schema",
		description: "Canonical Workflow / Task / Trace / Policy types",
		defaultBin: "dist/cli.js",
	},
	orch: {
		pkg: "@ruah-dev/orch",
		description: "Multi-agent orchestration (optional)",
		defaultBin: "dist/cli.js",
	},
};

/** Extra npm names to try when the headline package isn't resolvable. */
const PACKAGE_ALIASES: Record<string, string[]> = {
	conv: ["@ruah-dev/conv-core"],
	orch: ["@ruah-dev/orch-core"],
};

const WORKSPACE_FOLDERS: Record<string, string> = {
	guard: "ruah-guard",
	verify: "ruah-verify",
	opt: "ruah-opt",
	watch: "ruah-watch",
	eval: "ruah-eval",
	conv: "ruah-conv",
	schema: "ruah-schema",
	orch: "ruah-orch",
};

// ── Orch shortcuts — these commands delegate directly to orch ────────

const ORCH_SHORTCUTS = [
	"init",
	"task",
	"workflow",
	"setup",
	"clean",
	"config",
	"status",
	"demo",
] as const;

const ORCH_SHORTCUT_SET = new Set<string>(ORCH_SHORTCUTS);
const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);
const packageCache = new Map<string, InstalledPackage | null>();

// ── Package discovery ────────────────────────────────────────────────

let discoveredPackages: Record<string, PackageEntry> | null = null;
let discoveredInstalls: Map<string, DiscoveredPackage> | null = null;

function getDiscoveredInstalls(): Map<string, DiscoveredPackage> {
	if (!discoveredInstalls) {
		discoveredInstalls = discoverPackages(resolve(__dirname, ".."), process.cwd());
	}
	return discoveredInstalls;
}

/**
 * Known pool + any `@ruah-dev/*` package that declares `"ruah": { "namespace" }`.
 * Scan covers cwd, the CLI install tree, and the npm prefix so a nested
 * `opt/node_modules/@ruah-dev/cli` still sees globally installed siblings.
 */
function getPackages(): Record<string, PackageEntry> {
	if (discoveredPackages) return discoveredPackages;

	const packages: Record<string, PackageEntry> = { ...KNOWN_PACKAGES };
	for (const [ns, found] of getDiscoveredInstalls()) {
		packages[ns] = {
			pkg: found.pkg,
			description: found.description,
			defaultBin: found.bin,
		};
	}
	discoveredPackages = packages;
	return packages;
}

// ── Utilities ────────────────────────────────────────────────────────

function getLocalPackageJson(): PackageJson | null {
	return readPackageJson(resolve(__dirname, "..", "package.json"));
}

function resolveViaRequire(pkgName: string): InstalledPackage | null {
	try {
		const packageJsonPath = require.resolve(`${pkgName}/package.json`);
		const packageJson = readPackageJson(packageJsonPath);
		return packageJson ? { path: packageJsonPath, json: packageJson } : null;
	} catch {
		return null;
	}
}

function getInstalledPackage(namespace: string, entry: PackageEntry): InstalledPackage | null {
	const cached = packageCache.get(entry.pkg);
	if (cached !== undefined) {
		return cached;
	}

	const found = getDiscoveredInstalls().get(namespace);
	if (found) {
		const packageJsonPath = join(found.dir, "package.json");
		const packageJson = readPackageJson(packageJsonPath);
		if (packageJson) {
			const installed = { path: packageJsonPath, json: packageJson };
			packageCache.set(entry.pkg, installed);
			return installed;
		}
	}

	const names = [entry.pkg, ...(PACKAGE_ALIASES[namespace] ?? [])];
	for (const name of names) {
		const installed = resolveViaRequire(name);
		if (installed) {
			packageCache.set(entry.pkg, installed);
			return installed;
		}
	}

	packageCache.set(entry.pkg, null);
	return null;
}

function getVersion(): string {
	return getLocalPackageJson()?.version ?? "unknown";
}

function getPackageVersion(namespace: string, entry: PackageEntry): string | null {
	return getInstalledPackage(namespace, entry)?.json.version ?? null;
}

export function findWorkspaceRoot(
	startDir: string = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	if (env.RUAH_WORKSPACE && env.RUAH_WORKSPACE.trim() !== "") {
		return env.RUAH_WORKSPACE;
	}
	let current = startDir;
	while (true) {
		if (existsSync(join(current, ".ruah-workspace"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

function resolveWorkspaceCli(namespace: string, workspaceRoot: string): string | null {
	const folder = WORKSPACE_FOLDERS[namespace];
	if (!folder) return null;
	const candidates = [
		join(workspaceRoot, folder, "dist", "cli.js"),
		join(workspaceRoot, folder, "packages", "core", "dist", "cli.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	const srcHint = join(workspaceRoot, folder);
	if (existsSync(srcHint)) {
		throw new Error(`found workspace copy at ${srcHint} — run \`npm run build\` in ${folder}`);
	}
	return null;
}

export type ResolveSource = "installed" | "workspace" | "missing";

export function resolveNamespace(
	namespace: string,
	options: { cwd?: string; env?: NodeJS.ProcessEnv; debug?: boolean } = {},
): { path: string; source: ResolveSource } | { path: null; source: "missing"; hint: string } {
	const packages = getPackages();
	const entry = packages[namespace];
	if (!entry) {
		return {
			path: null,
			source: "missing",
			hint: `ruah ${namespace} is not a known tool. Try: ${POOL_ORDER.join(", ")}`,
		};
	}

	const found = getDiscoveredInstalls().get(namespace);
	if (found) {
		const discoveredPath = resolveDiscoveredCli(found);
		if (discoveredPath) {
			if (options.debug) {
				console.error(`ruah: ${namespace} → installed ${discoveredPath}`);
			}
			return { path: discoveredPath, source: "installed" };
		}
	}

	const installed = getInstalledPackage(namespace, entry);
	if (installed) {
		const relativeCliPath = resolveBinFromPackage(installed.json, entry.defaultBin);
		const cliPath = resolve(dirname(installed.path), relativeCliPath);
		if (existsSync(cliPath)) {
			if (options.debug) {
				console.error(`ruah: ${namespace} → installed ${cliPath}`);
			}
			return { path: cliPath, source: "installed" };
		}
	}

	const root = findWorkspaceRoot(options.cwd ?? process.cwd(), options.env);
	if (root) {
		const workspaceCli = resolveWorkspaceCli(namespace, root);
		if (workspaceCli) {
			if (options.debug) {
				console.error(`ruah: ${namespace} → workspace ${workspaceCli}`);
			}
			return { path: workspaceCli, source: "workspace" };
		}
	}

	const pkgName = entry.pkg.replace(/-core$/, "");
	return {
		path: null,
		source: "missing",
		hint: `ruah ${namespace} is not installed. npm i -g ${pkgName}`,
	};
}

function isNamespace(command: string): boolean {
	return Object.hasOwn(getPackages(), command);
}

// ── Output ───────────────────────────────────────────────────────────

function lineFor(ns: string): string {
	const packages = getPackages();
	const entry = packages[ns];
	if (!entry) return "";
	const resolved = resolveNamespace(ns);
	const mark = resolved.path ? "" : " (not installed)";
	return `    ${ns.padEnd(12)}${entry.description}${mark}`;
}

function printHelp(): void {
	const version = getVersion();
	const toolLines = POOL_ORDER.map(lineFor).join("\n");
	const foundationLines = FOUNDATION_ORDER.map(lineFor).join("\n");

	console.log(`
  ruah v${version} — multi-agent developer toolkit

  Usage:
    ruah <tool> <command> [options]       ruah opt analyze   (not ruah-opt)
    ruah doctor [--json]                  Where each tool resolves from

  Tools:
${toolLines}

  Foundation:
${foundationLines}

  Shortcuts (delegated to ruah orch):
    ruah init / task / workflow / status / clean / config / demo / setup

  Options:
    --help, -h       Show this help
    --version, -v    Show version
    --debug          Print which bin path won

  Examples:
    ruah guard check --cmd 'rm -rf /' --json
    ruah verify run --json
    ruah opt analyze ~/.claude/projects/<slug>/
    ruah watch render --latest
    ruah eval run spec.json --json
    ruah conv generate petstore.yaml --json

  Packages:
    @ruah-dev/cli   v${version}  (this CLI)`);

	for (const ns of [...POOL_ORDER, ...FOUNDATION_ORDER]) {
		const entry = getPackages()[ns];
		if (!entry) continue;
		const packageVersion = getPackageVersion(ns, entry);
		if (packageVersion) {
			console.log(`    ${entry.pkg}  v${packageVersion}  ${entry.description}`);
			continue;
		}
		console.log(`    ${entry.pkg}  (not installed)  ${entry.description}`);
	}

	console.log();
}

function printVersion(): void {
	const version = getVersion();
	const packages = getPackages();

	console.log(`ruah v${version}`);

	for (const [name, entry] of Object.entries(packages)) {
		const packageVersion = getPackageVersion(name, entry);
		if (packageVersion) {
			console.log(`  ${name}: v${packageVersion}`);
			continue;
		}

		console.log(`  ${name}: not installed`);
	}
}

// ── Delegation ───────────────────────────────────────────────────────

function printDoctor(json: boolean): number {
	const rows = [...POOL_ORDER, ...FOUNDATION_ORDER].map((ns) => {
		const entry = getPackages()[ns];
		let resolved: ReturnType<typeof resolveNamespace>;
		try {
			resolved = resolveNamespace(ns);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				namespace: ns,
				status: "missing" as const,
				version: null,
				path: null,
				hint: message,
			};
		}
		const version = entry ? getPackageVersion(ns, entry) : null;
		return {
			namespace: ns,
			status: resolved.source,
			version,
			path: resolved.path,
			hint: resolved.path ? null : "hint" in resolved ? resolved.hint : "missing",
		};
	});
	if (json) {
		console.log(JSON.stringify({ schemaVersion: "1", tools: rows }, null, 2));
	} else {
		console.log("ruah doctor");
		for (const row of rows) {
			const where = row.path ?? row.hint ?? "missing";
			console.log(
				`  ${row.namespace.padEnd(10)} ${row.status.padEnd(10)} ${row.version ?? "-"}  ${where}`,
			);
		}
	}
	return 0;
}

function delegate(entry: PackageEntry, args: string[], debug = false): number {
	try {
		const namespace =
			Object.entries(getPackages()).find(([, value]) => value.pkg === entry.pkg)?.[0] ?? "";
		const resolved = resolveNamespace(namespace, { debug });
		if (!resolved.path) {
			console.error(`ruah: ${"hint" in resolved ? resolved.hint : "not installed"}`);
			return 1;
		}
		execFileSync(process.execPath, [resolved.path, ...args], {
			stdio: "inherit",
			env: process.env,
		});
		return 0;
	} catch (error: unknown) {
		const execError = error as ExecError;
		if (typeof execError.status === "number") {
			return execError.status;
		}

		const message = error instanceof Error ? error.message : "unknown error";
		console.error(`ruah: failed to run ${entry.pkg}: ${message}`);
		return 1;
	}
}

// ── Main ─────────────────────────────────────────────────────────────

export function run(argv: string[] = process.argv.slice(2)): number {
	const debug = argv.includes("--debug");

	if (argv.length === 0 || HELP_FLAGS.has(argv[0])) {
		printHelp();
		return 0;
	}

	if (VERSION_FLAGS.has(argv[0])) {
		printVersion();
		return 0;
	}

	if (argv[0] === "doctor") {
		return printDoctor(argv.includes("--json"));
	}

	const command = argv[0];
	const packages = getPackages();

	if (isNamespace(command)) {
		return delegate(packages[command], argv.slice(1), debug);
	}

	if (ORCH_SHORTCUT_SET.has(command)) {
		return delegate(packages.orch, argv);
	}

	console.error(`ruah: unknown command '${command}'`);
	console.error();
	console.error("Available namespaces:");
	for (const [name, entry] of Object.entries(packages)) {
		console.error(`  ${name}  ${entry.description}`);
	}
	console.error();
	console.error("Run 'ruah --help' for usage.");
	return 1;
}

try {
	if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(__filename)) {
		process.exit(run());
	}
} catch {
	// Ignore path resolution failures when imported or invoked indirectly.
}
