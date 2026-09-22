#!/bin/bash
# 이 파일은 disposable-launch.sh와 bookmark-snapshot.sh에서만 불러온다.

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

digest() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }

canonical_dir() { (cd "$1" && pwd -P); }

port_available() {
  local status=0 result
  result=$(/usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null) || status=$?
  [[ $status -le 1 ]] || fail '포트 소유자를 확인할 수 없습니다.'
  [[ -z $result ]] || fail "포트가 이미 사용 중입니다: $1 (기존 프로세스는 종료하지 않음)"
}

copy_bookmarks() {
  local label=$1 source=$2 destination=$3 attempt before after copied temporary
  mkdir -m 700 -p "$destination/Default"
  for attempt in 1 2; do
    temporary=$(mktemp "$destination/Default/.Bookmarks.XXXXXX")
    before=$(digest "$source")
    /bin/cp -X "$source" "$temporary"
    chmod 600 "$temporary"
    copied=$(digest "$temporary")
    after=$(digest "$source")
    printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$attempt" "$before" "$copied" "$after" >> "$evidence/copy-checksums.tsv"
    if [[ $before == "$after" ]]; then
      [[ $copied == "$after" ]] || fail "$label: 안정된 원본과 사본의 체크섬이 다릅니다."
      mv "$temporary" "$destination/Default/Bookmarks"
      return
    fi
    rm -f "$temporary"
  done
  fail "$label: 두 번의 복사 중 원본이 변경되어 중단합니다."
}

check_runtime() {
  [[ -d $1 && ! -L $1 && -O $1 ]] || fail '소유한 임시 런타임 디렉터리가 아닙니다.'
  [[ $(dirname "$1") == /private/tmp ]] || fail '런타임은 /private/tmp 바로 아래여야 합니다.'
  [[ $(basename "$1") == bookmark-sync.* ]] || fail '런타임 이름이 잘못되었습니다.'
  [[ -f $1/.bookmark-sync-runtime && ! -L $1/.bookmark-sync-runtime ]] || fail '런처의 런타임 표시가 없습니다.'
  [[ $(< "$1/.bookmark-sync-runtime") == bookmarks-only-v1 ]] || fail '런타임 표시가 잘못되었습니다.'
}

# job control로 각 자식을 독립 프로세스 그룹에 둔다. 이름/포트 기반 pkill 금지.
start_owned() {
  local label=$1
  shift
  (
    cd "$runtime"
    export HOME="$runtime/home" TMPDIR="$runtime/tmp/"
    export XDG_CONFIG_HOME="$runtime/home/config" XDG_CACHE_HOME="$runtime/home/cache"
    export XDG_DATA_HOME="$runtime/home/data" XDG_STATE_HOME="$runtime/home/state"
    exec "$@"
  ) > "$evidence/$label.log" 2>&1 &
  owned_pids+=("$!")
  printf '%s\t%s\n' "$label" "$!" >> "$evidence/processes.tsv"
}

cleanup() {
  local result=$? pid group_active=0 current
  trap - EXIT
  trap '' INT TERM HUP
  set +e
  for pid in ${owned_pids[@]+"${owned_pids[@]}"}; do
    if kill -0 -- "-$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null
      group_active=1
    fi
  done
  if [[ $group_active == 1 ]]; then
    # FIFO를 읽는 제한 시간은 종료 유예 시간이다. sleep 자식을 남기지 않는다.
    read -r -t 3 -u 9 current || :
  fi
  for pid in ${owned_pids[@]+"${owned_pids[@]}"}; do
    if kill -0 -- "-$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" 2>/dev/null
    fi
    wait "$pid" 2>/dev/null || :
  done
  if [[ -n $runtime ]]; then
    if (check_runtime "$runtime"); then
      rm -rf -- "$runtime" || result=1
    else
      result=1
    fi
  fi
  if [[ -n $evidence ]]; then
    if [[ -n $aside_before && -n $edge_before ]]; then
      current=$(digest "$aside_source") || result=1
      printf 'aside\t%s\n' "$current" >> "$evidence/source-after.tsv"
      [[ $current == "$aside_before" ]] || result=1
      current=$(digest "$edge_source") || result=1
      printf 'edge\t%s\n' "$current" >> "$evidence/source-after.tsv"
      [[ $current == "$edge_before" ]] || result=1
      cmp -s "$evidence/source-before.tsv" "$evidence/source-after.tsv"
      printf 'source_checksums_match=%s\n' "$?" >> "$evidence/cleanup.log"
    fi
    printf 'runtime_cleanup_attempted=%s\n' "$runtime" >> "$evidence/cleanup.log"
    for pid in ${owned_pids[@]+"${owned_pids[@]}"}; do
      if kill -0 -- "-$pid" 2>/dev/null; then
        printf 'remaining_process_group=%s\n' "$pid" >> "$evidence/cleanup.log"
        result=1
      fi
    done
    if [[ $launched == 1 ]]; then
      for current in "$aside_port" "$edge_port" "$companion_port"; do
        if ! (port_available "$current"); then
          printf 'remaining_listener_port=%s\n' "$current" >> "$evidence/cleanup.log"
          result=1
        fi
      done
    fi
    printf 'exit_code=%s\n' "$result" >> "$evidence/cleanup.log"
    printf 'CLEANUP exit_code=%s evidence=%s\n' "$result" "$evidence"
  fi
  exit "$result"
}
