# 로컬 companion 프로토콜 v1

`bun install` 후 `bun run companion`으로 실행한다. 서버 주소는 변경할 수 없는
`http://127.0.0.1:32145`이다. 기본 상태 경로는 `~/.aside-bookmark-sync/state.json`이며,
`ASIDE_BOOKMARK_SYNC_STATE_DIR`로 폐기 가능한 디렉터리를 지정할 수 있다.

## 공유 계약

- `src/shared/auth.ts`의 `deriveCredentials(password)`는 Web Crypto PBKDF2-SHA256,
  600,000회, 고정 도메인 salt `aside-bookmark-sync:v1:auth`로 256비트 인증 키를 만든다.
  room ID는 인증 키 바이트의 SHA-256이다. 같은 비밀번호는 같은 room으로 연결된다.
- 비밀번호 문자열은 저장하거나 요청에 넣지 않는다. 확장은 파생된 `Credentials`만
  저장한다. 인증 키는 비밀번호와 동등하게 취급하며 `Authorization: Bearer <authKey>`로
  루프백에만 전송한다. 서버는 인증 키도 저장하지 않는다.
- 이 방식은 루프백의 bearer 인증이다. 동일 컴퓨터의 악성 프로세스나 탈취된 키를
  방어하는 암호화 채널은 아니다. 서로 다른 비밀번호로 파생한 room은 서로 격리된다.
  기존 room ID에 다른 비밀번호의 인증 키를 사용하면 HTTP 401이다.
- HTTP `POST /sync`는 `Content-Type: application/json`, 최대 1 MiB이다.
  JSON 필드는 `version: 1`, `roomId`, `clientId`, `baseRevision`, `sequence`, `items`이다.
  응답 필드는 `version`, `revision`, `items`이며 Zod 스키마는 `src/shared/protocol.ts`에 있다.
- client ID는 영숫자·`_`·`-` 1–64자다. `sequence`는 클라이언트별로 영속 저장하고
  요청할 때마다 증가시킨다. 최초 값은 1, `baseRevision` 최초 값은 0이다.
  재전송은 새 sequence를 사용한다. 같은 값이나 과거 sequence는 HTTP 409다.
  이전 revision 기반 요청은 항목 시각으로 병합하지만 미래 revision은 거부한다.
- 항목 공통 필드는 `kind`, `path`(부모 폴더명 배열), `title`, `updatedAt`(Unix ms),
  `deletedAt`(Unix ms 또는 null), `sourceClientId`다. `kind: "bookmark"`는 `url`도 가진다.
  폴더는 `kind: "folder"`다. 논리 키는 kind + 부모 경로 + URL/폴더 제목이다.
  URL·폴더 이름·경로 변경은 이전 키의 tombstone과 새 키의 항목으로 표현한다.
- `deletedAt ?? updatedAt`이 최신인 항목이 이기고, 동률이면 `sourceClientId` 사전순의
  큰 값이 이긴다. 같은 출처·시각에서는 삭제 우선, 그 뒤 정규 필드 JSON 사전순으로
  결정한다. 반환 항목은 논리 키 사전순이다. snapshot에서 누락된 항목은 삭제하지 않는다.
- 30일이 지난 tombstone 본문은 다음 동기화 때 제거한다. 키별 삭제 시각은 계속 보관해
  오래된 오프라인 snapshot의 부활을 막는다. 이후 시각의 명시적 재생성은 허용한다.
- 최대 32 rooms, room당 32 clients, snapshot/병합 항목 5,000개, 삭제 시각 100,000개,
  상태 파일 64 MiB이다. 용량 초과는 HTTP 507이며 기존 파일을 변경하지 않는다.
  정상 요청마다 revision을 증가시킨다. 쓰기는 직렬화하고 0600 임시 파일을 fsync한 뒤
  원자적으로 교체한다. 디렉터리 생성 권한은 0700이다.

## HTTP 경계

`GET /health`는 `{ "ok": true, "version": 1 }`이다. 모든 요청에서 실제 peer 주소와
Host를 검사하며 Host는 `127.0.0.1:32145`만 허용한다. 웹페이지 Origin은 거부하고
`chrome-extension://<32자 확장 ID>`의 preflight와 요청만 CORS 허용한다.
Origin이 없는 로컬 CLI도 사용할 수 있지만 sync에는 항상 인증이 필요하다.
버전·구조 오류는 400, 인증 오류는 401, Host/Origin 오류는 403, 타입 오류는 415다.
로그에는 허용된 Host, peer 주소, 상태 코드만 남기며 URL·body·인증 헤더는 기록하지 않는다.

상태 파일은 북마크 URL과 제목을 평문으로 보관한다. 브라우저 프로필에 접근하지 않는다.
SIGINT/SIGTERM은 리스너를 닫고 진행 중인 저장 큐를 완료한 뒤 종료한다.
