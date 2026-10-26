import { expect, mock, test } from 'bun:test';

// Deterministic store/abort model. Native IDB scheduling is covered separately
// by legacy-draft-recovery-browser.test.ts; this file launches no browser.
type Row = Record<string, unknown>;
type Key = [string, string];
type Range = { lower?: Key; upper?: Key | number; lowerOpen?: boolean };
const databases = new Map<string, Map<string, Row>>();
let failPut = 0;
let onPut: (() => void) | undefined;
let scans: Key[] = [];
const keyOf = (row: Row): Key => [String(row.userId), String(row.restaurantId)];
const encoded = (key: Key) => JSON.stringify(key);
function compare(left: Key, right: Key) {
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
}
function matches(key: Key, range?: Range) {
    return !range || ((!range.lower || compare(key, range.lower) >= (range.lowerOpen ? 1 : 0))
        && (!range.upper || compare(key, range.upper as Key) <= 0));
}
function store(records: Map<string, Row>) {
    function cursor(rows: Row[], position = 0, track = false): object | null {
        const row = rows[position];
        if (!row) return null;
        return {
            get value() { if (track) scans.push(keyOf(row)); return structuredClone(row); },
            primaryKey: keyOf(row),
            key: keyOf(row),
            delete: async () => { records.delete(encoded(keyOf(row))); },
            continue: async () => cursor(rows, position + 1, track),
        };
    }
    return {
        get: async (key: Key) => structuredClone(records.get(encoded(key))),
        put: async (row: Row) => {
            if (failPut && --failPut === 0) throw new Error('SYNTHETIC_WRITE_FAILED');
            records.set(encoded(keyOf(row)), structuredClone(row));
            onPut?.();
        },
        delete: async (key: Key) => { records.delete(encoded(key)); },
        openCursor: async (range?: Range) => cursor([...records.values()]
            .filter(row => matches(keyOf(row), range)).sort((a, b) => compare(keyOf(a), keyOf(b))), 0,
            Boolean(range?.lower && Array.isArray(range.upper) && range.lower[0] === range.upper[0])),
        index: (name: string) => {
            const entries = (query?: string | Range) => [...records.values()].filter(row => {
                if (name === 'by-expires-at') return Number(row.expiresAt) <= Number((query as Range).upper);
                if (name === 'by-user') return row.userId === query;
                return matches([String(row.userId), String(row.savedAt)], query as Range);
            }).sort((a, b) => name === 'by-expires-at' ? Number(a.expiresAt) - Number(b.expiresAt)
                : name === 'by-user-saved-at' ? String(a.savedAt).localeCompare(String(b.savedAt))
                    : compare(keyOf(a), keyOf(b)));
            return { count: async (query?: string) => entries(query).length,
                openCursor: async (query?: string | Range) => cursor(entries(query), 0,
                    name === 'by-user' && typeof query === 'string' && !query.startsWith('v3-')) };
        },
    };
}
mock.module('idb', () => ({ openDB: async (name: string, _version: number, options: { upgrade: (db: object, old: number) => void }) => {
    if (!databases.has(name)) {
        databases.set(name, new Map());
        options.upgrade({ objectStoreNames: { contains: () => false },
            createObjectStore: () => ({ createIndex: () => {} }) }, 0);
    }
    const records = databases.get(name)!;
    return {
        close() {},
        get: async (_name: string, key: Key) => store(records).get(key),
        transaction() {
            const before = structuredClone(records);
            let aborted = false;
            return { store: store(records),
                abort() { aborted = true; records.clear(); for (const [key, row] of before) records.set(key, row); },
                get done() { return aborted ? Promise.reject(new Error('SYNTHETIC_ABORT')) : Promise.resolve(); } };
        },
    };
} }));
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: {
    upperBound: (upper: number): Range => ({ upper }),
    lowerBound: (lower: Key, lowerOpen = false): Range => ({ lower, lowerOpen }),
    bound: (lower: Key, upper: Key, lowerOpen = false): Range => ({ lower, upper, lowerOpen }),
} });
const review = await import('../../lib/reviewDraftDB');
const edit = await import('../../lib/editRequestDraftDB');
const { activateBrowserDraftOwner, beginBrowserDraftCleanup } = await import('../../lib/privacy/browser-draft-lifecycle');
const { isRestaurantEditSubmitBody, MAX_EDIT_SUBMISSION_BYTES } = await import('../../lib/restaurant-edit-submit-contract');
const kinds = ['review', 'edit'] as const;
const name = (kind: typeof kinds[number]) => kind === 'review' ? 'tzudong-review-drafts' : 'tzudong-edit-request-drafts';
const draft = (kind: typeof kinds[number], userId: string, restaurantId: string, text = '합성 초안') => kind === 'review'
    ? { userId, restaurantId, currentStep: 1, visitedDate: '2026-10-20', visitedTime: '12:00', categories: ['분식'], content: text }
    : { userId, restaurantId, currentStep: 1, requestKind: 'edit', name: text, address: '', phone: '', category: [], youtube_reviews: [] };
