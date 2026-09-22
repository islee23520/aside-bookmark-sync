export {};

declare global {
type BookmarkNode = {
  readonly id: string;
  readonly parentId?: string;
  readonly title: string;
  readonly url?: string;
  readonly unmodifiable?: string;
  readonly folderType?: string;
  readonly children?: readonly BookmarkNode[];
};

type BrowserEvent<Args extends readonly unknown[]> = {
  readonly addListener: (listener: (...args: Args) => void) => void;
};

const chrome: {
  readonly bookmarks: {
    readonly getTree: () => Promise<readonly BookmarkNode[]>;
    readonly create: (details: {
      readonly parentId: string; readonly title: string; readonly url?: string;
    }) => Promise<BookmarkNode>;
    readonly update: (id: string, changes: { readonly title: string }) => Promise<BookmarkNode>;
    readonly remove: (id: string) => Promise<void>;
    readonly onCreated: BrowserEvent<[]>;
    readonly onChanged: BrowserEvent<[]>;
    readonly onMoved: BrowserEvent<[]>;
    readonly onRemoved: BrowserEvent<[]>;
    readonly onChildrenReordered: BrowserEvent<[]>;
  };
  readonly storage: {
    readonly local: {
      readonly get: (key: string) => Promise<Record<string, unknown>>;
      readonly set: (values: Readonly<Record<string, unknown>>) => Promise<void>;
      readonly setAccessLevel: (details: { readonly accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>;
    };
    readonly onChanged: BrowserEvent<[Readonly<Record<string, unknown>>, string]>;
  };
  readonly alarms: {
    readonly get: (name: string) => Promise<{ readonly name: string } | undefined>;
    readonly create: (name: string, info: {
      readonly delayInMinutes: number; readonly periodInMinutes: number;
    }) => Promise<void>;
    readonly onAlarm: BrowserEvent<[{ readonly name: string }]>;
  };
  readonly runtime: {
    readonly id: string;
    readonly getURL: (path: string) => string;
    readonly sendMessage: (message: unknown) => Promise<unknown>;
    readonly onInstalled: BrowserEvent<[]>;
    readonly onStartup: BrowserEvent<[]>;
    readonly onMessage: {
      readonly addListener: (listener: (
        message: unknown,
        sender: { readonly id?: string; readonly url?: string },
        reply: (response: unknown) => void,
      ) => boolean) => void;
    };
  };
};
}
