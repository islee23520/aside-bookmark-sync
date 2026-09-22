# Aside Bookmark Sync

Local two-way bookmark sync between Aside and Microsoft Edge on the same Mac. You load the same unpacked Chrome Manifest V3 extension in both browsers, type the same local password, and a companion process on `127.0.0.1` exchanges changes.

There is no cloud, no external server, and no browser-account sync. Traffic never leaves loopback.

## Features

- Bidirectional sync of user-editable bookmarks and folders (toolbar, other, mobile).
- Add, title change, URL change, and delete, including delete tombstones so removals propagate.
- Same-password pairing. Matching passwords join the same sync room. A different password is a different room.
- Popup for browser name, password, connection status, last sync time, item count, revision, last error, and a manual sync button.
- Background retry about every 30 seconds while the extension is loaded.
- Last-write-wins merge by change time. Ties break on `sourceClientId`.
- macOS LaunchAgent so the companion starts at login and restarts after a crash.
- Two global command names: `aside-bookmar-companion` and `aside-bookmark-companion`.

## Architecture

```
Aside MV3 extension                 Edge MV3 extension
  chrome.bookmarks                    chrome.bookmarks
  chrome.storage.local                chrome.storage.local
           \                               /
            \ POST /sync, Bearer auth     /
             v                           v
              companion on 127.0.0.1:32145
                         |
                         v
              ~/.aside-bookmark-sync/state.json
```

The extension watches bookmark events, normalizes the editable tree, and POSTs JSON to `http://127.0.0.1:32145/sync`. The companion merges snapshots, stores the result on disk, and returns the merged set plus a revision. Each extension applies that snapshot locally.

Logical identity is kind + parent folder path + URL (bookmark) or folder title. A rename of a URL or folder is a tombstone of the old key plus a new item. Missing rows in a snapshot are not treated as deletes. Only explicit tombstones delete.

The HTTP surface is protocol version 1:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | `{ "ok": true, "version": 1 }` |
| `POST` | `/sync` | Authenticated merge. JSON body, max 1 MiB. |
| `OPTIONS` | `/sync` | CORS preflight for `chrome-extension://` origins |

The listen address is fixed: host `127.0.0.1`, port `32145`. It is not configurable. Host must be `127.0.0.1:32145`. Web page origins are rejected. Extension origins must match `chrome-extension://` plus a 32-character Chrome ID.

## Security and privacy

This product does not talk to a cloud or any host other than loopback.

**What is stored locally**

- Companion state (`~/.aside-bookmark-sync/state.json`) holds bookmark **titles and URLs in plaintext**, plus folder paths, timestamps, client IDs, and revisions.
- The extension stores the derived **auth key** and room ID in `chrome.storage.local`. That auth key is **password-equivalent**. Anyone who can read it can call `/sync` as that room.
- The original password string is not written to disk and is not sent on the wire. The extension derives credentials with PBKDF2-SHA256 (600,000 iterations, domain salt `aside-bookmark-sync:v1:auth`) and sends `Authorization: Bearer <authKey>` to loopback only. Room ID is SHA-256 of the auth key bytes.
- Companion logs record allowed host, peer address, and status code. They do not record URLs, bodies, or Authorization headers.
- State files are written mode `0600` into a `0700` directory, then replaced atomically.

**What this is not**

Loopback bearer auth isolates rooms that used different passwords. It is not an encrypted channel against other processes on the same Mac. A local process that can reach `127.0.0.1:32145` and present a stolen auth key is in that room. Do not reuse a password you care about elsewhere. Treat `state.json` and extension storage like bookmark export files.

Extension permissions are `bookmarks`, `storage`, `alarms`, and `http://127.0.0.1:32145/*` only.

## Limitations

