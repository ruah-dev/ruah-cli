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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// ── Types ────────────────────────────────────────────────────────────

interface PackageEntry {
	pkg: string;
	description: string;
	defaultBin: string;
}

interface RuahMeta {
	namespace: string;
	description?: string;
}

interface PackageJson {
	version?: string;
	name?: string;
	description?: string;
	bin?: string | Record<string, string>;
	ruah?: RuahMeta;
}

interface InstalledPackage {
	path: string;
	json: PackageJson;
}

interface ExecError extends Error {
	status?: number | null;
}

// ── Known packages (always listed, even if not installed) ────────────

const KNOWN_PACKAGES: Record<string, PackageEntry> = {
	orch: {
		pkg: "@ruah-dev/orch-core",
		description: "Multi-agent orchestration",
		defaultBin: "dist/cli.js",
	},
	conv: {
		pkg: "@ruah-dev/conv-core",
		description: "Convert API specs to agent-ready tool surfaces",
		defaultBin: "dist/cli.js",
	},
};

// ── Orch shortcuts — these commands delegate directly to orch ────────

const ORCH_SHORTCUTS = [
	"init",
	"task",
	"workflow",
	"setup",
	"clean",
	"config",
	"doctor",
	"status",
	"demo",
] as const;

const ORCH_SHORTCUT_SET = new Set<string>(ORCH_SHORTCUTS);
const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);
const packageCache = new Map<string, InstalledPackage | null>();

// ── Package discovery ────────────────────────────────────────────────

let discoveredPackages: Record<string, PackageEntry> | null = null;

/**
 * Discover all @ruah-dev/* packages installed alongside this CLI.
 * Each package that has a "ruah" field with "namespace" in its package.json
 * is registered as a subcommand namespace.
 *
 * Known packages (like orch) are always included. Discovered packages
 * are merged on top — if a package declares a namespace that matches
 * a known package, the discovered metadata takes precedence.
 */
function getPackages(): Record<string, PackageEntry> {
	if (discoveredPackages) return discoveredPackages;

	const packages: Record<string, PackageEntry> = { ...KNOWN_PACKAGES };

	try {
		// The scope directory is @ruah-dev/ — two levels up from dist/cli.js
		// __dirname = node_modules/@ruah-dev/cli/dist
		// ..       = node_modules/@ruah-dev/cli
		// ../..    = node_modules/@ruah-dev
		const scopeDir = resolve(__dirname, "..", "..");

		if (!existsSync(scopeDir)) {
			discoveredPackages = packages;
			return packages;
		}

		const entries = readdirSync(scopeDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === "cli") continue;

			const pkgJsonPath = resolve(scopeDir, entry.name, "package.json");
			if (!existsSync(pkgJsonPath)) continue;

			const pkgJson = readPackageJson(pkgJsonPath);
			if (!pkgJson?.ruah?.namespace) continue;

			const ns = pkgJson.ruah.namespace;
			packages[ns] = {
				pkg: pkgJson.name ?? `@ruah-dev/${entry.name}`,
				description: pkgJson.ruah.description ?? pkgJson.description ?? entry.name,
				defaultBin: "dist/cli.js",
			};
		}
	} catch {
		// Discovery failed — use known packages only
	}

	discoveredPackages = packages;
	return packages;
}

// ── Utilities ────────────────────────────────────────────────────────

function readPackageJson(packageJsonPath: string): PackageJson | null {
	try {
		return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
	} catch {
		return null;
	}
}

function getLocalPackageJson(): PackageJson | null {
	return readPackageJson(resolve(__dirname, "..", "package.json"));
}

function getInstalledPackage(entry: PackageEntry): InstalledPackage | null {
	const cached = packageCache.get(entry.pkg);
	if (cached !== undefined) {
		return cached;
	}

	try {
		const packageJsonPath = require.resolve(`${entry.pkg}/package.json`);
		const packageJson = readPackageJson(packageJsonPath);
		const installed = packageJson
			? {
					path: packageJsonPath,
					json: packageJson,
				}
			: null;
		packageCache.set(entry.pkg, installed);
		return installed;
	} catch {
		packageCache.set(entry.pkg, null);
		return null;
	}
}

function resolveBinPath(packageJson: PackageJson, fallbackPath: string): string {
	if (typeof packageJson.bin === "string") {
		return packageJson.bin;
	}

	if (packageJson.bin && typeof packageJson.bin === "object") {
		const ruahBin = packageJson.bin.ruah;
		if (typeof ruahBin === "string") {
			return ruahBin;
		}

		const firstBin = Object.values(packageJson.bin).find(
			(binPath): binPath is string => typeof binPath === "string",
		);
		if (firstBin) {
			return firstBin;
		}
	}

	return fallbackPath;
}

function getVersion(): string {
	return getLocalPackageJson()?.version ?? "unknown";
}

function getPackageVersion(entry: PackageEntry): string | null {
	return getInstalledPackage(entry)?.json.version ?? null;
}

function resolvePackageCliPath(entry: PackageEntry): string {
	const installed = getInstalledPackage(entry);
	if (!installed) {
		throw new Error(`${entry.pkg} is not installed`);
	}

	const relativeCliPath = resolveBinPath(installed.json, entry.defaultBin);
	const cliPath = resolve(dirname(installed.path), relativeCliPath);

	if (!existsSync(cliPath)) {
		throw new Error(
			`${entry.pkg} CLI entrypoint was not found at ${cliPath}. Reinstall the package or rebuild it before running ruah.`,
		);
	}

	return cliPath;
}

function isNamespace(command: string): boolean {
	return Object.hasOwn(getPackages(), command);
}

// ── Output ───────────────────────────────────────────────────────────

function printHelp(): void {
	const version = getVersion();
	const packages = getPackages();

	// Build namespace list dynamically
	const namespaceLines = Object.entries(packages)
		.map(([ns, entry]) => {
			const installed = getInstalledPackage(entry);
			const status = installed ? "" : " (not installed)";
			return `    ${ns.padEnd(12)}${entry.description}${status}`;
		})
		.join("\n");

	console.log(`
  ruah v${version} — multi-agent developer toolkit

  Usage:
    ruah <namespace> <command> [options]
    ruah <command> [options]              (shorthand for ruah orch)

  Namespaces:
${namespaceLines}

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
    ruah conv generate petstore.yaml --json
    ruah workflow run .ruah/workflows/feature.md
    ruah status --json

  Packages:
    @ruah-dev/cli   v${version}  (this CLI)`);

	for (const entry of Object.values(packages)) {
		const packageVersion = getPackageVersion(entry);
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
		const packageVersion = getPackageVersion(entry);
		if (packageVersion) {
			console.log(`  ${name}: v${packageVersion}`);
			continue;
		}

		console.log(`  ${name}: not installed`);
	}
}

// ── Delegation ───────────────────────────────────────────────────────

function delegate(entry: PackageEntry, args: string[]): number {
	try {
		const cliPath = resolvePackageCliPath(entry);
		execFileSync(process.execPath, [cliPath, ...args], {
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
	if (argv.length === 0 || HELP_FLAGS.has(argv[0])) {
		printHelp();
		return 0;
	}

	if (VERSION_FLAGS.has(argv[0])) {
		printVersion();
		return 0;
	}

	const command = argv[0];
	const packages = getPackages();

	if (isNamespace(command)) {
		return delegate(packages[command], argv.slice(1));
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

if (resolve(process.argv[1] ?? "") === __filename) {
	process.exit(run());
}
