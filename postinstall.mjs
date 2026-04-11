import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@ruah-dev/cli";
const LEGACY_MARKERS = ["@ruah-dev/cli", "@ruah-dev/orch", "@ruah-dev/conv"];
const LEGACY_BIN_OWNERS = ["@ruah-dev/orch", "@ruah-dev/conv"];

function getPackageDir() {
	return dirname(fileURLToPath(import.meta.url));
}

export function resolveCliEntrypoint(packageDir = getPackageDir()) {
	const cliPath = resolve(packageDir, "dist", "cli.js");
	return existsSync(cliPath) ? cliPath : null;
}

export function isGlobalInstall(env = process.env) {
	return env.npm_config_global === "true" || env.npm_config_location === "global";
}

export function getGlobalBinDir(env = process.env, platform = process.platform) {
	const prefix = env.npm_config_prefix;
	if (!prefix) {
		return null;
	}

	return platform === "win32" ? prefix : join(prefix, "bin");
}

export function getLocalBinDir(packageDir = getPackageDir()) {
	const nodeModulesDir = resolve(packageDir, "..", "..");
	return basename(nodeModulesDir) === "node_modules" ? join(nodeModulesDir, ".bin") : null;
}

export function getLauncherPaths(binDir, platform = process.platform) {
	if (platform === "win32") {
		return [join(binDir, "ruah"), join(binDir, "ruah.cmd"), join(binDir, "ruah.ps1")];
	}

	return [join(binDir, "ruah")];
}

function hasLegacyMarker(value) {
	return LEGACY_MARKERS.some((marker) => value.includes(marker));
}

function hasLegacyBinOwner(value) {
	return LEGACY_BIN_OWNERS.some((marker) => value.includes(marker));
}

export function shouldRemoveLauncher(launcherPath) {
	let stats;
	try {
		stats = lstatSync(launcherPath);
	} catch {
		return false;
	}

	if (stats.isSymbolicLink()) {
		const linkTarget = readlinkSync(launcherPath);
		const resolvedTarget = resolve(dirname(launcherPath), linkTarget);
		return hasLegacyBinOwner(linkTarget) || hasLegacyBinOwner(resolvedTarget);
	}

	if (!stats.isFile()) {
		return false;
	}

	try {
		const content = readFileSync(launcherPath, "utf8");
		return hasLegacyMarker(content);
	} catch {
		return false;
	}
}

export function cleanupLegacyLaunchers(binDir, platform = process.platform) {
	const removed = [];

	for (const launcherPath of getLauncherPaths(binDir, platform)) {
		if (!shouldRemoveLauncher(launcherPath)) {
			continue;
		}

		unlinkSync(launcherPath);
		removed.push(launcherPath);
	}

	return removed;
}

export function buildUnixLauncher(cliPath) {
	const escapedPath = cliPath.replace(/'/g, `'\"'\"'`);
	return `#!/usr/bin/env sh\nexec node '${escapedPath}' \"$@\"\n`;
}

export function buildWindowsLauncher(cliPath) {
	return `@ECHO OFF\r\nnode "${cliPath}" %*\r\n`;
}

export function installLauncher(options = {}) {
	const {
		env = process.env,
		platform = process.platform,
		log = console,
		packageDir = getPackageDir(),
		cliPath = resolveCliEntrypoint(packageDir),
	} = options;

	if (!cliPath) {
		log.warn(`[${PACKAGE_NAME}] CLI entrypoint is missing. Reinstall the package.`);
		return { status: "skipped", reason: "missing-cli", removed: [] };
	}

	const binDir = isGlobalInstall(env)
		? getGlobalBinDir(env, platform)
		: getLocalBinDir(packageDir);
	if (!binDir) {
		return { status: "skipped", reason: "missing-bin-dir", removed: [] };
	}

	mkdirSync(binDir, { recursive: true });

	const removed = cleanupLegacyLaunchers(binDir, platform);
	const launcherPath = join(binDir, platform === "win32" ? "ruah.cmd" : "ruah");

	if (existsSync(launcherPath)) {
		log.warn(
			`[${PACKAGE_NAME}] Could not install \`ruah\` at ${launcherPath} because a non-ruah launcher already exists there.`,
		);
		return { status: "skipped", reason: "launcher-exists", removed };
	}

	if (platform === "win32") {
		writeFileSync(launcherPath, buildWindowsLauncher(cliPath), "utf8");
		return { status: "installed", launcherPath, removed };
	}

	writeFileSync(launcherPath, buildUnixLauncher(cliPath), "utf8");
	chmodSync(launcherPath, 0o755);
	return { status: "installed", launcherPath, removed };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	installLauncher();
}
