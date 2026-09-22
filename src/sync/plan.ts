import { matchRecords } from "./matching";
import { mergeSnapshots } from "./merge";
import { assertNever, compareText, parentKey, SyncModelError } from "./model";
import type { BookmarkRecord, BookmarkSnapshot, RecordKey } from "./model";
import type { ApplyOperation, ApplyPlan, DeferredRecord, NodeReference } from "./plan-model";

function treeOrder(left: BookmarkRecord, right: BookmarkRecord): number {
  return left.path.length - right.path.length
    || compareText(left.root, right.root)
    || compareText(parentKey(left) ?? "", parentKey(right) ?? "")
    || left.index - right.index
    || compareText(left.key, right.key);
}

/**
 * Desired is a COMPLETE merged snapshot, not a delta. Roots themselves are immutable.
 * Deleted/missing ancestors suppress their descendants, even if a child is newer.
 * Folder path changes are create + child moves + leaf deletes, not identity guesses.
 */
export function planBookmarkApply(
  current: BookmarkSnapshot,
  desired: readonly BookmarkRecord[],
): ApplyPlan {
  const roots = new Map(current.roots.map((root) => [root.key, root.id]));
  const localIds = new Map(current.bindings.map((binding) => [binding.key, binding.id]));
  const folders = new Set<RecordKey>();
  const deferred: DeferredRecord[] = [];
  const active: BookmarkRecord[] = [];
  for (const record of [...mergeSnapshots([desired])].sort(treeOrder)) {
    if (record.deletedAt !== null) continue;
    if (!roots.has(record.root)) {
      deferred.push({ key: record.key, reason: "unmanaged-root" });
      continue;
    }
    const parent = parentKey(record);
    if (parent !== undefined && !folders.has(parent)) {
      deferred.push({ key: record.key, reason: "unavailable-parent" });
      continue;
    }
    active.push(record);
    switch (record.kind) {
      case "folder":
        folders.add(record.key);
        break;
      case "bookmark":
        break;
      default:
        assertNever(record);
    }
  }

  const local = current.records.filter((record) => record.deletedAt === null && roots.has(record.root));
  const matches = matchRecords(local, active);
  const used = new Set([...matches.values()].map((record) => record.key));
  const references = new Map<RecordKey, NodeReference>();
  const operations: ApplyOperation[] = [];
  // Simulated sibling lists account for index shifts caused by earlier operations.
  const children = new Map<string, string[]>();
  const locations = new Map<string, string>();
  const rootToken = (root: string): string => `root:${root}`;
  for (const record of [...local].sort(treeOrder)) {
    const parent = parentKey(record) ?? rootToken(record.root);
    const siblings = children.get(parent) ?? [];
    siblings.push(record.key);
    children.set(parent, siblings);
    locations.set(record.key, parent);
  }
  for (const record of active) {
    const old = matches.get(record.key);
    if (old === undefined) {
      references.set(record.key, { kind: "created", key: record.key });
    } else {
      const id = localIds.get(old.key);
      if (id === undefined) throw new SyncModelError("missing-binding", old.key);
      references.set(record.key, { kind: "existing", id });
    }
  }

  const nextIndex = new Map<string, number>();
  for (const record of active) {
    const parent = parentKey(record);
    const rootId = roots.get(record.root);
    const parentReference: NodeReference | undefined = parent === undefined
      ? rootId === undefined ? undefined : { kind: "existing", id: rootId }
      : references.get(parent);
    if (parentReference === undefined) throw new SyncModelError("missing-binding", parent ?? record.root);
    const destination = parent ?? rootToken(record.root);
    const index = nextIndex.get(destination) ?? 0;
    nextIndex.set(destination, index + 1);
    const siblings = children.get(destination) ?? [];
    children.set(destination, siblings);
    const old = matches.get(record.key);
    if (old === undefined) {
      operations.push({ kind: "create", key: record.key, parent: parentReference, index, record });
      siblings.splice(index, 0, record.key);
      locations.set(record.key, destination);
      continue;
    }
    const id = localIds.get(old.key);
    if (id === undefined) throw new SyncModelError("missing-binding", old.key);
    let changed = old.title !== record.title;
    switch (record.kind) {
      case "folder":
        break;
      case "bookmark":
        switch (old.kind) {
          case "folder":
            break;
          case "bookmark":
            changed ||= old.url !== record.url;
            break;
          default:
            assertNever(old);
        }
        break;
      default:
        assertNever(record);
    }
    if (changed) operations.push({ kind: "update", id, key: record.key, record });
    const location = locations.get(old.key);
    if (location !== destination || siblings.indexOf(old.key) !== index) {
      operations.push({ kind: "move", id, key: record.key, parent: parentReference, index });
      const source = location === undefined ? undefined : children.get(location);
      if (source !== undefined) source.splice(source.indexOf(old.key), 1);
      siblings.splice(index, 0, old.key);
      locations.set(old.key, destination);
    }
  }

  // Children are removed before their now-empty parents. Matched nodes have already moved out.
  for (const record of [...local].sort((left, right) => -treeOrder(left, right))) {
    if (used.has(record.key)) continue;
    const id = localIds.get(record.key);
    if (id === undefined) throw new SyncModelError("missing-binding", record.key);
    operations.push({ kind: "delete", id, key: record.key });
  }
  return {
    operations,
    bindings: [...references].map(([key, node]) => ({ key, node }))
      .sort((left, right) => compareText(left.key, right.key)),
    deferred,
  };
}
