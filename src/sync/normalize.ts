import { bookmarkKey, compareText, recordContent, SyncModelError } from "./model";
import type {
  BookmarkRecord, BookmarkRoot, BookmarkSnapshot, BrowserBookmarkNode,
  FolderSegment, NodeBinding, RecordKey, SnapshotContext,
} from "./model";

/** Normalize a complete tree; absence relative to previous produces a tombstone. */
export function normalizeBookmarkTree(
  roots: readonly BookmarkRoot[],
  context: SnapshotContext,
): BookmarkSnapshot {
  // These accumulators are confined to this normalization invocation.
  const records: BookmarkRecord[] = [];
  const bindings: NodeBinding[] = [];
  const rootAliases = new Set<string>();
  const browserIds = new Set<string>();
  const previous = new Map(context.previous?.records.map((record) => [record.key, record]));
  const present = new Set<RecordKey>();

  for (const root of [...roots].sort((left, right) => compareText(left.key, right.key))) {
    if (rootAliases.has(root.key)) throw new SyncModelError("duplicate-root", root.key);
    rootAliases.add(root.key);
    if (browserIds.has(root.node.id)) throw new SyncModelError("duplicate-id", root.node.id);
    browserIds.add(root.node.id);

    function visit(nodes: readonly BrowserBookmarkNode[], path: readonly FolderSegment[]): void {
      const occurrences = new Map<string, number>();
      for (const [index, node] of nodes.entries()) {
        if (browserIds.has(node.id)) throw new SyncModelError("duplicate-id", node.id);
        browserIds.add(node.id);
        const kind = node.url === undefined ? "folder" : "bookmark";
        const identity = node.url ?? node.title;
        const group = JSON.stringify([kind, identity]);
        const occurrence = occurrences.get(group) ?? 0;
        occurrences.set(group, occurrence + 1);
        const key = bookmarkKey(root.key, path, [kind, identity, occurrence]);
        const base = {
          key, root: root.key, path, occurrence, title: node.title, index,
          updatedAt: context.updatedAt, sourceClientId: context.sourceClientId, deletedAt: null,
        };
        const record: BookmarkRecord = node.url === undefined
          ? { ...base, kind: "folder" }
          : { ...base, kind: "bookmark", url: node.url };
        const old = previous.get(key);
        records.push(old !== undefined && old.deletedAt === null && recordContent(old) === recordContent(record)
          ? old : record);
        bindings.push({ key, id: node.id });
        present.add(key);
        if (node.url === undefined) {
          visit(node.children ?? [], [...path, { title: node.title, occurrence }]);
        }
      }
    }

    visit(root.node.children ?? [], []);
  }

  for (const old of previous.values()) {
    // Removing a root from the managed scope is not a user deletion.
    if (present.has(old.key) || !rootAliases.has(old.root)) continue;
    records.push(old.deletedAt !== null ? old : {
      ...old, updatedAt: context.updatedAt, deletedAt: context.updatedAt,
      sourceClientId: context.sourceClientId,
    });
  }
  return {
    records: records.sort((left, right) => compareText(left.key, right.key)),
    bindings: bindings.sort((left, right) => compareText(left.key, right.key)),
    roots: roots.map((root) => ({ key: root.key, id: root.node.id }))
      .sort((left, right) => compareText(left.key, right.key)),
  };
}
