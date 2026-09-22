import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { roomIdFromAuthKey } from "../src/shared/auth";
import { authKeySchema, PROTOCOL, ProtocolError, syncRequestSchema } from "../src/shared/protocol";
import type { StateStore } from "./state";

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

export function startServer(store: StateStore) {
  return Bun.serve({
    hostname: PROTOCOL.hostname,
    port: PROTOCOL.port,
    maxRequestBodySize: PROTOCOL.maxBodyBytes,
    idleTimeout: 10,
    async fetch(request, server) {
      const address = server.requestIP(request)?.address ?? "unknown";
      const host = request.headers.get("host") ?? "";
      const origin = request.headers.get("origin");
      const headers = new Headers({ "Cache-Control": "no-store" });
      if (origin !== null && extensionOrigin.test(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
      }
      let status = 500;
      try {
        if (address !== PROTOCOL.hostname || host !== `127.0.0.1:${PROTOCOL.port}`) {
          throw new ProtocolError(403, "loopback_required");
        }
        if (origin !== null && !extensionOrigin.test(origin)) {
          throw new ProtocolError(403, "origin_forbidden");
        }
        const url = new URL(request.url);
        if (url.search !== "") throw new ProtocolError(400, "query_forbidden");
        if (request.method === "GET" && url.pathname === "/health") {
          status = 200;
          return Response.json({ ok: true, version: PROTOCOL.version }, { status, headers });
        }
        if (url.pathname !== "/sync") throw new ProtocolError(404, "not_found");
        if (request.method === "OPTIONS" && origin !== null) {
          headers.set("Access-Control-Allow-Methods", "POST");
          headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
          status = 204;
          return new Response(null, { status, headers });
        }
        if (request.method !== "POST") throw new ProtocolError(405, "method_not_allowed");
        if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
          throw new ProtocolError(415, "json_required");
        }
        const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (token === undefined) throw new ProtocolError(401, "unauthorized");
        const authKey = authKeySchema.parse(token);
        const body = await request.text();
        if (Buffer.byteLength(body) > PROTOCOL.maxBodyBytes)
          throw new ProtocolError(413, "body_too_large");
        const payload = syncRequestSchema.parse(JSON.parse(body));
        const derivedRoom = await roomIdFromAuthKey(authKey);
        if (!timingSafeEqual(Buffer.from(derivedRoom, "hex"), Buffer.from(payload.roomId, "hex"))) {
          throw new ProtocolError(401, "unauthorized");
        }
        const response = await store.sync(payload);
        status = 200;
        return Response.json(response, { status, headers });
      } catch (error) {
        if (error instanceof ProtocolError) {
          status = error.status;
          return Response.json({ error: error.code }, { status, headers });
        }
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          status = 400;
          return Response.json({ error: "invalid_request" }, { status, headers });
        }
        if (error instanceof Error) {
          // 메시지·stack에는 입력이나 파일 내용이 섞일 수 있으므로 기록하지 않는다.
          console.error(
            JSON.stringify({ level: "error", event: "request_failed", type: error.name }),
          );
          return Response.json({ error: "internal_error" }, { status, headers });
        }
        throw error;
      } finally {
        // 원문 Host는 비밀을 포함할 수 있어 허용한 값만 기록한다.
        console.info(
          JSON.stringify({
            level: "info",
            event: "request",
            address,
            host: host === `127.0.0.1:${PROTOCOL.port}` ? host : "rejected",
            status,
          }),
        );
      }
    },
  });
}
