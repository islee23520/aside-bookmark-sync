import { roomIdFromKey } from "./crypto";
import { assertNever, clientIdSchema, ProtocolError } from "./protocol";
import { INITIAL_STATE, loadState, messageSchema, saveState, stateView } from "./storage";
import { ensureAlarm, RETRY_ALARM, synchronize } from "./sync";

// 설정 변경과 동기화는 단일 큐가 소유한다. 모든 리스너는 await 전에 등록한다.
let queue: Promise<void> = Promise.resolve();
let scheduled = false;

function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action);
  queue = next.then(() => undefined, (error: unknown) => {
    if (!(error instanceof Error)) throw error;
    console.error(JSON.stringify({ event: "worker_failed", type: error.name }));
  });
  return next;
}

function scheduleSync(): void {
  if (scheduled) return;
  scheduled = true;
  void enqueue(async () => {
    scheduled = false;
    await synchronize();
  });
}

chrome.bookmarks.onCreated.addListener(scheduleSync);
chrome.bookmarks.onChanged.addListener(scheduleSync);
chrome.bookmarks.onMoved.addListener(scheduleSync);
chrome.bookmarks.onRemoved.addListener(scheduleSync);
chrome.bookmarks.onChildrenReordered.addListener(scheduleSync);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) scheduleSync();
});
chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) {
    reply({ ok: false, error: "invalid_message" });
    return false;
  }
  const message = parsed.data;
  const action = async () => {
    switch (message.type) {
      case "status": return stateView(await loadState());
      case "sync":
        await synchronize();
        return stateView(await loadState());
      case "configure": {
        const old = await loadState();
        const credentials = message.credentials ?? old.config?.credentials;
        if (credentials === undefined) throw new ProtocolError(400, "password_required");
        if (await roomIdFromKey(credentials.authKey) !== credentials.roomId) {
          throw new ProtocolError(400, "invalid_credentials");
        }
        const sameRoom = old.config?.credentials.roomId === credentials.roomId;
        const state = sameRoom ? old : INITIAL_STATE;
        await saveState({
          ...state,
          config: {
            label: message.label, credentials,
            clientId: state.config?.clientId ?? clientIdSchema.parse(crypto.randomUUID()),
          },
          status: { ...state.status, phase: "ready", error: null },
        });
        await synchronize();
        return stateView(await loadState());
      }
      default: return assertNever(message);
    }
  };
  const operation = message.type === "status" ? action() : enqueue(action);
  void operation.then((view) => reply({ ok: true, view }), (error: unknown) => {
    if (!(error instanceof Error)) throw error;
    reply({ ok: false, error: error.name === "ProtocolError" ? error.message : error.name });
  });
  return true;
});

void enqueue(async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await ensureAlarm();
});
