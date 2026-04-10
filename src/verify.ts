import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "cli.js");

interface CliResult {
	status: number | null;
	stdout: string;
	stderr: string;
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

assertSuccess(["--version"], "ruah v");
assertSuccess(["--help"], "Packages:");
assertSuccess(["orch", "--help"], "multi-agent orchestration");
assertSuccess(["conv", "--help"], "ruah conv");
assertSuccess(["task", "--help"], "Task subcommands:");

const unknownCommand = runCli(["definitely-not-a-command"]);
assert.equal(unknownCommand.status, 1, "Expected unknown commands to exit with status 1.");
assert.match(
	unknownCommand.stderr,
	/unknown command/,
	"Expected stderr to explain the command failure.",
);

console.log("CLI verification passed.");
