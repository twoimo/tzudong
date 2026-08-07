import { describe, expect, mock, test } from "bun:test";

type StoredRecord = Record<string, unknown>;
type FakeRange =
  | { kind: "upper"; upper: number }
  | { kind: "bound"; lower: [string, string]; upper: [string, string] };

type FakeStore = Map<string, StoredRecord>;
type FakeDatabaseState = {
  version: number;
  stores: Map<string, FakeStore>;
};

type CursorEntry = {
  key: string;
  value: StoredRecord;
  store: FakeStore;
};

const databases = new Map<string, FakeDatabaseState>();

function keyForRecord(value: StoredRecord): string {
  const secondaryKey = typeof value.submissionMode === "string"
    ? value.submissionMode
    : value.restaurantId;
  return JSON.stringify([value.userId, secondaryKey]);
}

function sortedEntries(store: FakeStore): CursorEntry[] {
  return [...store.entries()]
    .map(([key, value]) => ({ key, value, store }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function entriesForIndex(store: FakeStore, name: string, query?: unknown): CursorEntry[] {
  const entries = sortedEntries(store);

  if (name === "by-expires-at") {
    const range = query as FakeRange;
    return entries
      .filter(({ value }) => range.kind !== "upper" || (typeof value.expiresAt === "number" && value.expiresAt <= range.upper))
      .sort((left, right) => Number(left.value.expiresAt) - Number(right.value.expiresAt) || left.key.localeCompare(right.key));
  }

  if (name === "by-user") {
    return entries.filter(({ value }) => value.userId === query);
  }

  if (name === "by-user-saved-at") {
    const range = query as FakeRange;
    const userId = range.kind === "bound" ? range.lower[0] : undefined;
    return entries
      .filter(({ value }) => value.userId === userId)
      .sort((left, right) => String(left.value.savedAt).localeCompare(String(right.value.savedAt)) || left.key.localeCompare(right.key));
  }

  throw new Error(`Unsupported fake index: ${name}`);
}

function cursorFor(entries: CursorEntry[], position = 0): {
  value: StoredRecord;
  delete: () => Promise<void>;
  continue: () => Promise<ReturnType<typeof cursorFor>>;
} | null {
  const entry = entries[position];
  if (!entry) return null;

  return {
    value: entry.value,
    delete: async () => {
      entry.store.delete(entry.key);
    },
    continue: async () => cursorFor(entries, position + 1),
  };
}

function storeFor(state: FakeDatabaseState, storeName: string) {
  const records = state.stores.get(storeName);
  if (!records) throw new Error(`Missing fake store: ${storeName}`);

  return {
    put: async (value: StoredRecord) => {
      records.set(keyForRecord(value), value);
    },
    openCursor: async () => cursorFor(sortedEntries(records)),
    index: (name: string) => ({
      count: async (query?: unknown) => entriesForIndex(records, name, query).length,
      openCursor: async (query?: unknown) => cursorFor(entriesForIndex(records, name, query)),
    }),
  };
}

async function openDB(
  name: string,
  version: number,
  options: {
    upgrade?: (database: {
      objectStoreNames: { contains: (storeName: string) => boolean };
      deleteObjectStore: (storeName: string) => void;
      createObjectStore: (storeName: string) => { createIndex: () => void };
    }, oldVersion: number) => void;
  },
) {
  let state = databases.get(name);
  if (!state) {
    state = { version: 0, stores: new Map() };
    databases.set(name, state);
  }

  if (state.version < version) {
    const database = {
      objectStoreNames: {
        contains: (storeName: string) => state.stores.has(storeName),
      },
      deleteObjectStore: (storeName: string) => {
        state.stores.delete(storeName);
      },
      createObjectStore: (storeName: string) => {
        state.stores.set(storeName, new Map());
        return { createIndex: () => undefined };
      },
    };
    options.upgrade?.(database, state.version);
    state.version = version;
  }

  return {
    transaction: (storeName: string) => ({
      store: storeFor(state, storeName),
      done: Promise.resolve(),
    }),
    get: async (storeName: string, key: unknown) => storeFor(state, storeName) && state.stores.get(storeName)?.get(JSON.stringify(key)),
    delete: async (storeName: string, key: unknown) => {
      state.stores.get(storeName)?.delete(JSON.stringify(key));
    },
  };
}

function resetDatabase(name: string): void {
  databases.delete(name);
}

function recordsFor(name: string, storeName: string): FakeStore {
  const records = databases.get(name)?.stores.get(storeName);
  if (!records) throw new Error(`Missing fake store: ${storeName}`);
  return records;
}

Object.defineProperty(globalThis, "IDBKeyRange", {
  configurable: true,
  value: {
    upperBound: (upper: number): FakeRange => ({ kind: "upper", upper }),
    bound: (lower: [string, string], upper: [string, string]): FakeRange => ({ kind: "bound", lower, upper }),
  },
});

mock.module("idb", () => ({ openDB }));

const submissionDraftStore = await import("../lib/submissionDraftDB");
const editRequestDraftStore = await import("../lib/editRequestDraftDB");

const SUBMISSION_DB = "tzudong-submission-drafts";
const SUBMISSION_STORE = "submission-drafts";
const EDIT_REQUEST_DB = "tzudong-edit-request-drafts";

function submissionDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: "draft-user",
    submissionMode: "new",
    restaurant_name: "Test Restaurant",
    address: "Seoul Test Street",
    phone: "02-1234-5678",
    categories: ["Korean"],
    youtube_link: "https://www.youtube.com/watch?v=test",
    description: "Normal draft",
    ...overrides,
  };
}

function editRequestDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: "edit-user",
    restaurantId: "restaurant-1",
    name: "Test Restaurant",
    address: "Seoul Test Street",
    phone: "02-1234-5678",
    category: ["Korean"],
    youtube_reviews: [{
      youtube_link: "https://www.youtube.com/watch?v=test",
      tzuyang_review: "Normal review",
      restaurant_id: "restaurant-1",
    }],
    ...overrides,
  };
}