function seed(kind: typeof kinds[number], owner: string, count = 10, extra = 5) {
    const records = new Map<string, Row>(); databases.set(name(kind), records);
    const row = (userId: string, i: number) => {
        const now = Date.now();
        return { ...draft(kind, userId, `r-${String(i).padStart(3, '0')}`, userId.startsWith('v3-') ? '현재 초안' : '이전 초안'),
            savedAt: new Date(now).toISOString(), expiresAt: now + (kind === 'review' ? 1 : 7) * 24 * 60 * 60 * 1000 };
    };
    for (const prefix of ['v3-', 'v2-', '']) for (let i = 0; i < count + (prefix === '' ? extra : 0); i++) {
        const item = row(prefix + owner, i); records.set(encoded(keyOf(item)), item);
    }
    failPut = 0; onPut = undefined; scans = [];
    return records;
}
const recover = (kind: typeof kinds[number], owner: string) => (kind === 'review' ? review : edit).recoverLegacyDrafts(owner);
const currentRows = (rows: Map<string, Row>, owner: string) => [...rows.values()].filter(row => row.userId === 'v3-' + owner);

for (const kind of kinds) {
    test(`${kind}: retry advances beyond ten duplicates in both legacy namespaces`, async () => {
        const owner = kind + '-duplicates'; const rows = seed(kind, owner);
        const before = structuredClone(rows);
        expect(await recover(kind, owner)).toBe(0);
        expect(scans).toHaveLength(20);
        expect(rows).toEqual(before);
        scans = [];
        expect(await recover(kind, owner)).toBe(5);
        expect(scans).toHaveLength(5);
        expect(currentRows(rows, owner)).toHaveLength(15);
        for (let i = 10; i < 15; i++) {
            const restaurant = `r-${String(i).padStart(3, '0')}`;
            expect(rows.get(encoded(['v3-' + owner, restaurant])))
                .toEqual({ ...before.get(encoded([owner, restaurant])), userId: 'v3-' + owner });
        }
        for (let i = 0; i < 10; i++) expect(rows.get(encoded(['v3-' + owner, `r-${String(i).padStart(3, '0')}`])))
            .toEqual(before.get(encoded(['v3-' + owner, `r-${String(i).padStart(3, '0')}`])));
        const completed = structuredClone(rows);
        for (let retry = 0; retry < 3; retry++) { scans = []; expect(await recover(kind, owner)).toBe(0); expect(scans.length).toBeLessThanOrEqual(20); }
        expect(rows).toEqual(completed);
    });
    test(`${kind}: partial pass retains capacity and reaches later legacy rows after capacity frees`, async () => {
        const owner = kind + '-capacity'; const rows = seed(kind, owner, 10, 15);
        expect(await recover(kind, owner)).toBe(0);
        scans = []; expect(await recover(kind, owner)).toBe(10); expect(scans).toHaveLength(10);
        expect(currentRows(rows, owner)).toHaveLength(20);
        scans = []; expect(await recover(kind, owner)).toBe(0); expect(scans).toHaveLength(0);
        for (let i = 10; i < 15; i++) rows.delete(encoded(['v3-' + owner, `r-${String(i).padStart(3, '0')}`]));
        scans = []; expect(await recover(kind, owner)).toBe(5); expect(scans).toHaveLength(5);
        expect(currentRows(rows, owner)).toHaveLength(20);
        expect([...rows.values()].filter(row => row.userId === 'v2-' + owner)).toHaveLength(10);
    });
    test(`${kind}: failed copy rolls back both rows and progress, then retries missing rows`, async () => {
        const owner = kind + '-failure'; const rows = seed(kind, owner);
        expect(await recover(kind, owner)).toBe(0);
        const before = structuredClone(rows); failPut = 2;
        await expect(recover(kind, owner)).rejects.toThrow('DRAFT_RECOVERY_FAILED');
        expect(rows).toEqual(before);
        scans = []; expect(await recover(kind, owner)).toBe(5); expect(scans).toHaveLength(5);
    });
    test(`${kind}: progress is user/session scoped and a stale write aborts`, async () => {
        const owner = kind + '-session'; const rows = seed(kind, owner);
        expect(await recover(kind, owner)).toBe(0);
        const other = kind + '-other';
        const savedAt = new Date().toISOString();
        const otherRow = { ...draft(kind, other, 'r-other'), savedAt, expiresAt: Date.parse(savedAt) + (kind === 'review' ? 1 : 7) * 24 * 60 * 60 * 1000 };
        rows.set(encoded(keyOf(otherRow)), otherRow);
        expect(await recover(kind, other)).toBe(1);
        const before = structuredClone(rows);
        onPut = () => beginBrowserDraftCleanup(owner);
        await expect(recover(kind, owner)).rejects.toThrow('DRAFT_RECOVERY_FAILED');
        onPut = undefined; expect(rows).toEqual(before);
        activateBrowserDraftOwner(owner);
        scans = []; expect(await recover(kind, owner)).toBe(0); expect(scans).toHaveLength(20);
        expect(await recover(kind, owner)).toBe(5);
        expect(currentRows(rows, other)).toHaveLength(1);
    });
    test(`${kind}: a completed pass wraps to find a later legacy write below its old cursor`, async () => {
        const owner = kind + '-late'; const rows = seed(kind, owner, 10, 0);
        expect(await recover(kind, owner)).toBe(0);
        expect(await recover(kind, owner)).toBe(0);
        const original = rows.get(encoded([owner, 'r-000']))!;
        const late = { ...original, restaurantId: 'r-000-late' };
        rows.set(encoded(keyOf(late)), late);
        let imported = 0;
        for (let i = 0; i < 3 && !imported; i++) { scans = []; imported += await recover(kind, owner); expect(scans.length).toBeLessThanOrEqual(20); }
        expect(imported).toBe(1);
        expect(rows.has(encoded([owner, 'r-000-late']))).toBe(false);
    });
}

