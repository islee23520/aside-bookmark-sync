import { constants } from "node:fs";
import { access, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LABEL, paths, renderPlist } from "./plist";

export class CliError extends Error {
  readonly name = "CliError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const supported = process.platform === "darwin";
const domain = supported ? `gui/${process.getuid?.()}` : null;
const target = domain === null ? null : `${domain}/${LABEL}`;

async function launchctl(args: readonly string[]) {
  const child = Bun.spawn(["/bin/launchctl", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { output, exitCode };
}

async function run(args: readonly string[]): Promise<void> {
  const result = await launchctl(args);
  if (result.exitCode !== 0) {
    throw new CliError("launchctl_failed", `launchctl ${args[0]} failed (${result.exitCode}).`);
  }
}

export async function status() {
  const installed = await Bun.file(paths.plist).exists();
  const result = target === null ? null : await launchctl(["print", target]);
  // 113은 해당 GUI 도메인에 서비스가 없는 경우다. 다른 오류를 정지 상태로 숨기지 않는다.
  if (result !== null && result.exitCode !== 0 && result.exitCode !== 113) {
    throw new CliError("launchctl_failed", `launchctl print failed (${result.exitCode}).`);
  }
  const loaded = result?.exitCode === 0;
  const output = loaded ? result.output : "";
  const pid = output.match(/^\tpid = (\d+)$/m)?.[1];
  const lastExitCode = output.match(/^\tlast exit code = (-?\d+)$/m)?.[1];
  // launchctl 원문에는 상속된 환경 변수와 비밀이 포함될 수 있다.
  return {
    label: LABEL,
    platform: process.platform,
    supported,
    target,
    installed,
    loaded,
    running: /^\tstate = running$/m.test(output),
    pid: pid === undefined ? null : Number(pid),
    lastExitCode: lastExitCode === undefined ? null : Number(lastExitCode),
    paths,
  };
}

export async function doctor() {
  const service = await status();
  const mainExists = await Bun.file(paths.main).exists();
  return {
    supported,
    ready: supported && mainExists,
    reason: supported ? null : "LaunchAgent management is only supported on macOS.",
    runtime: { name: "bun", version: Bun.version, path: paths.bun },
    mainExists,
    authRequired: false,
    service,
  };
}

export async function mutate(command: "install" | "start" | "stop" | "restart" | "uninstall") {
  if (domain === null || target === null) {
    throw new CliError(
      "unsupported_platform",
      "LaunchAgent management is only supported on macOS.",
    );
  }
  const before = await status();
  switch (command) {
    case "install": {
      await access(paths.bun, constants.X_OK);
      await access(paths.main, constants.R_OK);
      const contents = renderPlist();
      const previous = before.installed ? await Bun.file(paths.plist).text() : null;
      await mkdir(dirname(paths.plist), { recursive: true, mode: 0o700 });
      await mkdir(paths.logs, { recursive: true, mode: 0o700 });
      if (previous !== contents) {
        const temporary = join(dirname(paths.plist), `.${LABEL}.${crypto.randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, "wx", 0o600);
          try {
            await handle.writeFile(contents);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, paths.plist);
        } finally {
          await rm(temporary, { force: true });
        }
        if (before.loaded) await run(["bootout", target]);
      }
      await run(["enable", target]);
      if (!before.loaded || previous !== contents) {
        await run(["bootstrap", domain, paths.plist]);
      } else if (!before.running) {
        await run(["kickstart", target]);
      }
      break;
    }
    case "start":
    case "restart":
      if (!before.installed) {
        throw new CliError("not_installed", "Run install first.");
      }
      await run(["enable", target]);
      if (!before.loaded) {
        await run(["bootstrap", domain, paths.plist]);
      } else {
        switch (command) {
          case "restart":
            await run(["kickstart", "-k", target]);
            break;
          case "start":
            if (!before.running) await run(["kickstart", target]);
            break;
          default: {
            const exhaustive: never = command;
            return exhaustive;
          }
        }
      }
      break;
    case "stop":
      if (before.loaded) await run(["bootout", target]);
      break;
    case "uninstall":
      if (before.loaded) await run(["bootout", target]);
      await rm(paths.plist, { force: true });
      break;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
  return { command, label: LABEL, plist: paths.plist, statePreserved: true };
}

export async function logs(lines: number) {
  const files = await Promise.all(
    [paths.stdout, paths.stderr].map(async (path) => {
      const file = Bun.file(path);
      const exists = await file.exists();
      if (!exists) return { path, exists, truncated: false, text: "" };
      const start = Math.max(0, file.size - 65_536);
      const text = await file.slice(start).text();
      const newline = text.indexOf("\n");
      const complete = start === 0 ? text : newline < 0 ? "" : text.slice(newline + 1);
      const entries = complete.replace(/\n$/, "").split("\n");
      return {
        path,
        exists,
        truncated: start > 0 || entries.length > lines,
        text: entries.slice(-lines).join("\n"),
      };
    }),
  );
  return { lines, files };
}
