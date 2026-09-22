# Privacy Policy for Aside Bookmark Sync

Last updated: September 22, 2026

Aside Bookmark Sync synchronizes browser bookmarks between Chromium-based browsers on the same computer. It communicates only with the separately installed companion service at `http://127.0.0.1:32145`.

## Data handled

The extension handles:

- bookmark titles;
- bookmark URLs;
- bookmark folder paths;
- local change timestamps and deletion markers;
- a user-selected browser label;
- a password-derived authentication key and room identifier.

The original password is not stored or transmitted. The derived authentication key must be treated as sensitive because it is sufficient to authenticate to the local companion.

## Storage and transmission

Data is stored locally in browser extension storage and by the local companion under the current user's home directory. Bookmark synchronization requests are sent only to the loopback address `127.0.0.1`.

The extension does not send bookmark data, authentication material, analytics, telemetry, or personal information to the developer or to any external server.

## Third parties

Aside Bookmark Sync does not sell, share, or transfer user data to third parties. It does not use advertising, analytics, or remote tracking services.

## Permissions

- `bookmarks`: read and apply bookmark changes selected by the synchronization feature.
- `storage`: retain local settings, synchronization metadata, and pending changes.
- `alarms`: retry and receive synchronization while the Manifest V3 service worker is suspended between events.
- `http://127.0.0.1:32145/*`: communicate with the loopback-only companion service.

## Retention and deletion

Uninstalling the browser extension removes its browser-local storage. Companion data remains local until the user removes `~/.aside-bookmark-sync`. The companion CLI preserves state during normal uninstall so that removal is not destructive by default.

## Security

The companion binds only to `127.0.0.1`, validates authenticated requests, limits request size, and stores its files with user-only permissions. Users should protect their operating-system account and derived authentication key.

## Contact

Questions and security reports can be filed through the public GitHub repository:

https://github.com/islee23520/aside-bookmark-sync/issues
