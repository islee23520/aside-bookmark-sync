#!/bin/bash
set -euo pipefail
umask 077
scripts=$(cd "$(dirname "$0")" && pwd -P)
source "$scripts/disposable-common.sh"
mode=prepare
evidence_arg= extension= companion= runtime= evidence=
aside_before= edge_before= launched=0
aside_port=49321 edge_port=49322 companion_port=
owned_pids=()
automation=()
aside_root="$HOME/Library/Application Support/Aside"
edge_root="$HOME/Library/Application Support/Microsoft Edge"
usage() {
  printf '%s\n' \
    '준비: bash scripts/disposable-launch.sh --prepare-only --evidence NEW_DIR' \
    '실행: bash scripts/disposable-launch.sh --launch --evidence NEW_DIR --extension DIR --companion EXECUTABLE --companion-port PORT [--aside-port PORT --edge-port PORT] -- AUTOMATION [ARG...]' \
    '복제 대상은 Aside/Default/Bookmarks 및 Microsoft Edge/Default/Bookmarks뿐입니다.' \
    'companion과 automation은 E2E_* 환경 변수 및 임시 작업 디렉터리를 사용해야 합니다.'
}
while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h) usage; exit 0 ;;
    --prepare-only) mode=prepare; shift ;;
    --launch) mode=launch; shift ;;
    --evidence|--extension|--companion|--companion-port|--aside-port|--edge-port)
      [[ $# -ge 2 && -n $2 ]] || fail '옵션 값이 없습니다.'
      case $1 in
        --evidence) evidence_arg=$2 ;;
        --extension) extension=$2 ;;
        --companion) companion=$2 ;;
        --companion-port) companion_port=$2 ;;
        --aside-port) aside_port=$2 ;;
        --edge-port) edge_port=$2 ;;
      esac
      shift 2 ;;
    --) shift; automation=("$@"); break ;;
    *) fail '알 수 없는 옵션입니다. --help를 확인하세요.' ;;
  esac
