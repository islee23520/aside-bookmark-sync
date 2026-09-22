import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "com.islee23520.aside-bookmark-companion";
const home = homedir();
const state = join(home, ".aside-bookmark-sync");

export const paths = {
  bun: process.execPath,
  main: fileURLToPath(new URL("../main.ts", import.meta.url)),
  home,
  state,
  logs: join(state, "logs"),
  stdout: join(state, "logs", "stdout.log"),
  stderr: join(state, "logs", "stderr.log"),
  plist: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
} as const;

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(paths.bun)}</string>
    <string>--no-env-file</string>
    <string>${xml(paths.main)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(dirname(paths.main))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xml(paths.home)}</string>
    <key>ASIDE_BOOKMARK_SYNC_STATE_DIR</key><string>${xml(paths.state)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(paths.stdout)}</string>
  <key>StandardErrorPath</key><string>${xml(paths.stderr)}</string>
</dict>
</plist>
`;
}
