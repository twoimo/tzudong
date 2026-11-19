import { expect, mock, setSystemTime, test } from 'bun:test';

type Row = Record<string, unknown>;
type Range = { lower?: unknown; upper?: unknown; lowerOpen?: boolean; upperOpen?: boolean };
type Index = { name: string; keyPath: string | string[]; options: unknown };
type Database = { version: number; storeName?: string; keyPath?: string[]; indexes: Index[]; rows: Map<string, Row> };

const NOW = Date.parse('2026-10-20T03:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
setSystemTime(new Date(NOW));

const databases = new Map<string, Database>();
let failOpen = false;

function compare(left: unknown, right: unknown): number {
    if (Array.isArray(left) && Array.isArray(right)) {
        for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
            const order = compare(left[index], right[index]);
            if (order) return order;
        }
        return left.length - right.length;
    }
    return (left as string) < (right as string) ? -1 : (left as string) > (right as string) ? 1 : 0;
}
function inRange(key: unknown, query?: unknown): boolean {
    if (query === undefined) return true;
    if (typeof query !== 'object' || query === null || Array.isArray(query)) return compare(key, query) === 0;
    const range = query as Range;
    return (range.lower === undefined || compare(key, range.lower) >= (range.lowerOpen ? 1 : 0))
        && (range.upper === undefined || compare(key, range.upper) <= (range.upperOpen ? -1 : 0));
}
const isKey = (value: unknown): boolean => typeof value === 'string' || typeof value === 'number'
    || (Array.isArray(value) && value.every(isKey));

function storeFor(db: Database) {
    const keyOf = (row: Row) => db.keyPath!.map((field) => row[field]);
    const indexKey = (row: Row, keyPath: string | string[]) => Array.isArray(keyPath) ? keyPath.map((field) => row[field]) : row[keyPath];
    function cursor(entries: { row: Row; key: unknown }[], position = 0): object | null {
        const entry = entries[position];
        if (!entry) return null;
        const primaryKey = keyOf(entry.row);
        return {
            value: structuredClone(entry.row),
            key: entry.key,
            primaryKey,
            delete: async () => { db.rows.delete(JSON.stringify(primaryKey)); },
            continue: async () => cursor(entries, position + 1),
        };
    }
    return {
        get: async (key: unknown) => structuredClone(db.rows.get(JSON.stringify(key))),
        put: async (row: Row) => { db.rows.set(JSON.stringify(keyOf(row)), structuredClone(row)); },
        delete: async (key: unknown) => { db.rows.delete(JSON.stringify(key)); },
        openCursor: async (query?: unknown) => cursor([...db.rows.values()]
            .map((row) => ({ row, key: keyOf(row) }))
            .filter(({ key }) => inRange(key, query))
            .sort((left, right) => compare(left.key, right.key))),
        index: (name: string) => {
            const { keyPath } = db.indexes.find((index) => index.name === name)!;
            const entries = (query?: unknown) => [...db.rows.values()]
                .map((row) => ({ row, key: indexKey(row, keyPath) }))
                .filter(({ key }) => isKey(key) && inRange(key, query))
                .sort((left, right) => compare(left.key, right.key) || compare(keyOf(left.row), keyOf(right.row)));
            return {
                count: async (query?: unknown) => entries(query).length,
                openCursor: async (query?: unknown) => cursor(entries(query)),
            };
        },
    };
}

