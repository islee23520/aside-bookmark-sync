import { applySnapshot, capture } from "./bookmarks";
import { exchange } from "./companion-client";
import { mergeSnapshots, PROTOCOL, syncRequestSchema, timestampSchema } from "./protocol";
import { loadState, saveState } from "./storage";

export const RETRY_ALARM = "bookmark-sync-retry";

export async function ensureAlarm(): Promise<void> {
  if (await chrome.alarms.get(RETRY_ALARM) === undefined) {
    await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  }
}

export async function synchronize(): Promise<void> {
  await ensureAlarm();
  let state = await loadState();
  const config = state.config;
  if (config === null) return;
  try {
    state = { ...state, status: { ...state.status, phase: "syncing", error: null } };
    await saveState(state);
    // 워커 종료 직전의 적용 저널은 네트워크 요청 전에 재개한다.
    if (state.pending !== null) {
      const current = await capture(state, config);
      await applySnapshot(current, state.pending);
      state = { ...state, items: state.pending, pending: null };
      await saveState(state);
    }
    const current = await capture(state, config);
    const request = syncRequestSchema.parse({
      version: PROTOCOL.version, roomId: config.credentials.roomId, clientId: config.clientId,
      baseRevision: state.revision, sequence: state.sequence + 1, items: current.items,
    });
    // 요청이 서버에 도달한 뒤 워커가 중단되어도 sequence를 재사용하지 않는다.
    state = {
      ...state, sequence: request.sequence, items: request.items,
      clock: timestampSchema.parse(Math.max(Date.now(), state.clock + 1)),
    };
    await saveState(state);
    const response = await exchange(config, request);
    // HTTP 요청 중 발생한 사용자 편집도 병합한다.
    const latest = await capture(state, config);
    const desired = mergeSnapshots([latest.items, response.items]);
    state = { ...state, revision: response.revision, pending: desired };
    await saveState(state);
    await applySnapshot(latest, desired);
    const applied = await capture({ ...state, items: desired }, config);
    state = {
      ...state, items: applied.items, pending: null,
      status: { phase: "synced", lastSyncAt: timestampSchema.parse(Date.now()), error: null },
    };
    await saveState(state);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // 입력 및 북마크 URL이 포함될 수 있는 원문 오류는 저장하거나 기록하지 않는다.
    const code = error.name === "ProtocolError" ? error.message : error.name;
    await saveState({ ...state, status: { ...state.status, phase: "error", error: code } });
    console.error(JSON.stringify({ event: "sync_failed", type: error.name }));
  }
}
