export type RecordKey = `record:${string}`;

export type FolderSegment = {
  readonly title: string;
  readonly occurrence: number;
};

type RecordBase = {
  readonly key: RecordKey;
  readonly root: string;
  readonly path: readonly FolderSegment[];
  readonly occurrence: number;
  readonly title: string;
  readonly index: number;
  readonly updatedAt: number;
  readonly sourceClientId: string;
  readonly deletedAt: number | null;
};

export type BookmarkRecord = RecordBase &
  (
    | { readonly kind: "folder" }
    | { readonly kind: "bookmark"; readonly url: string }
  );

/** Browser adapters supply only editable roots, with the same aliases on every client. */
export type BrowserBookmarkNode = {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly children?: readonly BrowserBookmarkNode[];
};

export type BookmarkRoot = {
  readonly key: string;
  readonly node: BrowserBookmarkNode;
};

export type RootBinding = { readonly key: string; readonly id: string };
export type NodeBinding = { readonly key: RecordKey; readonly id: string };

/** Bindings are local state, never portable browser identities. */
export type BookmarkSnapshot = {
  readonly records: readonly BookmarkRecord[];
  readonly bindings: readonly NodeBinding[];
  readonly roots: readonly RootBinding[];
};

export type SnapshotContext = {
  readonly sourceClientId: string;
  readonly updatedAt: number;
  readonly previous?: BookmarkSnapshot;
};

export class SyncModelError extends Error {
  override readonly name = "SyncModelError";

  constructor(readonly code: "duplicate-root" | "duplicate-id" | "missing-binding", readonly value: string) {
    super(`${code}: ${value}`);
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected sync variant: ${String(value)}`);
}

/** Code-unit ordering, independent of locale and host ICU version. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function bookmarkKey(
  root: string,
  path: readonly FolderSegment[],
  identity: readonly ["folder" | "bookmark", string, number],
): RecordKey {
  return `record:${JSON.stringify([root, path.map((part) => [part.title, part.occurrence]), ...identity])}`;
}

export function parentKey(record: BookmarkRecord): RecordKey | undefined {
  const segment = record.path[record.path.length - 1];
  return segment === undefined
    ? undefined
    : bookmarkKey(record.root, record.path.slice(0, -1), ["folder", segment.title, segment.occurrence]);
}

/** Explicit tuple serialization makes property insertion order irrelevant. */
export function recordContent(record: BookmarkRecord): string {
  switch (record.kind) {
    case "folder":
      return JSON.stringify([record.key, record.title, record.index]);
    case "bookmark":
      return JSON.stringify([record.key, record.title, record.index, record.url]);
    default:
      return assertNever(record);
  }
}
