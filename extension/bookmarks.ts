import {
  assertNever, bookmarkKey, itemsSchema, ProtocolError, timestampSchema,
  type Bookmark,
} from "./protocol";
import type { Config, State } from "./storage";

type BoundItem = { readonly item: Bookmark; readonly id: string };
export type Snapshot = {
  readonly items: readonly Bookmark[];
  readonly nodes: readonly BoundItem[];
  readonly roots: ReadonlyMap<string, string>;
};

export async function capture(state: State, config: Config): Promise<Snapshot> {
  const tree = await chrome.bookmarks.getTree();
  const roots = new Map<string, string>();
  const nodes: BoundItem[] = [];
  const previous = new Map(state.items.map((item) => [bookmarkKey(item), item]));
  const records = new Map<string, Bookmark>();
  const now = timestampSchema.parse(Math.max(Date.now(), state.clock + 1));

  function visit(node: BookmarkNode, path: readonly string[]): void {
    if (node.unmodifiable !== undefined) return;
    const base = {
      path, title: node.title, updatedAt: now, deletedAt: null,
      sourceClientId: config.clientId,
    };
    const item: Bookmark = node.url === undefined
      ? { ...base, kind: "folder" }
      : { ...base, kind: "bookmark", url: node.url };
    const key = bookmarkKey(item);
    const old = previous.get(key);
    const stable = old !== undefined && old.deletedAt === null && old.title === item.title ? old : item;
    records.set(key, stable);
    nodes.push({ item: stable, id: node.id });
    for (const child of node.children ?? []) visit(child, [...path, node.title]);
  }

  for (const root of tree[0]?.children ?? []) {
    if (root.unmodifiable !== undefined) continue;
    // 영구 루트는 번역된 제목 대신 Chrome/Edge의 타입 또는 레거시 ID로 대응한다.
    const alias = root.folderType === "bookmarks-bar" || root.id === "1" ? "toolbar"
      : root.folderType === "other" || root.id === "2" ? "other"
        : root.folderType === "mobile" || root.id === "3" ? "mobile" : undefined;
    if (alias === undefined) continue;
    if (roots.has(alias)) throw new ProtocolError(409, "multiple_roots_for_alias");
    roots.set(alias, root.id);
    for (const node of root.children ?? []) visit(node, [alias]);
  }
  if (roots.size === 0) throw new ProtocolError(409, "editable_roots_unavailable");
  for (const old of previous.values()) {
    const key = bookmarkKey(old);
    if (records.has(key)) continue;
    const root = old.path[0];
    records.set(key, old.deletedAt !== null || root === undefined || !roots.has(root) ? old : {
      ...old, updatedAt: now, deletedAt: now, sourceClientId: config.clientId,
    });
  }
  return { items: itemsSchema.parse([...records.values()]), nodes, roots };
}

export async function applySnapshot(current: Snapshot, desired: readonly Bookmark[]): Promise<void> {
  const folders = new Map<string, string>(
    [...current.roots].map(([alias, id]) => [JSON.stringify([alias]), id]),
  );
  const existing = new Map<string, BoundItem[]>();
  for (const node of current.nodes) {
    const key = bookmarkKey(node.item);
    const peers = existing.get(key) ?? [];
    peers.push(node);
    existing.set(key, peers);
    switch (node.item.kind) {
      case "folder":
        folders.set(JSON.stringify([...node.item.path, node.item.title]), node.id);
        break;
      case "bookmark": break;
      default: assertNever(node.item);
    }
  }
  const deletedFolders = desired.flatMap((item) => {
    switch (item.kind) {
      case "folder": return item.deletedAt === null ? [] : [[...item.path, item.title]];
      case "bookmark": return [];
      default: return assertNever(item);
    }
  });
  const blocked = (item: Bookmark): boolean => deletedFolders.some((path) =>
    path.length <= item.path.length && path.every((part, index) => item.path[index] === part));

  for (const item of [...desired].sort((a, b) => a.path.length - b.path.length)) {
    if (item.deletedAt !== null || blocked(item)) continue;
    const alias = item.path[0];
    if (alias === undefined || !current.roots.has(alias)) continue;
    const peers = existing.get(bookmarkKey(item)) ?? [];
    if (peers.length > 0) {
      for (const peer of peers) {
        if (peer.item.title !== item.title) await chrome.bookmarks.update(peer.id, { title: item.title });
      }
      continue;
    }
    const parentId = folders.get(JSON.stringify(item.path));
    if (parentId === undefined) throw new ProtocolError(409, "parent_unavailable");
    switch (item.kind) {
      case "folder": {
        const created = await chrome.bookmarks.create({ parentId, title: item.title });
        folders.set(JSON.stringify([...item.path, item.title]), created.id);
        break;
      }
      case "bookmark":
        await chrome.bookmarks.create({ parentId, title: item.title, url: item.url });
        break;
      default: assertNever(item);
    }
  }
  const tombstones = new Set(desired.filter((item) => item.deletedAt !== null).map(bookmarkKey));
  // 명시적 삭제만 적용한다. 자식부터 leaf remove를 사용하여 신규 자식을 지우지 않는다.
  for (const node of [...current.nodes].sort((a, b) => b.item.path.length - a.item.path.length)) {
    if (tombstones.has(bookmarkKey(node.item)) || blocked(node.item)) {
      await chrome.bookmarks.remove(node.id);
    }
  }
}
