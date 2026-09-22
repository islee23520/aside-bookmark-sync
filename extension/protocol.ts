// 공유 계약은 빌드 시 포함된다. 배포 JS에는 확장 외부 import가 남지 않는다.
import { z } from "zod";
import { authKeySchema, roomIdSchema } from "../src/shared/protocol";

export {
  assertNever, bookmarkKey, clientIdSchema, itemsSchema, PROTOCOL,
  ProtocolError, revisionSchema, sequenceSchema, syncRequestSchema,
  syncResponseSchema, timestampSchema,
} from "../src/shared/protocol";
export type { Bookmark, SyncRequest, SyncResponse } from "../src/shared/protocol";
export { compareBookmarks, mergeSnapshots } from "../src/shared/merge";

export const credentialsSchema = z.strictObject({
  roomId: roomIdSchema, authKey: authKeySchema,
}).readonly();
export type Credentials = z.infer<typeof credentialsSchema>;
