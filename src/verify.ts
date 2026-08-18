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
assertSuccess(["--help"], "Tools:");
assertSuccess(["--help"], "guard");

function assertDelegatesOrMissing(namespace: string, expectedText: string): void {
	const result = runCli([namespace, "--help"]);
	if (result.status !== 0 && /not installed/.test(result.stderr)) {
		return;
	}
	assert.equal(
		result.status,
		0,
		`Expected ${namespace} --help to succeed when installed.\n${result.stderr}`,
	);
	assert.match(result.stdout, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assertDelegatesOrMissing("orch", "multi-agent orchestration");
assertDelegatesOrMissing("conv", "ruah conv");
assertDelegatesOrMissing("task", "Task subcommands:");
verifySymlinkEntrypoint();
verifyPreinstallCleanup();

const helpOut = runCli(["--help"]);
assert.doesNotMatch(helpOut.stdout, /^\s+arch\s/m, "Parked tools must not appear in help");
assert.doesNotMatch(helpOut.stdout, /^\s+obs\s/m, "Parked tools must not appear in help");

const doctor = runCli(["doctor", "--json"]);
assert.equal(doctor.status, 0, doctor.stderr);
const doctorJson = JSON.parse(doctor.stdout) as {
	tools: Array<{ namespace: string }>;
};
assert.ok(doctorJson.tools.some((t) => t.namespace === "guard"));
assert.ok(!doctorJson.tools.some((t) => t.namespace === "arch"));

function verifyWorkspaceResolution(): void {
	const workspace = mkdtempSync(resolve(tmpdir(), "ruah-ws-"));
	writeFileSync(resolve(workspace, ".ruah-workspace"), "ruah\n");
	const stubDir = resolve(workspace, "ruah-guard", "dist");
	mkdirSync(stubDir, { recursive: true });
	writeFileSync(
		resolve(stubDir, "cli.js"),
		"#!/usr/bin/env node\nconsole.log(['stub', ...process.argv.slice(2)].join(' '));\n",
	);
	const result = spawnSync(process.execPath, [cliPath, "guard", "check", "--cmd", "x"], {
		encoding: "utf8",
		env: { ...process.env, RUAH_WORKSPACE: workspace },
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout ?? "", /stub check --cmd x/);
}

verifyWorkspaceResolution();

function verifyNestedCliDiscoversParentTool(): void {
	const root = mkdtempSync(resolve(tmpdir(), "ruah-nested-"));
	const optDir = resolve(root, "node_modules", "@ruah-dev", "opt");
	mkdirSync(resolve(optDir, "dist"), { recursive: true });
	writeFileSync(
		resolve(optDir, "package.json"),
		JSON.stringify({
			name: "@ruah-dev/opt",
			version: "0.1.0",
			ruah: { namespace: "opt", description: "nested opt" },
			bin: { "ruah-opt": "dist/cli.js" },
		}),
	);
	writeFileSync(
		resolve(optDir, "dist", "cli.js"),
		"#!/usr/bin/env node\nconsole.log(['nested-opt', ...process.argv.slice(2)].join(' '));\n",
	);

	const result = spawnSync(process.execPath, [cliPath, "opt", "analyze", "--json"], {
		encoding: "utf8",
		cwd: root,
		env: { ...process.env, RUAH_WORKSPACE: "" },
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout ?? "", /nested-opt analyze --json/);
}

verifyNestedCliDiscoversParentTool();

const unknownCommand = runCli(["definitely-not-a-command"]);
assert.equal(unknownCommand.status, 1, "Expected unknown commands to exit with status 1.");
assert.match(
	unknownCommand.stderr,
	/unknown command/,
	"Expected stderr to explain the command failure.",
);

console.log("CLI verification passed.");