mock.module('idb', () => ({
    openDB: async (name: string, version: number, options: { upgrade: (db: object, oldVersion: number) => void }) => {
        if (failOpen) throw new Error('SYNTHETIC_OPEN_FAILED');
        let state = databases.get(name);
        if (!state) {
            state = { version: 0, indexes: [], rows: new Map() };
            databases.set(name, state);
        }
        const db = state;
        if (db.version < version) {
            options.upgrade({
                objectStoreNames: { contains: (storeName: string) => db.storeName === storeName },
                deleteObjectStore: () => {
                    db.storeName = undefined; db.keyPath = undefined; db.indexes = []; db.rows = new Map();
                },
                createObjectStore: (storeName: string, { keyPath }: { keyPath: string[] }) => {
                    db.storeName = storeName;
                    db.keyPath = keyPath;
                    return {
                        createIndex: (indexName: string, indexKeyPath: string | string[], indexOptions?: unknown) => {
                            db.indexes.push({ name: indexName, keyPath: indexKeyPath, options: indexOptions });
                        },
                    };
                },
            }, db.version);
            db.version = version;
        }
        const requireStore = (storeName: string) => {
            if (storeName !== db.storeName) throw new Error('MISSING_FAKE_STORE');
            return storeFor(db);
        };
        return {
            close() {},
            get: async (storeName: string, key: unknown) => requireStore(storeName).get(key),
            transaction: (storeName: string) => {
                const store = requireStore(storeName);
                const before = new Map(db.rows);
                let aborted = false;
                return {
                    store,
                    abort() { aborted = true; db.rows.clear(); for (const [key, row] of before) db.rows.set(key, row); },
                    get done() { return aborted ? Promise.reject(new Error('SYNTHETIC_ABORT')) : Promise.resolve(); },
                };
            },
        };
    },
}));
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: {
    upperBound: (upper: unknown): Range => ({ upper }),
    lowerBound: (lower: unknown, lowerOpen = false): Range => ({ lower, lowerOpen }),
    bound: (lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false): Range => ({ lower, upper, lowerOpen, upperOpen }),
} });

type LooseStore = {
    saveDraft(draft: Row): Promise<unknown>;
    getDraft(userId: string, slot: string): Promise<Row | null>;
    hasDraft(userId: string, slot: string): Promise<boolean>;
    deleteDraft(userId: string, slot: string): Promise<void>;
    deleteAllDraftsByUser(userId: string): Promise<boolean>;
    getAllDraftsByUser(userId: string): Promise<Row[]>;
    cleanupOldDrafts(): Promise<void>;
    recoverLegacyDrafts(userId: string): Promise<number>;
};
const modules = {
    review: await import('../../lib/reviewDraftDB'),
    edit: await import('../../lib/editRequestDraftDB'),
    submission: await import('../../lib/submissionDraftDB'),
};
const api = (kind: Kind) => modules[kind] as unknown as LooseStore;

const kinds = ['review', 'edit', 'submission'] as const;
type Kind = typeof kinds[number];
const contract = {
    review: { dbName: 'tzudong-review-drafts', version: 3, storeName: 'review-drafts', slotField: 'restaurantId', slot: 'restaurant-1', invalidSlot: 'not a slot', ttl: DAY, sweepBatch: 100, textField: 'content' },
    edit: { dbName: 'tzudong-edit-request-drafts', version: 2, storeName: 'edit-request-drafts', slotField: 'restaurantId', slot: 'restaurant-1', invalidSlot: 'not a slot', ttl: 7 * DAY, sweepBatch: 50, textField: 'name' },
    submission: { dbName: 'tzudong-submission-drafts', version: 2, storeName: 'submission-drafts', slotField: 'submissionMode', slot: 'request', invalidSlot: 'restaurant-1', ttl: 7 * DAY, sweepBatch: 50, textField: 'restaurant_name' },
} as const;
const contractIndexes: Index[] = [
    { name: 'by-expires-at', keyPath: 'expiresAt', options: undefined },
    { name: 'by-user', keyPath: 'userId', options: undefined },
    { name: 'by-user-saved-at', keyPath: ['userId', 'savedAt'], options: undefined },
];

