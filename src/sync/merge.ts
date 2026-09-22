import { compareText, recordContent } from "./model";
import type { BookmarkRecord, RecordKey } from "./model";

/** Positive means left wins. Exact clock/client ties prefer deletion, then canonical content. */
export function compareRecordVersions(left: BookmarkRecord, right: BookmarkRecord): number {
  return left.updatedAt - right.updatedAt
    || compareText(left.sourceClientId, right.sourceClientId)
    || Number(left.deletedAt !== null) - Number(right.deletedAt !== null)
    || (left.deletedAt ?? 0) - (right.deletedAt ?? 0)
    || compareText(recordContent(left), recordContent(right));
}

/** Commutative, associative and idempotent for canonical, well-formed records. */
export function mergeSnapshots(
  snapshots: readonly (readonly BookmarkRecord[])[],
): readonly BookmarkRecord[] {
  const winners = new Map<RecordKey, BookmarkRecord>();
  for (const records of snapshots) {
    for (const record of records) {
      const previous = winners.get(record.key);
      if (previous === undefined || compareRecordVersions(record, previous) > 0) {
        winners.set(record.key, record);
      }
    }
  }
  return [...winners.values()].sort((left, right) => compareText(left.key, right.key));
}