function expiredSubmissionRecord(userId: string, expiresAt: number): StoredRecord {
  return {
    ...submissionDraft({ userId }),
    currentStep: null,
    savedAt: new Date(expiresAt - 7 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt,
  };
}

async function rejectionMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
    throw new Error("Expected operation to reject");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("submission and edit-request draft stores", () => {
  test("round-trips normal drafts while preserving omitted optional fields", async () => {
    resetDatabase(SUBMISSION_DB);
    resetDatabase(EDIT_REQUEST_DB);

    await submissionDraftStore.saveDraft(submissionDraft() as never);
    const savedSubmission = await submissionDraftStore.getDraft("draft-user", "new");
    expect(savedSubmission).toMatchObject({
      userId: "draft-user",
      submissionMode: "new",
      phone: "0212345678",
      categories: ["Korean"],
    });
    expect(savedSubmission?.currentStep).toBeUndefined();
    expect(savedSubmission?.savedAt).toEqual(expect.any(String));

    await editRequestDraftStore.saveDraft(editRequestDraft() as never);
    const savedEditRequest = await editRequestDraftStore.getDraft("edit-user", "restaurant-1");
    expect(savedEditRequest).toMatchObject({
      userId: "edit-user",
      restaurantId: "restaurant-1",
      phone: "0212345678",
      category: ["Korean"],
      youtube_reviews: [{
        youtube_link: "https://www.youtube.com/watch?v=test",
        tzuyang_review: "Normal review",
        restaurant_id: "restaurant-1",
      }],
    });
    expect(savedEditRequest?.currentStep).toBeUndefined();
    expect(savedEditRequest?.requestKind).toBeUndefined();
  });

  test("deletes an expired requested row after bounded sweeps leave it behind", async () => {
    resetDatabase(SUBMISSION_DB);
    await submissionDraftStore.saveDraft(submissionDraft({ userId: "seed-user" }) as never);

    const records = recordsFor(SUBMISSION_DB, SUBMISSION_STORE);
    records.clear();
    const now = Date.now();
    for (let index = 0; index <= 100; index += 1) {
      const expiresAt = now - 10_000 + index;
      const record = expiredSubmissionRecord(`expired-${String(index).padStart(3, "0")}`, expiresAt);
      records.set(keyForRecord(record), record);
    }
    const target = expiredSubmissionRecord("target-user", now - 1);
    records.set(keyForRecord(target), target);

    expect(await submissionDraftStore.getDraft("target-user", "new")).toBeNull();
    expect(records.has(keyForRecord(target))).toBe(false);
  });

  test("rejects nested accessors, unknown values, and detectable proxies without invoking traps", async () => {
    resetDatabase(SUBMISSION_DB);
    resetDatabase(EDIT_REQUEST_DB);

    let categoryGetterReads = 0;
    const categories = ["Korean"];
    Object.defineProperty(categories, "0", {
      enumerable: true,
      get: () => {
        categoryGetterReads += 1;
        throw new Error("nested-category-secret");
      },
    });
    const submissionError = await rejectionMessage(() => submissionDraftStore.saveDraft(
      submissionDraft({ userId: "accessor-user", categories }) as never,
    ));
    expect(categoryGetterReads).toBe(0);
    expect(submissionError).toBe("PRIVACY_UNSAFE_VALUE");

    let reviewGetterReads = 0;
    const review = {
      youtube_link: "https://www.youtube.com/watch?v=test",
      restaurant_id: "restaurant-1",
    } as Record<string, unknown>;
    Object.defineProperty(review, "tzuyang_review", {
      enumerable: true,
      get: () => {
        reviewGetterReads += 1;
        throw new Error("nested-review-secret");
      },
    });
    const editError = await rejectionMessage(() => editRequestDraftStore.saveDraft(
      editRequestDraft({ userId: "review-accessor-user", youtube_reviews: [review] }) as never,
    ));
    expect(reviewGetterReads).toBe(0);
    expect(editError).toBe("PRIVACY_UNSAFE_VALUE");

    const unknownError = await rejectionMessage(() => submissionDraftStore.saveDraft(
      submissionDraft({ unexpected: "raw-secret-value" }) as never,
    ));
    expect(unknownError).toBe("PRIVACY_UNSAFE_VALUE");
    expect(unknownError).not.toContain("raw-secret-value");

    const util = process.getBuiltinModule?.("node:util") as {
      types?: { isProxy?: (value: unknown) => boolean };
    } | undefined;
    if (typeof util?.types?.isProxy === "function") {
      let proxyGetTraps = 0;
      const proxy = new Proxy(submissionDraft({ userId: "proxy-user" }), {
        get: (target, property, receiver) => {
          proxyGetTraps += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      const proxyError = await rejectionMessage(() => submissionDraftStore.saveDraft(proxy as never));
      expect(proxyGetTraps).toBe(0);
      expect(proxyError).toBe("PRIVACY_UNSAFE_VALUE");
      expect(await submissionDraftStore.getDraft("proxy-user", "new")).toBeNull();
    }
  });
});