- Sibling order inside a folder is **not** synced. Duplicates that share the same logical key collapse to one item.
- Service install, start, stop, restart, and uninstall are **macOS only**. `doctor` still runs elsewhere and reports that LaunchAgent management is unsupported.
- Branded Aside, Chrome, and Edge builds may **ignore `--load-extension`**. Load the unpacked extension by hand in Developer mode. Command-line injection of the extension is not a supported install path on those builds.
- One companion per machine. The port is fixed. Two listeners will fail to bind.
- Capacity: 32 rooms, 32 clients per room, 5,000 live items, 100,000 retained delete times, 64 MiB state file. Over those limits the companion returns HTTP 507 and leaves the previous file unchanged.
- Tombstone bodies older than 30 days are dropped. Delete times stay so an old offline snapshot cannot resurrect a removed item.
- This is same-computer sync, not multi-machine sync.

## Prerequisites

- macOS (for the LaunchAgent)
- [Bun](https://bun.sh)
- Aside and Microsoft Edge, Chrome 120 or newer API surface
- Bun's global bin directory on `PATH` (often `~/.bun/bin`)

No companion credentials are required. The CLI never asks for the bookmark password.

## Install

### 1. Clone and install dependencies

```bash
git clone https://github.com/islee23520/aside-bookmark-sync.git
cd aside-bookmark-sync
bun install
```

### 2. Install the global CLI

From the repository root:

```bash
bun install -g "$PWD"
```

That publishes both binaries from `package.json`:

| Command | Target |
| --- | --- |
| `aside-bookmar-companion` | `companion/cli.ts` |
| `aside-bookmark-companion` | `companion/cli.ts` |

They are the same program. Use either name.

Confirm the commands resolve:

```bash
aside-bookmar-companion --help
aside-bookmark-companion --help
```

If the shell cannot find them, add Bun's global bin directory to `PATH` and open a new terminal.

### 3. Build the unpacked extension

`extension/dist/` is gitignored. Build it before loading the extension:

```bash
bun run build:extension
```

That script is `bun build extension/service-worker.ts extension/popup.ts --outdir extension/dist --target browser`.

You should have `extension/dist/service-worker.js` and `extension/dist/popup.js` next to `extension/manifest.json`.

### 4. Install and start the LaunchAgent

```bash
aside-bookmar-companion --json doctor
aside-bookmar-companion install
```

`install` is idempotent. It writes `~/Library/LaunchAgents/com.islee23520.aside-bookmark-companion.plist`, enables the job in the current user's `gui/<uid>` domain, bootstraps it, and starts the companion at login.

The agent runs the same Bun binary that installed the CLI, with `companion/main.ts`, `--no-env-file`, working directory set to the companion package directory (not your shell cwd), `ASIDE_BOOKMARK_SYNC_STATE_DIR=~/.aside-bookmark-sync`, `RunAtLoad`, and KeepAlive after a non-success exit. Stdout and stderr go to `~/.aside-bookmark-sync/logs/`.

Do not also run `bun run companion` while the agent is listening. One process owns port `32145`.

### 5. Load the unpacked extension in Aside and Edge

In **each** browser:

1. Open the extensions page (`chrome://extensions` in Aside, `edge://extensions` in Edge).
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension` directory (the folder that contains `manifest.json`), not the repository root and not `extension/dist`.

Reload the extension after you rebuild `extension/dist`.

### 6. Pair with the same password

1. Pin or open the Aside Bookmark Sync popup in Aside.
2. Set a browser name (for example `Aside`).
3. Enter a local password you will reuse only for this pairing. Save.
4. Repeat in Edge with a different browser name and **the exact same password**.

Leave the password field empty later to keep the existing pairing. Saving a different password moves that browser to a different room.

The popup never refills the password. The plaintext password is not stored.

### 7. Verify

```bash
aside-bookmark-companion --json status
curl -sS http://127.0.0.1:32145/health
aside-bookmar-companion logs
```

Expect:

- `status` JSON with `"running": true`, `"installed": true`, `"loaded": true`, `"label": "com.islee23520.aside-bookmark-companion"`.
- Health body `{"ok":true,"version":1}`.
- Popup status moving to synced after you save the password, with a rising revision when bookmarks change.

Then add a bookmark in one browser and confirm it appears in the other. Rename or change the URL on one side, delete on the other. Mismatched passwords do not share a room.

`--json` success looks like `{"ok":true,"data":...}`. Failures print `{"ok":false,"error":{"code":"...","message":"..."}}` on stdout and exit 1.

## CLI

```text
aside-bookmar-companion [--json] <command>
aside-bookmark-companion [--json] <command>
```

| Command | What it does |
| --- | --- |
| `doctor` | Platform, Bun path, whether `companion/main.ts` exists, LaunchAgent status. `authRequired` is always false. |
| `install` | Atomically write the plist, enable, bootstrap, start. Safe to repeat. |
| `start` | Start an already installed agent. Leaves a running job alone. Fails with `not_installed` if you skipped `install`. |
| `stop` | `bootout` for this login session. The plist stays. The job starts again at the next login. |
| `restart` | Kickstart (or bootstrap if unloaded). Starts the job if it was stopped. |
| `status` | `installed`, `loaded`, `running`, `pid`, `lastExitCode`, paths. |
| `logs` | Tail stdout/stderr. `--lines` is an integer 1..1000, default 100. Each file is capped at 64 KiB of readback. |
| `uninstall` | Stop the job and delete the plist. **State and logs are kept.** |

`--help` / `-h` (or no command) prints usage. `--lines` is valid only on `logs`.

Unknown commands:

```bash
aside-bookmar-companion --json not-a-command
```

Exits 1 with `error.code` `unknown_command`.

Human output for `doctor`, `status`, and mutate results is indented JSON. `logs` prints `==> path <==` sections. `--json` wraps the same payloads in `{ok, data}`.

### LaunchAgent details

| Item | Value |
| --- | --- |
| Label | `com.islee23520.aside-bookmark-companion` |
| Plist | `~/Library/LaunchAgents/com.islee23520.aside-bookmark-companion.plist` |
| Domain | `gui/<uid>` via `launchctl bootstrap` / `bootout` / `kickstart` |
| State | `~/.aside-bookmark-sync` (`state.json`) |
| Logs | `~/.aside-bookmark-sync/logs/stdout.log`, `stderr.log` |
| Program | Bun + globally installed package `companion/main.ts` |

`stop` is not a permanent disable. Use `uninstall` to drop the agent. After uninstall you may delete `~/.aside-bookmark-sync` yourself if you also want the plaintext bookmark copy gone. That directory is not removed automatically.

Foreground companion (development, no agent):

```bash
bun run companion
```

Optional override: `ASIDE_BOOKMARK_SYNC_STATE_DIR=/path/to/empty-dir`. Default is still `~/.aside-bookmark-sync`. SIGINT and SIGTERM close the listener, finish the write queue, then exit.

## Uninstall

```bash
aside-bookmar-companion uninstall
```

Then:

1. Remove the unpacked extension from Aside and Edge.
2. Optional: `bun uninstall -g aside-bookmark-sync` (or delete the global links Bun created).
3. Optional: delete `~/.aside-bookmark-sync` if you do not want local titles and URLs on disk.

`uninstall` does not revert bookmarks already written into either browser.

## Development

```bash
bun install
bun run typecheck
bun run check
bun run companion
bun run build:extension
```

`bun run check` runs Biome on `companion`, `src/shared`, and the root JSON/TSConfig files. Reload the unpacked extension after rebuilding `dist`.

## Repository layout

```text
companion/           Loopback HTTP server, LaunchAgent CLI
companion/cli.ts     Global bin entry
companion/main.ts    Server process started by the agent
extension/           Unpacked MV3 extension (load this folder)
extension/dist/      Built service worker and popup (generated)
src/shared/          Auth derivation, merge, protocol schemas
src/sync/            Bookmark tree helpers
scripts/             Disposable-profile helpers for local experiments
package.json         Bin aliases and bun scripts
```

`scripts/` copies bookmark files into throwaway profile roots. It is not required to run the companion day to day.

## License

See the repository for license terms. Treat local state and the derived auth key as sensitive.
