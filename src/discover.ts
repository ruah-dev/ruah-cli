import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface DiscoveredPackage {
	namespace: string;
	pkg: string;
	description: string;
	dir: string;
	bin: string;
	version: string | null;
}

export interface PackageJson {
	name?: string;
	version?: string;
	description?: string;
	bin?: string | Record<string, string>;
	ruah?: { namespace?: string; description?: string };
}

export function readPackageJson(packageJsonPath: string): PackageJson | null {
	try {
		return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
	} catch {
		return null;
	}
}

export function resolveBinFromPackage(packageJson: PackageJson, fallback = "dist/cli.js"): string {
	if (typeof packageJson.bin === "string") return packageJson.bin;
	if (packageJson.bin && typeof packageJson.bin === "object") {
		const named = packageJson.bin.ruah;
		if (typeof named === "string") return named;
		const first = Object.values(packageJson.bin).find(
			(value): value is string => typeof value === "string",
		);
		if (first) return first;
	}
	return fallback;
}

function addExisting(set: Set<string>, dir: string): void {
	if (!existsSync(dir)) return;
	try {
		set.add(realpathSync(dir));
	} catch {
		set.add(dir);
	}
}

/**
 * Directories that may contain `@ruah-dev/<pkg>` installs.
 * Order is low → high priority: later roots overwrite earlier ones.
 */
export function collectScopeDirs(
	cliDir: string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const scopes = new Set<string>();

	const prefix = env.npm_config_prefix ?? env.PREFIX;
	if (prefix) {
		addExisting(scopes, join(prefix, "lib", "node_modules", "@ruah-dev"));
		addExisting(scopes, join(prefix, "node_modules", "@ruah-dev"));
	}

	walkForScopes(resolve(cliDir), scopes);
	walkForScopes(resolve(cwd), scopes);

	return [...scopes];
}

function walkForScopes(start: string, scopes: Set<string>): void {
	let current = start;
	for (let i = 0; i < 24; i++) {
		addExisting(scopes, join(current, "node_modules", "@ruah-dev"));

		const pkg = readPackageJson(join(current, "package.json"));
		if (pkg?.name?.startsWith("@ruah-dev/") && basename(dirname(current)) === "@ruah-dev") {
			addExisting(scopes, dirname(current));
		}

		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
}

export function scanScopeDir(scopeDir: string): DiscoveredPackage[] {
	if (!existsSync(scopeDir)) return [];
	let entries: string[];
	try {
		entries = readdirSync(scopeDir);
	} catch {
		return [];
	}

	const found: DiscoveredPackage[] = [];
	for (const name of entries) {
		if (name === "cli") continue;
		const dir = join(scopeDir, name);
		const pkgJsonPath = join(dir, "package.json");
		const pkg = readPackageJson(pkgJsonPath);
		const namespace = pkg?.ruah?.namespace;
		if (!pkg || !namespace) continue;
		found.push({
			namespace,
			pkg: pkg.name ?? `@ruah-dev/${name}`,
			description: pkg.ruah?.description ?? pkg.description ?? name,
			dir,
			bin: resolveBinFromPackage(pkg),
			version: pkg.version ?? null,
		});
	}
	return found;
}

export function discoverPackages(
	cliDir: string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): Map<string, DiscoveredPackage> {
	const map = new Map<string, DiscoveredPackage>();
	for (const scope of collectScopeDirs(cliDir, cwd, env)) {
		for (const entry of scanScopeDir(scope)) {
			map.set(entry.namespace, entry);
		}
	}
	return map;
}

export function resolveDiscoveredCli(entry: DiscoveredPackage): string | null {
	const cliPath = resolve(entry.dir, entry.bin);
	return existsSync(cliPath) ? cliPath : null;
}
