import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { compareText, mergeSnapshots } from "../src/shared/merge";
import {
  bookmarkKey,
  clientIdSchema,
  itemsSchema,
  PROTOCOL,
  ProtocolError,
  revisionSchema,
  roomIdSchema,
  type SyncRequest,
  type SyncResponse,
  sequenceSchema,
  timestampSchema,
} from "../src/shared/protocol";

const browserSchema = z
  .strictObject({ clientId: clientIdSchema, sequence: sequenceSchema, items: itemsSchema })
  .readonly();
const retiredSchema = z
  .strictObject({ key: z.string().max(32_768), deletedAt: timestampSchema })
  .readonly();
const roomSchema = z
  .strictObject({
    roomId: roomIdSchema,
    revision: revisionSchema,
    browsers: z.array(browserSchema).max(32).readonly(),
    retired: z.array(retiredSchema).max(100_000).readonly(),
  })
  .readonly();
const stateSchema = z
  .strictObject({
    version: z.literal(PROTOCOL.version),
    rooms: z.array(roomSchema).max(32).readonly(),
  })
  .readonly();
type State = z.infer<typeof stateSchema>;
type Room = z.infer<typeof roomSchema>;
const MAX_STATE_BYTES = 64 * 1_048_576;

export class StateStore {
  // 상태와 직렬화 큐는 저장소가 소유하는 변경 가능한 값이다.
  private state: State;
  private pending: Promise<void> = Promise.resolve();

  private constructor(
    private readonly directory: string,
    state: State,
  ) {
    this.state = state;
  }

  static async load(directory: string): Promise<StateStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = Bun.file(join(directory, "state.json"));
    if (!(await file.exists()))
      return new StateStore(directory, { version: PROTOCOL.version, rooms: [] });
    if (file.size > MAX_STATE_BYTES) throw new ProtocolError(507, "state_capacity");
    return new StateStore(directory, stateSchema.parse(await file.json()));
  }

  async sync(request: SyncRequest): Promise<SyncResponse> {
    const previous = this.pending;
    const turn = Promise.withResolvers<void>();
    this.pending = turn.promise;
    await previous;
    try {
      return await this.update(request);
    } finally {
      turn.resolve();
    }
  }

  async drain(): Promise<void> {
    await this.pending;
  }

  private async update(request: SyncRequest): Promise<SyncResponse> {
    const room: Room = this.state.rooms.find((entry) => entry.roomId === request.roomId) ?? {
      roomId: request.roomId,
      revision: revisionSchema.parse(0),
      browsers: [],
      retired: [],
    };
    const browser = room.browsers.find((entry) => entry.clientId === request.clientId);
    if (request.baseRevision > room.revision) throw new ProtocolError(409, "future_revision");
    if (browser !== undefined && request.sequence <= browser.sequence) {
      throw new ProtocolError(409, "stale_sequence");
    }
    const now = Date.now();
    if (request.items.some((item) => (item.deletedAt ?? item.updatedAt) > now + 60_000)) {
      throw new ProtocolError(400, "future_timestamp");
    }
    // 삭제는 명시적 tombstone으로만 표현한다. snapshot 누락으로 삭제를 추정하지 않는다.
    const nextBrowser = {
      clientId: request.clientId,
      sequence: request.sequence,
      items: mergeSnapshots([browser?.items ?? [], request.items]),
    };
    const browsers = [
      ...room.browsers.filter((entry) => entry.clientId !== request.clientId),
      nextBrowser,
    ].sort((left, right) => compareText(left.clientId, right.clientId));
    const merged = mergeSnapshots(browsers.map((entry) => entry.items));
    // 오래된 tombstone 본문 대신 삭제 시각만 유지해 오프라인 snapshot의 부활을 막는다.
    const retired = new Map(room.retired.map((entry) => [entry.key, entry.deletedAt]));
    for (const item of merged) {
      if (item.deletedAt !== null && item.deletedAt < now - PROTOCOL.tombstoneRetentionMs) {
        const key = bookmarkKey(item);
        retired.set(key, timestampSchema.parse(Math.max(retired.get(key) ?? 0, item.deletedAt)));
      }
    }
    const active = (items: SyncRequest["items"]) =>
      items.filter((item) => {
        const deletedAt = retired.get(bookmarkKey(item));
        return deletedAt === undefined || (item.deletedAt ?? item.updatedAt) > deletedAt;
      });
    const items = active(merged);
    if (items.length > PROTOCOL.maxItems) throw new ProtocolError(507, "room_capacity");
    const updated: Room = {
      roomId: room.roomId,
      revision: revisionSchema.parse(room.revision + 1),
      browsers: browsers.map((entry) => ({ ...entry, items: active(entry.items) })),
      retired: [...retired]
        .map(([key, deletedAt]) => ({ key, deletedAt }))
        .sort((left, right) => compareText(left.key, right.key)),
    };
    const next: State = {
      version: PROTOCOL.version,
      rooms: [...this.state.rooms.filter((entry) => entry.roomId !== room.roomId), updated].sort(
        (left, right) => compareText(left.roomId, right.roomId),
      ),
    };
    if (!stateSchema.safeParse(next).success) throw new ProtocolError(507, "state_capacity");
    await this.persist(next);
    this.state = next;
    return { version: PROTOCOL.version, revision: updated.revision, items };
  }

  private async persist(state: State): Promise<void> {
    const contents = JSON.stringify(state);
    if (Buffer.byteLength(contents) > MAX_STATE_BYTES)
      throw new ProtocolError(507, "state_capacity");
    const temporary = join(this.directory, `${crypto.randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.directory, "state.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
