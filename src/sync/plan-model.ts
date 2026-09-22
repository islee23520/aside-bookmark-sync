import type { BookmarkRecord, RecordKey } from "./model";

/** A created reference is resolved from the preceding create operation's returned ID. */
export type NodeReference =
  | { readonly kind: "existing"; readonly id: string }
  | { readonly kind: "created"; readonly key: RecordKey };

export type ApplyOperation =
  | {
      readonly kind: "create";
      readonly key: RecordKey;
      readonly parent: NodeReference;
      readonly index: number;
      readonly record: BookmarkRecord;
    }
  | {
      readonly kind: "update";
      readonly id: string;
      readonly key: RecordKey;
      readonly record: BookmarkRecord;
    }
  | {
      readonly kind: "move";
      readonly id: string;
      readonly key: RecordKey;
      readonly parent: NodeReference;
      readonly index: number;
    }
  | { readonly kind: "delete"; readonly id: string; readonly key: RecordKey };

export type DeferredRecord = {
  readonly key: RecordKey;
  readonly reason: "unmanaged-root" | "unavailable-parent";
};

export type ApplyPlan = {
  /** Execute sequentially; delete is a leaf removal, never removeTree. */
  readonly operations: readonly ApplyOperation[];
  readonly bindings: readonly { readonly key: RecordKey; readonly node: NodeReference }[];
  readonly deferred: readonly DeferredRecord[];
};
