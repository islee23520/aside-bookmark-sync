#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { z } from "zod";
import { CliError, doctor, logs, mutate, status } from "./cli/service";

const commandSchema = z.enum([
  "doctor",
  "install",
  "start",
  "stop",
  "restart",
  "status",
  "logs",
  "uninstall",
]);

const help = `Usage: aside-bookmark-companion [--json] <command>

Commands:
  doctor       Check platform, Bun, companion paths, and LaunchAgent status
  install      Atomically save and load the LaunchAgent; enable login startup
  start        Start the installed service; leave a running service unchanged
  stop         Stop for this login session; startup resumes at the next login
  restart      Restart the service, or start it if stopped
  status       Show installation, registration, running state, and PID
  logs         Read recent stdout/stderr (--lines 1..1000, default 100)
  uninstall    Stop and remove the LaunchAgent; preserve state and logs

Options:
  --json       Success: {"ok":true,"data":...}; error: {"ok":false,"error":{"code":...,"message":...}}
  --help, -h   Show help

Service management requires macOS and uses the current user's gui/<uid> domain.
Global install: bun install --global /absolute/path/to/aside-bookmark-sync
Add Bun's global bin directory to PATH. No credentials are required.
State: ~/.aside-bookmark-sync; logs: ~/.aside-bookmark-sync/logs
Log output is bounded to 64 KiB per file. JSON errors go to stdout with exit code 1.
`;

const args = process.argv.slice(2);
const json = args.includes("--json");

async function main() {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      lines: { type: "string" },
    },
  });
  if (values.help || positionals.length === 0) {
    if (values.lines !== undefined) {
      throw new CliError("invalid_arguments", "--lines is only supported by the logs command.");
    }
    return { help };
  }
  const parsed = commandSchema.safeParse(positionals[0]);
  if (!parsed.success) throw new CliError("unknown_command", "Unknown command. See --help.");
  if (positionals.length !== 1 || (values.lines !== undefined && parsed.data !== "logs")) {
    throw new CliError("invalid_arguments", "Unexpected arguments. See --help.");
  }
  const command = parsed.data;
  switch (command) {
    case "doctor":
      return doctor();
    case "status":
      return status();
    case "logs": {
      const lines = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .safeParse(values.lines ?? "100");
      if (!lines.success)
        throw new CliError("invalid_arguments", "--lines must be an integer between 1 and 1000.");
      return logs(lines.data);
    }
    case "install":
    case "start":
    case "stop":
    case "restart":
    case "uninstall":
      return mutate(command);
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

try {
  const data = await main();
  if (json) console.log(JSON.stringify({ ok: true, data }));
  else if ("help" in data) console.log(data.help);
  else if ("files" in data) {
    for (const file of data.files) console.log(`==> ${file.path} <==\n${file.text}`);
  } else console.log(JSON.stringify(data, null, 2));
} catch (error) {
  const failure =
    error instanceof CliError
      ? { code: error.code, message: error.message }
      : error instanceof TypeError
        ? { code: "invalid_arguments", message: "Invalid arguments. See --help." }
        : {
            code: "operation_failed",
            message: "Operation failed. Check paths and access permissions.",
          };
  if (json) console.log(JSON.stringify({ ok: false, error: failure }));
  else console.error(`${failure.code}: ${failure.message}`);
  process.exitCode = 1;
}
