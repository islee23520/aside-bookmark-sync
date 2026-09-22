import { type Bookmark, bookmarkKey } from "./protocol";

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareBookmarks(left: Bookmark, right: Bookmark): number {
  return (
    (left.deletedAt ?? left.updatedAt) - (right.deletedAt ?? right.updatedAt) ||
    compareText(left.sourceClientId, right.sourceClientId) ||
    Number(left.deletedAt !== null) - Number(right.deletedAt !== null) ||
    compareText(JSON.stringify(left), JSON.stringify(right))
  );
}

export function mergeSnapshots(snapshots: readonly (readonly Bookmark[])[]): readonly Bookmark[] {
  // 병합 과정에서만 변경하는 누산기이며 입력 snapshot은 수정하지 않는다.
  const winners = new Map<string, Bookmark>();
  for (const items of snapshots) {
    for (const item of items) {
      const key = bookmarkKey(item);
      const previous = winners.get(key);
      if (previous === undefined || compareBookmarks(item, previous) > 0) {
        winners.set(key, item);
      }
    }
  }
  return [...winners.values()].sort((left, right) =>
    compareText(bookmarkKey(left), bookmarkKey(right)),
  );
}
