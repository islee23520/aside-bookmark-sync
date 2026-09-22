import { PROTOCOL, ProtocolError, syncResponseSchema } from "./protocol";
import type { SyncRequest, SyncResponse } from "./protocol";
import type { Config } from "./storage";

export async function exchange(config: Config, request: SyncRequest): Promise<SyncResponse> {
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).length > PROTOCOL.maxBodyBytes) {
    throw new ProtocolError(413, "body_too_large");
  }
  // 별도 HTTP 의존성 없이 단일 루프백 요청만 허용한다. 재시도는 MV3 alarm이 담당한다.
  const response = await fetch(`${PROTOCOL.origin}/sync`, {
    method: "POST", body, credentials: "omit", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.credentials.authKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new ProtocolError(response.status, `companion_http_${response.status}`);
  return syncResponseSchema.parse(await response.json());
}
