import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "cli.js");

interface CliResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

interface PreinstallModule {
	getGlobalBinDir: (env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform) => string | null;
	installLauncher: (options?: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		log?: Pick<typeof console, "warn">;
		packageDir?: string;
		cliPath?: string | null;
	}) => {
		status: string;
		reason?: string;
		removed: string[];
		launcherPath?: string;
	};
}

function runCli(args: string[]): CliResult {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd: resolve(__dirname, ".."),
		encoding: "utf8",
		env: process.env,
	});

	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function assertSuccess(args: string[], expectedText: string): void {
	const result = runCli(args);
	assert.equal(result.status, 0, `Expected ${args.join(" ")} to succeed.\n${result.stderr}`);
	assert.match(
		result.stdout,
		new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		`Expected stdout for ${args.join(" ")} to include "${expectedText}".`,
	);
}

function verifySymlinkEntrypoint(): void {
	const tempDir = mkdtempSync(resolve(tmpdir(), "ruah-cli-symlink-"));
	const symlinkPath = resolve(tempDir, "ruah");
	symlinkSync(cliPath, symlinkPath);

	const result = spawnSync(symlinkPath, ["--version"], {
		cwd: resolve(__dirname, ".."),
		encoding: "utf8",
		env: process.env,
	});

	assert.equal(result.status, 0, `Expected symlinked CLI to succeed.\n${result.stderr ?? ""}`);
	assert.match(result.stdout ?? "", /ruah v/, "Expected symlinked CLI to print version output.");

	unlinkSync(symlinkPath);
}

const preinstallModule = (await import(
	pathToFileURL(resolve(__dirname, "..", "postinstall.mjs")).href
)) as PreinstallModule;

function verifyPreinstallCleanup(): void {
	const prefixDir = mkdtempSync(resolve(tmpdir(), "ruah-cli-prefix-"));
	const binDir = preinstallModule.getGlobalBinDir(
		{
			npm_config_global: "true",
			npm_config_prefix: prefixDir,
		},
		"darwin",
	);
	assert.ok(binDir, "Expected a global bin dir for darwin.");

	mkdirSync(binDir, { recursive: true });

	const legacyLauncher = resolve(binDir, "ruah");
	symlinkSync("../lib/node_modules/@ruah-dev/orch/dist/cli.js", legacyLauncher);

	const cleanupResult = preinstallModule.installLauncher({
		env: {
			npm_config_global: "true",
			npm_config_prefix: prefixDir,
		},
		platform: "darwin",
		log: { warn() {} },
		cliPath,
	});

	assert.equal(cleanupResult.status, "installed");
	assert.deepEqual(cleanupResult.removed, [legacyLauncher]);
	assert.equal(existsSync(legacyLauncher), true, "Expected launcher to be recreated.");

	const unrelatedLauncher = resolve(binDir, "ruah");
	writeFileSync(unrelatedLauncher, "#!/usr/bin/env sh\necho unrelated\n", "utf8");

	const skippedResult = preinstallModule.installLauncher({
		env: {
			npm_config_global: "true",
			npm_config_prefix: prefixDir,
		},
		platform: "darwin",
		log: { warn() {} },
		cliPath,
	});

	assert.equal(skippedResult.status, "skipped");
	assert.equal(skippedResult.reason, "launcher-exists");
	assert.equal(existsSync(unrelatedLauncher), true, "Expected unrelated launcher to remain.");

	unlinkSync(unrelatedLauncher);
}

assertSuccess(["--version"], "ruah v");
assertSuccess(["--help"], "Packages:");
assertSuccess(["orch", "--help"], "multi-agent orchestration");
assertSuccess(["conv", "--help"], "ruah conv");
assertSuccess(["task", "--help"], "Task subcommands:");
verifySymlinkEntrypoint();
verifyPreinstallCleanup();

const unknownCommand = runCli(["definitely-not-a-command"]);
assert.equal(unknownCommand.status, 1, "Expected unknown commands to exit with status 1.");
assert.match(
	unknownCommand.stderr,
	/unknown command/,
	"Expected stderr to explain the command failure.",
);

console.log("CLI verification passed.");