const savedAt = new Date(NOW).toISOString();
const inputs: Record<Kind, Row> = {
    review: {
        userId: 'user-1', restaurantId: 'restaurant-1', currentStep: 2, visitedDate: '2026-10-19', visitedTime: '12:30',
        categories: ['분식', '한식'], content: ' 국물이 진해요 ', foodPhotos: [{ name: 'photo.jpg' }], verificationPhoto: { name: 'receipt.jpg' },
    },
    edit: {
        userId: 'user-1', restaurantId: 'restaurant-1', currentStep: 3, requestKind: 'closure', name: ' 합성 식당 ', address: ' 서울 합성로 ',
        phone: '02-1234-5678', category: [' 분식 '],
        youtube_reviews: [{ restaurant_id: 'restaurant-1', tzuyang_review: ' 합성 리뷰 ', youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    },
    submission: {
        userId: 'user-1', submissionMode: 'request', restaurant_name: ' 합성 식당 ', address: '', phone: '+82 10', categories: ['분식'],
        youtube_link: '', description: ' 합성 설명 ',
    },
};
const persisted: Record<Kind, Row> = {
    review: {
        userId: 'v3-user-1', restaurantId: 'restaurant-1', currentStep: 2, visitedDate: '2026-10-19', visitedTime: '12:30',
        categories: ['분식', '한식'], content: ' 국물이 진해요 ', savedAt, expiresAt: NOW + DAY,
    },
    edit: {
        userId: 'v3-user-1', restaurantId: 'restaurant-1', currentStep: 3, requestKind: 'closure', name: '합성 식당', address: '서울 합성로',
        phone: '0212345678', category: ['분식'],
        youtube_reviews: [{ youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk', tzuyang_review: '합성 리뷰', restaurant_id: 'restaurant-1' }],
        savedAt, expiresAt: NOW + 7 * DAY,
    },
    submission: {
        userId: 'v3-user-1', submissionMode: 'request', currentStep: null, restaurant_name: '합성 식당', address: '', phone: '+82 10',
        categories: ['분식'], youtube_link: '', description: '합성 설명', savedAt, expiresAt: NOW + 7 * DAY,
    },
};
function publicDraft(row: Row): Row {
    const { expiresAt: _expiresAt, ...draft } = { ...row, userId: String(row.userId).replace(/^v3-/, '') };
    if (draft.currentStep === null) delete draft.currentStep;
    if (draft.requestKind === null) delete draft.requestKind;
    return draft;
}
function storedRow(kind: Kind, overrides: Row, savedAtMs = NOW - 60 * MINUTE): Row {
    return { ...persisted[kind], ...overrides, savedAt: new Date(savedAtMs).toISOString(), expiresAt: savedAtMs + contract[kind].ttl };
}
const keyOf = (kind: Kind, row: Row) => JSON.stringify([row.userId, row[contract[kind].slotField]]);
function installExisting(kind: Kind, rows: Row[]): Database {
    const { dbName, version, storeName, slotField } = contract[kind];
    const state: Database = { version, storeName, keyPath: ['userId', slotField], indexes: structuredClone(contractIndexes), rows: new Map() };
    for (const row of rows) state.rows.set(keyOf(kind, row), structuredClone(row));
    databases.set(dbName, state);
    return state;
}
const resetMaintenanceCursor = (kind: Kind) => api(kind).cleanupOldDrafts();
async function freshStore(kind: Kind, rows: Row[]): Promise<Database> {
    const state = installExisting(kind, []);
    await resetMaintenanceCursor(kind);
    for (const row of rows) state.rows.set(keyOf(kind, row), structuredClone(row));
    return state;
}
const pad = (value: number) => String(value).padStart(3, '0');
const ownerRow = (kind: Kind, owner: string, savedAtMs?: number) => storedRow(kind, { userId: 'v3-' + owner }, savedAtMs);
async function rejection(operation: () => Promise<unknown>): Promise<string> {
    try {
        await operation();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('Expected operation to reject');
}

for (const kind of kinds) {
    const { dbName, version, storeName, slotField, slot, invalidSlot, ttl, sweepBatch, textField } = contract[kind];

    test(`${kind}: a new browser gets database ${dbName} v${version} with its key path and indexes`, async () => {
        databases.delete(dbName);
        await api(kind).cleanupOldDrafts();
        const db = databases.get(dbName)!;
        expect({
            version: db.version, storeName: db.storeName, keyPath: db.keyPath,
            indexes: [...db.indexes].sort((left, right) => left.name.localeCompare(right.name)),
        }).toEqual({ version, storeName, keyPath: ['userId', slotField], indexes: contractIndexes });
    });

    test(`${kind}: an older database version is replaced and its rows are discarded`, async () => {
        const state = installExisting(kind, [persisted[kind]]);
        state.version = version - 1;
        expect(await api(kind).getDraft('user-1', slot)).toBeNull();
        expect(databases.get(dbName)!.rows.size).toBe(0);
        expect(databases.get(dbName)!.version).toBe(version);
    });

    test(`${kind}: saves the exact persisted record format`, async () => {
        const state = installExisting(kind, []);
        const saved = await api(kind).saveDraft(inputs[kind]);
        expect([...state.rows.values()].map((row) => JSON.stringify(row))).toEqual([JSON.stringify(persisted[kind])]);
        expect(saved).toEqual(kind === 'review' ? publicDraft(persisted[kind]) : undefined);
    });

    test(`${kind}: a draft already stored by an existing browser loads unchanged`, async () => {
        const existing = storedRow(kind, {}, NOW - 2 * 60 * MINUTE);
        const state = installExisting(kind, [existing]);
        expect(await api(kind).getDraft('user-1', slot)).toEqual(publicDraft(existing));
        expect(await api(kind).getAllDraftsByUser('user-1')).toEqual([publicDraft(existing)]);
        expect(await api(kind).hasDraft('user-1', slot)).toBe(true);
        expect([...state.rows.values()].map((row) => JSON.stringify(row))).toEqual([JSON.stringify(existing)]);
    });

    test(`${kind}: stored timestamp rules`, async () => {
        const cases = [
            { label: 'one millisecond ahead', savedAt: new Date(NOW + 1).toISOString(), loads: kind !== 'review' },
            { label: 'five minutes ahead', savedAt: new Date(NOW + 5 * MINUTE).toISOString(), loads: kind !== 'review' },
            { label: 'past five minutes ahead', savedAt: new Date(NOW + 5 * MINUTE + 1).toISOString(), loads: false },
            { label: 'non-canonical ISO text', savedAt: '2026-10-20T01:00:00Z', loads: kind !== 'review' },
        ];
        for (const item of cases) {
            const row = { ...persisted[kind], savedAt: item.savedAt, expiresAt: Date.parse(item.savedAt) + ttl };
            const state = installExisting(kind, [row]);
            const loaded = await api(kind).getDraft('user-1', slot);
            expect({ label: item.label, loaded }).toEqual({ label: item.label, loaded: item.loads ? publicDraft(row) : null });
            expect({ label: item.label, kept: state.rows.size }).toEqual({ label: item.label, kept: item.loads ? 1 : 0 });
        }
    });

    test(`${kind}: rejects media references with its own invalid-input error`, async () => {
        const state = installExisting(kind, []);
        for (const media of ['data:image/png,AAAA', 'blob:synthetic', 'synthetic base64 text']) {
            const message = await rejection(() => api(kind).saveDraft({ ...inputs[kind], [textField]: media }));
            expect(message).toBe(kind === 'review' ? '임시 저장 데이터가 유효하지 않습니다.' : 'PRIVACY_UNSAFE_VALUE');
        }
        expect(state.rows.size).toBe(0);
    });

    test(`${kind}: an invalid ${slotField} returns early without opening storage`, async () => {
        failOpen = true;
        try {
            expect(await api(kind).getDraft('user-1', invalidSlot)).toBeNull();
            expect(await api(kind).hasDraft('user-1', invalidSlot)).toBe(false);
            expect(await api(kind).deleteDraft('user-1', invalidSlot)).toBeUndefined();
        } finally {
            failOpen = false;
        }
    });

    test(`${kind}: storage failures return fixed results${kind === 'review' ? ' and log fixed labels only' : ' and never log'}`, async () => {
        const logged: unknown[][] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { logged.push(args); };
        failOpen = true;
        try {
            expect(await rejection(() => api(kind).saveDraft(inputs[kind]))).toBe('임시 저장에 실패했습니다.');
            expect(await rejection(() => api(kind).getDraft('user-1', slot))).toBe('DRAFT_READ_UNAVAILABLE');
            expect(await rejection(() => api(kind).deleteDraft('user-1', slot))).toBe('임시 저장 데이터 삭제에 실패했습니다.');
            expect(await api(kind).getAllDraftsByUser('user-1')).toEqual([]);
            expect(await api(kind).cleanupOldDrafts()).toBeUndefined();
            expect(await api(kind).deleteAllDraftsByUser('cleanup-user')).toBe(false);
            expect(await rejection(() => api(kind).recoverLegacyDrafts('user-1'))).toBe('SYNTHETIC_OPEN_FAILED');
        } finally {
            failOpen = false;
            console.error = originalError;
        }
        expect(logged).toEqual(kind === 'review'
            ? [['Draft 저장 실패:'], ['Draft 삭제 실패:'], ['Draft 목록 불러오기 실패:'], ['오래된 Draft 정리 실패:']]
            : []);
    });

    test(`${kind}: one open removes at most ${2 * sweepBatch} expired rows and cleanup runs two passes`, async () => {
        const expired = (i: number) => ownerRow(kind, 'e-' + pad(i), NOW - ttl - (i + 1) * 1000);
        const rows = Array.from({ length: 250 }, (_, i) => expired(i));
        let state = await freshStore(kind, rows);
        expect(await api(kind).hasDraft('nobody', slot)).toBe(false);
        expect(state.rows.size).toBe(250 - 2 * sweepBatch);
        state = await freshStore(kind, rows);
        await api(kind).cleanupOldDrafts();
        expect(state.rows.size).toBe(Math.max(0, 250 - 4 * sweepBatch));
    });

    test(`${kind}: a save runs ${kind === 'review' ? 'two maintenance passes' : 'one maintenance pass'}`, async () => {
        const rows = Array.from({ length: 250 }, (_, i) => ownerRow(kind, 'e-' + pad(i), NOW - ttl - (i + 1) * 1000));
        const state = await freshStore(kind, rows);
        await api(kind).saveDraft(inputs[kind]);
        const expiredLeft = [...state.rows.values()].filter((row) => Number(row.expiresAt) <= NOW).length;
        expect(expiredLeft).toBe(kind === 'review' ? 0 : 250 - 2 * sweepBatch);
    });

    test(`${kind}: invalid-row maintenance ${kind === 'review' ? 'resumes after' : 'restarts before'} the previous batch`, async () => {
        const valid = Array.from({ length: 100 }, (_, i) => ownerRow(kind, 'a-' + pad(i)));
        const invalid = Array.from({ length: 30 }, (_, i) => ({ ...ownerRow(kind, 'z-' + pad(i)), [textField]: 'data:synthetic' }));
        const state = await freshStore(kind, [...valid, ...invalid]);
        for (let open = 0; open < 3; open += 1) await api(kind).hasDraft('nobody', slot);
        const owners = [...state.rows.values()].map((row) => String(row.userId));
        expect(owners.filter((owner) => owner.startsWith('v3-a-'))).toHaveLength(100);
        expect(owners.filter((owner) => owner.startsWith('v3-z-'))).toHaveLength(kind === 'review' ? 0 : 30);
    });
}

for (const kind of ['review', 'edit'] as const) {
    const restaurants = Array.from({ length: 22 }, (_, i) => 'r-' + pad(i));
    const overLimit = () => freshStore(kind, restaurants.map((restaurantId, i) => storedRow(kind, { restaurantId }, NOW - (30 - i) * MINUTE)));
    const kept = (state: Database) => [...state.rows.values()].map((row) => String(row.restaurantId)).sort();

    test(`${kind}: a single read ${kind === 'review' ? 'trims' : 'keeps'} current rows beyond the twenty-draft limit`, async () => {
        const state = await overLimit();
        expect(await api(kind).getDraft('user-1', 'r-021')).toMatchObject({ restaurantId: 'r-021' });
        expect(kept(state)).toEqual(kind === 'review' ? restaurants.slice(2) : restaurants);
    });

    test(`${kind}: a list ${kind === 'review' ? 'trims' : 'keeps'} current rows beyond the twenty-draft limit`, async () => {
        const state = await overLimit();
        const listed = await api(kind).getAllDraftsByUser('user-1');
        expect(listed.map((draft) => draft.restaurantId)).toEqual(kind === 'review' ? restaurants.slice(2) : restaurants.slice(0, 20));
        expect(kept(state)).toEqual(kind === 'review' ? restaurants.slice(2) : restaurants);
    });
}

test('submission: legacy recovery rescans from the first legacy row on every call', async () => {
    const owner = 'recover-user';
    const row = (userId: string, submissionMode: string) => storedRow('submission', { userId, submissionMode });
    const state = await freshStore('submission', [
        row('v3-' + owner, 'new'), row('v2-' + owner, 'new'), row(owner, 'new'), row(owner, 'request'),
    ]);
    expect(await modules.submission.recoverLegacyDrafts(owner)).toBe(0);
    expect(await modules.submission.recoverLegacyDrafts(owner)).toBe(0);
    expect(state.rows.has(JSON.stringify([owner, 'request']))).toBe(true);
    expect(state.rows.has(JSON.stringify(['v3-' + owner, 'request']))).toBe(false);
});
