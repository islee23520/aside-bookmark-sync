#!/bin/bash
set -euo pipefail
umask 077

repo=$(cd "$(dirname "$0")/.." && pwd -P)
source_dir="$repo/extension"
output_dir="$repo/releases"
output="$output_dir/aside-bookmark-sync-0.1.0.zip"

for required in manifest.json popup.html popup.css dist/service-worker.js dist/popup.js \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png; do
  [[ -f "$source_dir/$required" ]] || {
    printf 'Missing extension artifact: %s\n' "$required" >&2
    exit 1
  }
done

mkdir -p "$output_dir"
rm -f "$output"
(
  cd "$source_dir"
  /usr/bin/zip -q -r "$output" \
    manifest.json popup.html popup.css dist icons
)
printf '%s\n' "$output"
