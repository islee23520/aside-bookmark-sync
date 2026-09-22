import { z } from "zod";
import {
  clientIdSchema,
  credentialsSchema,
  itemsSchema,
  revisionSchema,
  timestampSchema,
} from "./protocol";

export const statusSchema = z
  .strictObject({
    phase: z.enum(["unpaired", "ready", "syncing", "synced", "error"]),
    lastSyncAt: timestampSchema.nullable(),
    error: z.string().nullable(),
  })
  .readonly();

export const configSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(64),
    clientId: clientIdSchema,
    credentials: credentialsSchema,
  })
  .readonly();
export type Config = z.infer<typeof configSchema>;

const stateSchema = z
  .strictObject({
    config: configSchema.nullable(),
    status: statusSchema,
    items: itemsSchema,
    revision: revisionSchema,
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    clock: timestampSchema,
    pending: itemsSchema.nullable(),
  })
  .readonly();
export type State = z.infer<typeof stateSchema>;

export const INITIAL_STATE: State = stateSchema.parse({
  config: null,
  status: { phase: "unpaired", lastSyncAt: null, error: null },
  items: [],
  revision: 0,
  sequence: 0,
  clock: 0,
  pending: null,
});

export async function loadState(): Promise<State> {
  const stored = await chrome.storage.local.get("state");
  return parseStoredState(stored["state"]);
}

export async function saveState(state: State): Promise<void> {
  await chrome.storage.local.set({ state });
}

export const viewSchema = z
  .strictObject({
    label: z.string(),
    paired: z.boolean(),
    status: statusSchema,
    revision: revisionSchema,
    count: z.number().int().nonnegative(),
  })
  .readonly();

export function stateView(state: State): z.infer<typeof viewSchema> {
  return {
    label: state.config?.label ?? "",
    paired: state.config !== null,
    status: state.status,
    revision: state.revision,
    count: state.items.filter((item) => item.deletedAt === null).length,
  };
}

export function stateViewFromStored(value: unknown): z.infer<typeof viewSchema> {
  return stateView(parseStoredState(value));
}

function parseStoredState(value: unknown): State {
  return value === undefined ? INITIAL_STATE : stateSchema.parse(value);
}

export const messageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("status") }),
  z.strictObject({ type: z.literal("sync") }),
  z.strictObject({
    type: z.literal("configure"),
    label: z.string().trim().min(1).max(64),
    credentials: credentialsSchema.nullable(),
  }),
]);

export const replySchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), view: viewSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
