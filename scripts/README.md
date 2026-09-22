# 폐기 가능한 북마크 프로필

macOS의 `/Applications/Aside.app`, `/Applications/Microsoft Edge.app`용 도구다.
필요 도구는 macOS Bash, `shasum`, `lsof`, 그리고 `jq`다. 설치나 빌드는 수행하지 않는다.

## 준비만 검증

```bash
cd /path/to/aside-bookmark-sync
for file in scripts/*.sh; do bash -n "$file" || break; done
bash scripts/disposable-launch.sh --prepare-only --evidence /private/tmp/bookmark-evidence-unique
```

증거 경로의 부모는 존재해야 하고 마지막 디렉터리는 새 경로여야 한다.
준비 모드는 브라우저, companion, automation을 실행하거나 포트를 열지 않는다.
`$HOME/Library/Application Support/{Aside,Microsoft Edge}/Default/Bookmarks`만 읽어
체크섬을 계산하고 `/private/tmp/bookmark-sync.XXXXXXXX/{aside,edge}/Default/Bookmarks`로 복사한다.
원본을 파싱하거나 출력하지 않는다. `User 0`은 두 브라우저의 `Default` 디렉터리로 해석한다.

각 복사는 임시 파일에서 수행한다. 원본 복사 전후 SHA-256과 사본 SHA-256이 모두 같아야
최종 사본으로 이동한다. 복사 중 원본 체크섬이 바뀐 경우에만 한 번 재시도한다.
실제 브라우저를 종료할 필요는 없다. 실행 전체의 원본 체크섬이 달라지면 종료 코드는 1이다.
사용자가 실제 브라우저에서 북마크를 수정한 경우도 불일치로 보고하며 원본을 복원하지 않는다.

새 루트에는 북마크 이외의 원본 파일이 없으므로 쿠키, 비밀번호, 로그인 토큰, 세션,
기존 확장, Local State, singleton/lock 파일은 복사되지 않는다. 기존 프로필의 잠금을 지우지 않는다.

## 브라우저 실행 (별도 승인된 E2E 때만)

확장 빌드 산출물은 `--extension`으로 지정한다. 현재 companion은
`companion/main.ts`이며 `127.0.0.1:32145` 고정 포트를 사용한다.
아래 `/absolute/...` 경로를 실제 빌드/실행 파일로 바꾼다. wrapper는
`exec bun run /절대/저장소/companion/main.ts` 형태로 실행한다.

```bash
bash scripts/disposable-launch.sh --launch \
  --evidence /private/tmp/bookmark-evidence-new-run \
  --extension /absolute/built-unpacked-extension \
  --companion /absolute/companion-wrapper \
  --companion-port 32145 --aside-port 49321 --edge-port 49322 \
  -- /absolute/automation-wrapper
```

- 확장 경로에는 MV3 `manifest.json`이 있어야 한다. 설치 성공은 아직 검증하지 않는다.
- companion/automation은 포그라운드 실행 파일이어야 한다. daemonize, `setsid`, 프로세스 그룹
  변경 및 런처 밖으로 프로세스를 넘기는 실행기는 지원하지 않는다.
- companion wrapper는 `E2E_COMPANION_HOST=127.0.0.1`, `E2E_COMPANION_PORT`,
  `E2E_COMPANION_DATA_DIR`를 실제 companion 옵션에 연결해야 한다. 현재 구현에 대해서는
  런처가 `ASIDE_BOOKMARK_SYNC_STATE_DIR`도 임시 디렉터리로 설정한다. 포트는 32145로 지정한다.
  기존 companion을 재사용하지 않는다.
- automation은 `E2E_ASIDE_ROOT`, `E2E_EDGE_ROOT`, `E2E_ASIDE_PORT`, `E2E_EDGE_PORT`,
  `E2E_RUNTIME`, `E2E_EVIDENCE`를 받는다. 실제 프로필로 연결하거나 별도 브라우저를 띄우면 안 된다.
  브라우저/확장/companion 준비 완료와 각 작업 완료를 정확한 신호로 기다리고 자체 제한 시간을 둔다.
  브라우저 조작은 Aside skill의 `aside-agent` 흐름을 사용한다.
- 세 포트는 서로 다르고 실행 전에 비어 있어야 한다. 디버깅 포트는 복제 프로필 자동화에만 쓰며
  루프백 주소를 명시한다. 브라우저 버전이 이 옵션을 지키는지는 실제 E2E에서 확인해야 한다.
- 브라우저마다 새 user-data-dir와 `Default`, `--no-first-run`, `--disable-sync`,
  `--disable-background-networking`, `--load-extension`을 지정한다. HOME/XDG/TMPDIR와 작업 디렉터리는 임시 위치다.
  이 옵션들은 OS 네트워크/파일 시스템 샌드박스가 아니므로 신뢰하는 확장과 실행기만 사용한다.

## 스냅샷과 증거

실행 중 automation이나 다른 터미널에서 다음을 사용할 수 있다.

```bash
bash scripts/bookmark-snapshot.sh "$E2E_RUNTIME" aside "$E2E_EVIDENCE/aside-checkpoint.json"
bash scripts/bookmark-snapshot.sh "$E2E_RUNTIME" edge "$E2E_EVIDENCE/edge-checkpoint.json"
```

출력 파일은 새 파일이어야 한다. 런처 표시가 있는 임시 디렉터리만 허용하고 심볼릭 링크는
거부한다. 사본만 파싱하며 URL/제목/쿠키를 출력하지 않고 파일 SHA-256, 날짜와 메타데이터를
제외한 구조 SHA-256, URL/폴더 개수를 기록한다. 스냅샷 중 변경되면 실패한다.

증거 디렉터리는 0700, 파일은 0600이다. `source-before.tsv`, `source-after.tsv`,
`copy-checksums.tsv`, `run.json`, 두 사본의 before 스냅샷, `cleanup.log`가 남는다.
실행 모드에는 `processes.tsv`, 각 프로세스의 `.log`, 성공 시 after 스냅샷도 남는다.
프로세스 로그는 원문 stdout/stderr이므로 공유하기 전에 검토한다. 실행기에 비밀을 출력시키지 않는다.
준비 모드 증거에는 북마크 원문이 없다.

정상 종료, 오류, INT/TERM/HUP에서 소유한 프로세스 그룹에 TERM을 보내고 3초 유예 후
남은 그룹만 KILL한다. 자식을 회수하고 임시 런타임을 삭제한다. 기존 프로세스는 이름이나
포트로 죽이지 않는다. 종료 후 남은 그룹/리스너는 실패로 기록한다.
`cleanup.log`의 `source_checksums_match=0`은 `cmp` 종료 코드 0(일치)이며 `exit_code=0`이 성공이다.
SIGKILL, 전원 종료는 trap이 실행될 수 없으므로 자동 정리를 보장하지 않는다.

이 작업에서는 테스트를 추가/실행하지 않고 구문 검사와 준비·정리만 검증한다.
