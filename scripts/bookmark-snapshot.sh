#!/bin/bash
set -euo pipefail
umask 077
scripts=$(cd "$(dirname "$0")" && pwd -P)
source "$scripts/disposable-common.sh"
[[ $# == 3 ]] || fail '사용법: bash scripts/bookmark-snapshot.sh RUNTIME aside|edge NEW_OUTPUT.json'
runtime=$(canonical_dir "$1")
check_runtime "$runtime"
case $2 in aside|edge) browser=$2 ;; *) fail '브라우저는 aside 또는 edge여야 합니다.' ;; esac
root="$runtime/$browser"
bookmarks="$root/Default/Bookmarks"
[[ ! -L $root && ! -L $root/Default && ! -L $bookmarks && -f $bookmarks ]] || fail '일반 복제 북마크 파일만 읽을 수 있습니다.'
command -v jq >/dev/null || fail 'jq가 필요합니다.'
# 원문은 stdout/증거에 쓰지 않는다. 날짜/메타데이터를 제외한 구조 해시도 수집한다.
before=$(digest "$bookmarks")
semantic=$(jq -ceS '
  def node:
    if .type == "url" then {type, name, url}
    elif .type == "folder" then {type, name, children: [.children[] | node]}
    else error("invalid bookmark node") end;
  .roots | with_entries(.value |= node)
' "$bookmarks" 2>/dev/null | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')
counts=$(jq -ce '
  [.roots[] | .. | objects | select(.type? == "url" or .type? == "folder")] |
  {urls: map(select(.type == "url")) | length,
   folders: map(select(.type == "folder")) | length}
' "$bookmarks" 2>/dev/null)
[[ $(digest "$bookmarks") == "$before" ]] || fail '스냅샷 중 사본이 바뀌었습니다. 브라우저 저장이 끝난 뒤 다시 실행하세요.'
# noclobber: 기존 파일 및 심볼릭 링크를 덮어쓰지 않는다.
set -C
jq -n --arg browser "$browser" --arg sha256 "$before" --arg semantic_sha256 "$semantic" \
  --argjson counts "$counts" '{browser: $browser, sha256: $sha256, semantic_sha256: $semantic_sha256, counts: $counts}' > "$3"
printf 'SNAPSHOT browser=%s output=%s\n' "$browser" "$3"