done
[[ $(uname -s) == Darwin ]] || fail 'macOS 전용 런처입니다.'
command -v jq >/dev/null || fail 'jq가 필요합니다.'
[[ -n $evidence_arg && $evidence_arg != */../* ]] || fail '새 증거 디렉터리가 필요합니다.'
aside_root=$(canonical_dir "$aside_root")
edge_root=$(canonical_dir "$edge_root")
aside_source="$aside_root/Default/Bookmarks"
edge_source="$edge_root/Default/Bookmarks"
for source_file in "$aside_source" "$edge_source"; do
  [[ -f $source_file && ! -L $source_file && ! -L $(dirname "$source_file") ]] || fail '원본 북마크는 심볼릭 링크가 아닌 일반 파일이어야 합니다.'
done
# 부모는 기존 디렉터리여야 한다. 원본 내부에 증거를 쓰는 실수를 막는다.
parent=$(canonical_dir "$(dirname "$evidence_arg")")
evidence_path="$parent/$(basename "$evidence_arg")"
case "$evidence_path/" in "$aside_root/"*|"$edge_root/"*) fail '원본 프로필 내부에 증거를 저장할 수 없습니다.' ;; esac
[[ ! -e $evidence_path && ! -L $evidence_path ]] || fail '증거 경로는 존재하지 않는 새 디렉터리여야 합니다.'
case $mode in
  launch)
    [[ -n $extension && -n $companion && ${#automation[@]} -gt 0 ]] || fail '실행 모드에는 확장, companion 실행 파일, automation 명령이 필요합니다.'
    extension=$(canonical_dir "$extension")
    [[ $extension != *,* ]] || fail '확장 경로에는 쉼표를 사용할 수 없습니다.'
    jq -e '.manifest_version == 3' "$extension/manifest.json" >/dev/null 2>&1 || fail '빌드된 MV3 manifest.json이 필요합니다.'
    [[ $companion == /* && -f $companion && -x $companion ]] || fail 'companion은 절대 경로의 실행 파일이어야 합니다.'
    [[ ${automation[0]} == /* && -x ${automation[0]} ]] || fail 'automation은 절대 경로의 실행 파일이어야 합니다.'
    for port in "$aside_port" "$edge_port" "$companion_port"; do
      [[ $port =~ ^[1-9][0-9]{3,4}$ ]] && ((port <= 65535)) || fail '포트는 1000..65535 정수여야 합니다.'
      port_available "$port"
    done
    [[ $aside_port != "$edge_port" && $aside_port != "$companion_port" && $edge_port != "$companion_port" ]] || fail '포트 세 개는 서로 달라야 합니다.'
    [[ -x /Applications/Aside.app/Contents/MacOS/Aside && -x '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' ]] || fail '두 브라우저 앱이 필요합니다.'
    ;;
  prepare) [[ ${#automation[@]} == 0 ]] || fail 'prepare 모드에서 명령을 실행할 수 없습니다.' ;;
esac
mkdir -m 700 "$evidence_path"
evidence=$evidence_path
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
runtime=$(mktemp -d /private/tmp/bookmark-sync.XXXXXXXX)
printf 'bookmarks-only-v1\n' > "$runtime/.bookmark-sync-runtime"
mkdir -m 700 "$runtime/home" "$runtime/tmp" "$runtime/companion"
mkfifo -m 600 "$runtime/shutdown-clock"
exec 9<> "$runtime/shutdown-clock"
aside_before=$(digest "$aside_source")
edge_before=$(digest "$edge_source")
printf 'aside\t%s\nedge\t%s\n' "$aside_before" "$edge_before" > "$evidence/source-before.tsv"
printf 'browser\tattempt\tsource_before\tcopy\tsource_after\n' > "$evidence/copy-checksums.tsv"
copy_bookmarks aside "$aside_source" "$runtime/aside"
copy_bookmarks edge "$edge_source" "$runtime/edge"
export E2E_RUNTIME="$runtime" E2E_EVIDENCE="$evidence"
export E2E_ASIDE_ROOT="$runtime/aside" E2E_EDGE_ROOT="$runtime/edge"
export E2E_COMPANION_DATA_DIR="$runtime/companion" E2E_COMPANION_HOST=127.0.0.1
export ASIDE_BOOKMARK_SYNC_STATE_DIR="$runtime/companion"
export E2E_ASIDE_PORT="$aside_port" E2E_EDGE_PORT="$edge_port" E2E_COMPANION_PORT="$companion_port"
jq -n --arg mode "$mode" --arg runtime "$runtime" \
  --arg aside_port "$aside_port" --arg edge_port "$edge_port" --arg companion_port "$companion_port" \
  '{mode: $mode, runtime: $runtime, profile: "Default", copied: ["Default/Bookmarks"], aside_port: $aside_port, edge_port: $edge_port, companion_port: $companion_port}' > "$evidence/run.json"
bash "$scripts/bookmark-snapshot.sh" "$runtime" aside "$evidence/aside-before.json"
bash "$scripts/bookmark-snapshot.sh" "$runtime" edge "$evidence/edge-before.json"
printf 'PREPARED mode=%s runtime=%s\n' "$mode" "$runtime"
[[ $mode == launch ]] || exit 0
# 직접 바이너리 실행: open -a의 기존 앱 인스턴스 재사용을 피한다.
set -m
launched=1
start_owned companion "$companion"
browser_flags=(--profile-directory=Default --no-first-run --no-default-browser-check
  --disable-sync --disable-background-networking --disable-component-update
  --disable-default-apps --disable-extensions-except="$extension"
  --load-extension="$extension" --remote-debugging-address=127.0.0.1)
start_owned aside /Applications/Aside.app/Contents/MacOS/Aside \
  --user-data-dir="$E2E_ASIDE_ROOT" --remote-debugging-port="$aside_port" "${browser_flags[@]}" about:blank
start_owned edge '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
  --user-data-dir="$E2E_EDGE_ROOT" --remote-debugging-port="$edge_port" "${browser_flags[@]}" about:blank
# 준비 완료 조건(포트/확장/companion) 구독과 제한 시간은 automation의 책임이다.
start_owned automation "${automation[@]}"
automation_pid=${owned_pids[3]}
wait "$automation_pid"
bash "$scripts/bookmark-snapshot.sh" "$runtime" aside "$evidence/aside-after.json"
bash "$scripts/bookmark-snapshot.sh" "$runtime" edge "$evidence/edge-after.json"
