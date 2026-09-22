import { assertNever, compareText } from "./model";
import type { BookmarkRecord, RecordKey } from "./model";

/** Folders retain identity only at an exact path; this avoids cyclic browser moves. */
export function matchRecords(
  current: readonly BookmarkRecord[],
  desired: readonly BookmarkRecord[],
): ReadonlyMap<RecordKey, BookmarkRecord> {
  const available = new Map(current.map((record) => [record.key, record]));
  const matched = new Map<RecordKey, BookmarkRecord>();
  const ordered = [...desired].sort((left, right) => compareText(left.key, right.key));
  for (const record of ordered) {
    const old = available.get(record.key);
    if (old !== undefined) {
      matched.set(record.key, old);
      available.delete(old.key);
    }
  }

  // Only unique pairs are reused. Ambiguous duplicates are created/deleted, never guessed.
  for (const field of ["url", "title"] as const) {
    const candidates = new Map<string, BookmarkRecord[]>();
    const targets = new Map<string, BookmarkRecord[]>();
    for (const [records, groups] of [
      [[...available.values()], candidates],
      [ordered.filter((record) => !matched.has(record.key)), targets],
    ] as const) {
      for (const record of records) {
        switch (record.kind) {
          case "folder":
            break;
          case "bookmark": {
            const signature = JSON.stringify([record.root, record[field]]);
            const group = groups.get(signature) ?? [];
            group.push(record);
            groups.set(signature, group);
            break;
          }
          default:
            assertNever(record);
        }
      }
    }
    for (const [signature, group] of targets) {
      const peers = candidates.get(signature);
      const target = group[0];
      const candidate = peers?.[0];
      if (group.length === 1 && peers?.length === 1 && target !== undefined && candidate !== undefined) {
        matched.set(target.key, candidate);
        available.delete(candidate.key);
      }
    }
  }
  return matched;
}