test('edit draft round-trips actual submit-valid 1001 and 4000 character video reviews', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const restaurantId = '33333333-3333-4333-8333-333333333333';
    for (const content of ['a'.repeat(1001), '가'.repeat(4000)]) {
        const payload = { requestKind: 'edit' as const, name: '식당', address: '서울 합성로', phone: '', category: ['분식'],
            youtube_reviews: [{ youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk', tzuyang_review: content, restaurant_id: restaurantId }] };
        const body = { clientRequestKey: 'synthetic-request-258', restaurantId, payload };
        expect(isRestaurantEditSubmitBody(body)).toBe(true);
        expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThan(MAX_EDIT_SUBMISSION_BYTES);
        await edit.saveDraft({ userId, restaurantId, ...payload });
        expect((await edit.getDraft(userId, restaurantId))?.youtube_reviews[0].tzuyang_review).toBe(content);
        await expect(edit.saveDraft({ userId, restaurantId, ...payload,
            youtube_reviews: [{ ...payload.youtube_reviews[0], tzuyang_review: '가'.repeat(4001) }] })).rejects.toThrow();
        expect((await edit.getDraft(userId, restaurantId))?.youtube_reviews[0].tzuyang_review).toBe(content);
    }
});
test('edit draft keeps submit-valid review/category counts and rejects oversized records without replacing a kept draft', async () => {
    const userId = 'bounds-user'; const restaurantId = '33333333-3333-4333-8333-333333333333';
    const payload = { requestKind: 'edit' as const, name: '식당', address: '서울 합성로', phone: '', category: Array.from({ length: 10 }, (_, i) => '분류' + i),
        youtube_reviews: Array.from({ length: 100 }, () => ({ youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk', tzuyang_review: '합성 리뷰', restaurant_id: restaurantId })) };
    expect(isRestaurantEditSubmitBody({ clientRequestKey: 'synthetic-request-258', restaurantId, payload })).toBe(true);
    await edit.saveDraft({ userId, restaurantId, ...payload });
    const saved = await edit.getDraft(userId, restaurantId);
    expect(saved?.youtube_reviews).toHaveLength(100); expect(saved?.category).toHaveLength(10);
    await expect(edit.saveDraft({ userId, restaurantId, ...payload,
        youtube_reviews: payload.youtube_reviews.map((row, i) => i === 99 ? { ...row, tzuyang_review: 'password=synthetic-value' } : row) })).rejects.toThrow();
    expect(await edit.getDraft(userId, restaurantId)).toEqual(saved);
    await expect(edit.saveDraft({ userId, restaurantId, ...payload,
        youtube_reviews: payload.youtube_reviews.map(row => ({ ...row, tzuyang_review: '가'.repeat(4000) })) })).rejects.toThrow();
    expect(await edit.getDraft(userId, restaurantId)).toEqual(saved);
});
