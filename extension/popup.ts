import { deriveCredentials } from "./crypto";
import { assertNever, ProtocolError } from "./protocol";
import { replySchema, type stateView, stateViewFromStored } from "./storage";

function element<T extends HTMLElement>(selector: string, type: new () => T): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new ProtocolError(500, "popup_markup_invalid");
  return node;
}

const form = element("#settings", HTMLFormElement);
const label = element("#label", HTMLInputElement);
const password = element("#password", HTMLInputElement);
const sync = element("#sync", HTMLButtonElement);
const save = element("#save", HTMLButtonElement);
const status = element("#status", HTMLElement);
const lastSync = element("#last-sync", HTMLElement);
const count = element("#count", HTMLElement);
const revision = element("#revision", HTMLElement);
const error = element("#error", HTMLElement);
const feedback = element("#feedback", HTMLElement);
const help = element("#password-help", HTMLElement);

// 팝업 수명 안에서만 변경되는 화면 상태이다. 자격 증명은 화면에 다시 채우지 않는다.
let paired = false;
let busy = false;
let initialized = false;
let renderedView: ReturnType<typeof stateView> | undefined;
let renderedViewKey: string | undefined;

function viewKey(view: ReturnType<typeof stateView>): string {
  return JSON.stringify([view, busy]);
}

function render(view: ReturnType<typeof stateView>): void {
  const key = viewKey(view);
  if (key === renderedViewKey) return;
  renderedViewKey = key;
  renderedView = view;
  paired = view.paired;
  if (!initialized) {
    label.value = view.label;
    initialized = true;
  }
  password.required = !paired;
  help.textContent = paired
    ? "암호를 비워 두면 기존 연결을 유지합니다. 다른 암호를 저장하면 별도 동기화 공간으로 연결됩니다."
    : "두 브라우저에서 같은 암호를 입력하세요. 원문 암호는 저장하거나 전송하지 않습니다.";
  const phase = view.status.phase;
  switch (phase) {
    case "unpaired":
      status.textContent = "설정 필요";
      break;
    case "ready":
      status.textContent = "연결 준비됨";
      break;
    case "syncing":
      status.textContent = "동기화 중…";
      break;
    case "synced":
      status.textContent = "동기화 완료";
      break;
    case "error":
      status.textContent = "연결 확인 필요 · 자동 재시도 예정";
      break;
    default:
      assertNever(phase);
  }
  lastSync.textContent =
    view.status.lastSyncAt === null
      ? "아직 없음"
      : new Date(view.status.lastSyncAt).toLocaleString("ko-KR");
  count.textContent = String(view.count);
  revision.textContent = String(view.revision);
  error.hidden = view.status.error === null;
  error.textContent =
    view.status.error === null
      ? ""
      : `최근 오류: ${view.status.error}. 동반 프로세스와 설정을 확인하세요.`;
  sync.disabled = busy || !paired || phase === "syncing";
}

async function request(message: unknown): Promise<void> {
  const reply = replySchema.parse(await chrome.runtime.sendMessage(message));
  switch (reply.ok) {
    case true:
      render(reply.view);
      break;
    case false:
      throw new ProtocolError(400, reply.error);
    default:
      assertNever(reply);
  }
}

function changedValue(change: unknown): unknown {
  if (typeof change !== "object" || change === null || !("newValue" in change)) return undefined;
  return change.newValue;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  save.disabled = true;
  sync.disabled = true;
  form.setAttribute("aria-busy", "true");
  feedback.textContent = "처리 중…";
  try {
    await action();
    feedback.textContent = "처리가 끝났습니다. 연결 상태를 확인하세요.";
  } catch (failure) {
    if (!(failure instanceof Error)) throw failure;
    feedback.textContent = `처리하지 못했습니다: ${failure.name === "ProtocolError" ? failure.message : failure.name}`;
  } finally {
    busy = false;
    password.value = "";
    save.disabled = false;
    form.setAttribute("aria-busy", "false");
    if (renderedView !== undefined) render(renderedView);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const clientLabel = label.value.trim();
  void run(async () => {
    const derivation = password.value.length === 0 ? null : deriveCredentials(password.value);
    password.value = "";
    await request({ type: "configure", label: clientLabel, credentials: await derivation });
  });
});
sync.addEventListener("click", () => {
  void run(() => request({ type: "sync" }));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "state" in changes) {
    try {
      render(stateViewFromStored(changedValue(changes["state"])));
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;
      feedback.textContent = "상태를 읽지 못했습니다. 팝업을 다시 열어 주세요.";
    }
  }
});
void request({ type: "status" }).catch((failure: unknown) => {
  if (!(failure instanceof Error)) throw failure;
  feedback.textContent = "상태를 읽지 못했습니다. 팝업을 다시 열어 주세요.";
});
