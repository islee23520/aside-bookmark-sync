import { z } from "zod";

export const PROTOCOL = {
  version: 1,
  hostname: "127.0.0.1",
  port: 32145,
  origin: "http://127.0.0.1:32145",
  maxBodyBytes: 1_048_576,
  maxItems: 5_000,
  tombstoneRetentionMs: 30 * 24 * 60 * 60 * 1_000,
} as const;

export const roomIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("RoomId");
export const authKeySchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("AuthKey");
export const clientIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .brand("ClientId");
export const timestampSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).brand("UnixMs");
export const revisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .brand("Revision");
export const sequenceSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER)
  .brand("Sequence");

const itemFields = {
  path: z.array(z.string().max(256)).max(32).readonly(),
  title: z.string().max(1_024),
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
  sourceClientId: clientIdSchema,
};

export const bookmarkSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ ...itemFields, kind: z.literal("bookmark"), url: z.url().max(8_192) }),
    z.strictObject({ ...itemFields, kind: z.literal("folder") }),
  ])
  .refine((item) => item.deletedAt === null || item.deletedAt >= item.updatedAt)
  .readonly();
export type Bookmark = z.infer<typeof bookmarkSchema>;

export function bookmarkKey(item: Bookmark): string {
  switch (item.kind) {
    case "bookmark":
      return JSON.stringify([item.kind, item.path, item.url]);
    case "folder":
      return JSON.stringify([item.kind, item.path, item.title]);
    default:
      return assertNever(item);
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected variant: ${typeof value}`);
}

export const itemsSchema = z
  .array(bookmarkSchema)
  .max(PROTOCOL.maxItems)
  .refine((items) => new Set(items.map(bookmarkKey)).size === items.length)
  .readonly();

export const syncRequestSchema = z
  .strictObject({
    version: z.literal(PROTOCOL.version),
    roomId: roomIdSchema,
    clientId: clientIdSchema,
    baseRevision: revisionSchema,
    sequence: sequenceSchema,
    items: itemsSchema,
  })
  .readonly();
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncResponseSchema = z
  .strictObject({
    version: z.literal(PROTOCOL.version),
    revision: revisionSchema,
    items: itemsSchema,
  })
  .readonly();
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export class ProtocolError extends Error {
  readonly name = "ProtocolError";

  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
