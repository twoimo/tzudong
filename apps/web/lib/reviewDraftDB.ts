import { draftStorageOwnerKey, draftPublicOwnerId, legacyDraftStorageOwnerKeys } from '@/lib/privacy/draft-storage-owner';
import { assertBrowserDraftWrite, beginBrowserDraftCleanup, captureBrowserDraftEpoch, isBrowserDraftEpochCurrent, type BrowserDraftEpoch } from '@/lib/privacy/browser-draft-lifecycle';
import { openDB, DBSchema, IDBPDatabase, IDBPObjectStore } from 'idb';

const DB_NAME = 'tzudong-review-drafts';
const DB_VERSION = 3;
const STORE_NAME = 'review-drafts';
const REVIEW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DRAFTS_PER_USER = 20;
const MAX_SWEEP_ROWS = 100;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_CONTENT_LENGTH = 4_000;
const MAX_CATEGORY_LENGTH = 16;
const MAX_CATEGORIES = 15;
const MAX_RECORD_BYTES = 16 * 1024;
const legacyRecoveryPositions = new WeakMap<BrowserDraftEpoch, { namespace: number; after?: [string, string] }>();
const DRAFT_CATEGORIES = new Set([
    '치킨',
    '중식',
    '돈까스·회',
    '피자',
    '패스트푸드',
    '찜·탕',
    '족발·보쌈',
    '분식',
    '카페·디저트',
    '한식',
    '고기',
    '양식',
    '아시안',
    '야식',
    '도시락',
]);
const PERSISTED_DRAFT_KEYS = [
    'userId',
    'restaurantId',
    'currentStep',
    'visitedDate',
    'visitedTime',
    'categories',
    'content',
    'savedAt',
    'expiresAt',
] as const;

type DraftKey = [string, string];

// Public drafts deliberately contain text fields only. Media is never stored or restored.
export interface ReviewDraft {
    userId: string;
    restaurantId: string;
    currentStep?: 1 | 2 | 3;
    visitedDate: string;
    visitedTime: string;
    categories: string[];
    content: string;
    savedAt: string;
}

// Existing client autosaves may supply media fields, but this boundary always discards them.
type IgnoredReviewDraftMediaInput = {
    verificationPhoto?: unknown;
    foodPhotos?: unknown;
    existingFoodPhotos?: unknown;
    removedPhotos?: unknown;
};

type NeverRestoredReviewDraftMedia = {
    verificationPhoto?: undefined;
    foodPhotos?: never[];
    existingFoodPhotos?: never[];
    removedPhotos?: never[];
};
export type ReviewDraftSaveInput = Omit<ReviewDraft, 'savedAt'> & IgnoredReviewDraftMediaInput;
type ReviewDraftReadResult = ReviewDraft & NeverRestoredReviewDraftMedia;

// This is the only schema persisted in IndexedDB. Do not add media or arbitrary form state.
interface PersistedReviewDraft {
    userId: string;
    restaurantId: string;
    currentStep: 1 | 2 | 3 | null;
    visitedDate: string;
    visitedTime: string;
    categories: string[];
    content: string;
    savedAt: string;
    expiresAt: number;
}

interface ReviewDraftDB extends DBSchema {
    'review-drafts': {
        key: DraftKey;
        value: PersistedReviewDraft;
        indexes: {
            'by-user': string;
            'by-expires-at': number;
            'by-user-saved-at': [string, string];
        };
    };
}

let invalidSweepAfter: IDBValidKey | undefined;

async function initDB(): Promise<IDBPDatabase<ReviewDraftDB>> {
    const db = await openDB<ReviewDraftDB>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
            // Version 2 used a lossy string key and could contain media/reference fields.
            if (oldVersion < DB_VERSION && db.objectStoreNames.contains(STORE_NAME)) {
                db.deleteObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: ['userId', 'restaurantId'],
                });
                store.createIndex('by-user', 'userId');
                store.createIndex('by-expires-at', 'expiresAt');
                store.createIndex('by-user-saved-at', ['userId', 'savedAt']);
            }
        },
    });

    await sweepExpiredOrInvalidDrafts(db);
    return db;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>): boolean {
    const keys = Object.getOwnPropertyNames(value);
    return Object.getOwnPropertySymbols(value).length === 0
        && keys.length === PERSISTED_DRAFT_KEYS.length
        && keys.every((key) => PERSISTED_DRAFT_KEYS.includes(key as typeof PERSISTED_DRAFT_KEYS[number]));
}

function isValidIdentifier(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_IDENTIFIER_LENGTH
        && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}
function readNonNegativeSafeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}


function containsMediaReference(value: string): boolean {
    return /(?:data|blob):|\bbase64\b/i.test(value);
}

function isValidContent(value: unknown): value is string {
    return typeof value === 'string'
        && value.length <= MAX_CONTENT_LENGTH
        && !containsMediaReference(value);
}

function isValidCategories(value: unknown): value is string[] {
    return Array.isArray(value)
        && value.length <= MAX_CATEGORIES
        && value.every((category) => typeof category === 'string'
            && category.length > 0
            && category.length <= MAX_CATEGORY_LENGTH
            && DRAFT_CATEGORIES.has(category))
        && new Set(value).size === value.length;
}

function isValidVisitedDate(value: unknown): value is string {
    if (value === '') return true;
    if (typeof value !== 'string' || value.length !== 10) return false;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function isValidVisitedTime(value: unknown): value is string {
    return value === '' || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function isValidCurrentStep(value: unknown): value is 1 | 2 | 3 {
    return value === 1 || value === 2 || value === 3;
}

function parseCanonicalTimestamp(value: unknown): number | null {
    if (typeof value !== 'string' || value.length !== 24) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString() === value ? timestamp : null;
}

function isWithinRecordByteLimit(draft: PersistedReviewDraft): boolean {
    return new TextEncoder().encode(JSON.stringify(draft)).byteLength <= MAX_RECORD_BYTES;
}

function isValidDraftInput(draft: ReviewDraftSaveInput): boolean {
    return isRecord(draft)
        && isValidIdentifier(draft.userId)
        && isValidIdentifier(draft.restaurantId)
        && (draft.currentStep === undefined || isValidCurrentStep(draft.currentStep))
        && isValidVisitedDate(draft.visitedDate)
        && isValidVisitedTime(draft.visitedTime)
        && isValidCategories(draft.categories)
        && isValidContent(draft.content);
}

function readPersistedReviewDraft(value: unknown, now = Date.now()): PersistedReviewDraft | null {
    if (!isRecord(value) || !hasExactKeys(value)) return null;

    const userId = value.userId;
    const restaurantId = value.restaurantId;
    const storedCurrentStep = value.currentStep;
    const currentStep = storedCurrentStep === null
        ? null
        : isValidCurrentStep(storedCurrentStep)
            ? storedCurrentStep
            : undefined;
    const visitedDate = value.visitedDate;
    const visitedTime = value.visitedTime;
    const categories = value.categories;
    const content = value.content;
    const savedAt = value.savedAt;
    if (typeof savedAt !== 'string') return null;

    const expiresAt = value.expiresAt;
    const savedAtMs = parseCanonicalTimestamp(savedAt);
    if (savedAtMs === null || savedAtMs > now) return null;

    if (!isValidIdentifier(userId)
        || !isValidIdentifier(restaurantId)
        || currentStep === undefined
        || !isValidVisitedDate(visitedDate)
        || !isValidVisitedTime(visitedTime)
        || !isValidCategories(categories)
        || !isValidContent(content)
        || typeof expiresAt !== 'number'
        || !Number.isSafeInteger(expiresAt)
        || expiresAt !== savedAtMs + REVIEW_DRAFT_TTL_MS
        || expiresAt <= now) {
        return null;
    }

    const draft: PersistedReviewDraft = {
        userId,
        restaurantId,
        currentStep,
        visitedDate,
        visitedTime,
        categories: [...categories],
        content,
        savedAt,
        expiresAt,
    };
    return isWithinRecordByteLimit(draft) ? draft : null;
}

function createPersistedDraft(draft: ReviewDraftSaveInput, now: number): PersistedReviewDraft | null {
    if (!isValidDraftInput(draft)) return null;

    const persistedDraft: PersistedReviewDraft = {
        userId: draftStorageOwnerKey(draft.userId),
        restaurantId: draft.restaurantId,
        currentStep: draft.currentStep ?? null,
        visitedDate: draft.visitedDate,
        visitedTime: draft.visitedTime,
        categories: [...draft.categories],
        content: draft.content,
        savedAt: new Date(now).toISOString(),
        expiresAt: now + REVIEW_DRAFT_TTL_MS,
    };

    return isWithinRecordByteLimit(persistedDraft) ? persistedDraft : null;
}

function toPublicDraft(draft: PersistedReviewDraft): ReviewDraft {
    const publicDraft: ReviewDraft = {
        userId: draftPublicOwnerId(draft.userId),
        restaurantId: draft.restaurantId,
        visitedDate: draft.visitedDate,
        visitedTime: draft.visitedTime,
        categories: [...draft.categories],
        content: draft.content,
        savedAt: draft.savedAt,
    };
    if (draft.currentStep !== null) {
        publicDraft.currentStep = draft.currentStep;
    }
    return publicDraft;
}

function userDraftRange(userId: string): IDBKeyRange {
    return IDBKeyRange.bound([draftStorageOwnerKey(userId), ''], [draftStorageOwnerKey(userId), '\uffff']);
}

async function sweepExpiredOrInvalidDrafts(db: IDBPDatabase<ReviewDraftDB>): Promise<void> {
    const now = Date.now();

    const expiredTransaction = db.transaction(STORE_NAME, 'readwrite');
    const expiryIndex = expiredTransaction.store.index('by-expires-at');
    let expiredCursor = await expiryIndex.openCursor(IDBKeyRange.upperBound(now));
    let expiredRows = 0;
    while (expiredCursor && expiredRows < MAX_SWEEP_ROWS) {
        await expiredCursor.delete();
        expiredRows += 1;
        expiredCursor = await expiredCursor.continue();
    }
    await expiredTransaction.done;

    const invalidTransaction = db.transaction(STORE_NAME, 'readwrite');
    let invalidCursor = await invalidTransaction.store.openCursor(
        invalidSweepAfter === undefined ? undefined : IDBKeyRange.lowerBound(invalidSweepAfter, true),
    );
    let scannedRows = 0;
    let lastKey: IDBValidKey | undefined;
    while (invalidCursor && scannedRows < MAX_SWEEP_ROWS) {
        lastKey = invalidCursor.primaryKey;
        if (!readPersistedReviewDraft(invalidCursor.value, now)) {
            await invalidCursor.delete();
        }
        scannedRows += 1;
        invalidCursor = await invalidCursor.continue();
    }
    invalidSweepAfter = invalidCursor ? lastKey : undefined;
    await invalidTransaction.done;
}

async function enforceUserDraftLimit(
    store: IDBPObjectStore<ReviewDraftDB, ['review-drafts'], 'review-drafts', 'readwrite'>,
    userId: string,
    epoch: BrowserDraftEpoch,
): Promise<void> {
    const index = store.index('by-user-saved-at');
    const range = userDraftRange(userId);
    const countedDrafts = readNonNegativeSafeInteger(await index.count(range));
    if (countedDrafts === null) throw new Error('임시 저장 데이터 수를 확인할 수 없습니다.');

    let draftCount = countedDrafts;
    let cursor = await index.openCursor(range);

    while (cursor && draftCount > MAX_DRAFTS_PER_USER) {
        assertBrowserDraftWrite(userId, epoch);
        await cursor.delete();
        draftCount -= 1;
        cursor = await cursor.continue();
    }
}

export async function saveDraft(draft: ReviewDraftSaveInput): Promise<ReviewDraft | null> {
    const persistedDraft = createPersistedDraft(draft, Date.now());
    if (!persistedDraft) {
        throw new Error('임시 저장 데이터가 유효하지 않습니다.');
    }

    const epoch = captureBrowserDraftEpoch(draft.userId);
    assertBrowserDraftWrite(draft.userId, epoch);

    try {
        const db = await initDB();
        await sweepExpiredOrInvalidDrafts(db);
        assertBrowserDraftWrite(draft.userId, epoch);
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        // Wait for this readwrite transaction to acquire its store before
        // admitting the write. A pre-transaction localStorage check alone
        // leaves a gap while another tab can finish a cleanup transaction.
        await transaction.store.get([persistedDraft.userId, persistedDraft.restaurantId]);
        assertBrowserDraftWrite(draft.userId, epoch);
        await transaction.store.put(persistedDraft);
        await enforceUserDraftLimit(transaction.store, draft.userId, epoch);
        const committed = await transaction.store.get([persistedDraft.userId, persistedDraft.restaurantId]);
        await transaction.done;
        return committed && isBrowserDraftEpochCurrent(draft.userId, epoch, true) ? toPublicDraft(committed) : null;
    } catch {
        console.error('Draft 저장 실패:');
        throw new Error('임시 저장에 실패했습니다.');
    }
}

export async function getDraft(userId: string, restaurantId: string): Promise<ReviewDraftReadResult | null> {
    if (!isValidIdentifier(userId) || !isValidIdentifier(restaurantId)) return null;

    const epoch = captureBrowserDraftEpoch(userId);
    if (!isBrowserDraftEpochCurrent(userId, epoch, true)) throw new Error('DRAFT_READ_UNAVAILABLE');

    let transactionDone: Promise<unknown> | undefined;
    try {
        const db = await initDB();
        assertBrowserDraftWrite(userId, epoch);
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transactionDone = transaction.done;
        await enforceUserDraftLimit(transaction.store, userId, epoch);

        const key: DraftKey = [draftStorageOwnerKey(userId), restaurantId];
        const storedDraft = await transaction.store.get(key);
        const draft = readPersistedReviewDraft(storedDraft);
        if (!draft || draft.userId !== draftStorageOwnerKey(userId) || draft.restaurantId !== restaurantId) {
            if (storedDraft) { assertBrowserDraftWrite(userId, epoch); await transaction.store.delete(key); }
            await transaction.done;
            return null;
        }
        await transaction.done;
        return isBrowserDraftEpochCurrent(userId, epoch, true) ? toPublicDraft(draft) : null;
    } catch {
        await transactionDone?.catch(() => {});
        if (!isBrowserDraftEpochCurrent(userId, epoch, true)) return null;
        throw new Error('DRAFT_READ_UNAVAILABLE');
    }
}

export async function hasDraft(userId: string, restaurantId: string): Promise<boolean> {
    return (await getDraft(userId, restaurantId)) !== null;
}

export async function deleteDraft(userId: string, restaurantId: string): Promise<void> {
    if (!isValidIdentifier(userId) || !isValidIdentifier(restaurantId)) return;

    const epoch = captureBrowserDraftEpoch(userId);
    let db: IDBPDatabase<ReviewDraftDB> | undefined;
    try {
        db = await initDB();
        if (!isBrowserDraftEpochCurrent(userId, epoch)) return;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const deletions: Promise<void>[] = [];
        try {
            // Acquire the transaction before checking the session, then remove both
            // versions of this explicit discard atomically. Otherwise a later import
            // could resurrect the old text.
            await transaction.store.get([draftStorageOwnerKey(userId), restaurantId]);
            if (isBrowserDraftEpochCurrent(userId, epoch)) {
                deletions.push(transaction.store.delete([draftStorageOwnerKey(userId), restaurantId]));
                for (const legacyOwner of legacyDraftStorageOwnerKeys(userId)) {
                    deletions.push(transaction.store.delete([legacyOwner, restaurantId]));
                }
                await Promise.all(deletions);
            }
            await transaction.done;
        } catch {
            try { transaction.abort(); } catch { /* It may already have completed. */ }
            await Promise.allSettled(deletions);
            await transaction.done.catch(() => {});
            throw new Error('DRAFT_DELETE_FAILED');
        }
    } catch {
        console.error('Draft 삭제 실패:');
        throw new Error('임시 저장 데이터 삭제에 실패했습니다.');
    } finally { db?.close(); }
}

// Capture only the bounded text revision this composer saved or restored. The returned
// cleanup may finish after the composer unmounts, but cannot delete a newer
// draft from another composer. Compare and delete share one IDB transaction.
// This adds no persisted fields, media, operation IDs, or retention policy.
export async function prepareDraftDeletion(
    userId: string,
    restaurantId: string,
    revision: ReviewDraft | null,
): Promise<() => Promise<boolean>> {
    if (!isValidIdentifier(userId) || !isValidIdentifier(restaurantId)) return async () => false;
    // A row at this key is not proof of ownership: another composer may have
    // saved it even before capture. Missing/out-of-scope authority is a no-op.
    if (!revision || revision.userId !== userId || revision.restaurantId !== restaurantId) return async () => true;
    const savedAt = parseCanonicalTimestamp(revision.savedAt);
    const owned = savedAt === null ? null : createPersistedDraft(revision, savedAt);
    if (!owned) throw new Error('REVIEW_DRAFT_CAPTURE_FAILED');
    if (owned.expiresAt <= Date.now()) return async () => true;
    if (!readPersistedReviewDraft(owned)) throw new Error('REVIEW_DRAFT_CAPTURE_FAILED');
    const epoch = captureBrowserDraftEpoch(userId);
    const expected = JSON.stringify(owned);
    const key: DraftKey = [draftStorageOwnerKey(userId), restaurantId];
    const legacyKeys: DraftKey[] = legacyDraftStorageOwnerKeys(userId).map(owner => [owner, restaurantId]);
    const expectedLegacy = new Map<string, string>();
    let db: IDBPDatabase<ReviewDraftDB> | undefined;
    try {
        db = await initDB();
        const stored = await db.get(STORE_NAME, key);
        const snapshot = stored === undefined ? null : readPersistedReviewDraft(stored);
        if (stored !== undefined && !snapshot) throw new Error('REVIEW_DRAFT_CAPTURE_FAILED');
        if (JSON.stringify(snapshot) !== expected) return async () => true;
        for (const legacyKey of legacyKeys) {
            const legacy = readPersistedReviewDraft(await db.get(STORE_NAME, legacyKey));
            if (legacy?.userId === legacyKey[0]
                && JSON.stringify({ ...legacy, userId: draftStorageOwnerKey(userId) }) === expected) {
                expectedLegacy.set(legacyKey[0], JSON.stringify(legacy));
            }
        }
    } catch {
        // No deletion authority was captured. The operation must retry this
        // read before it dispatches uploads/insert, rather than retaining a
        // permanent false closure after an otherwise committed review.
        throw new Error('REVIEW_DRAFT_CAPTURE_FAILED');
    } finally {
        db?.close();
    }
    return async () => {
        let cleanupDb: IDBPDatabase<ReviewDraftDB> | undefined;
        try {
            if (!isBrowserDraftEpochCurrent(userId, epoch)) return true;
            cleanupDb = await initDB();
            if (!isBrowserDraftEpochCurrent(userId, epoch)) return true;
            const transaction = cleanupDb.transaction(STORE_NAME, 'readwrite');
            const stored = await transaction.store.get(key);
            const current = stored === undefined ? null : readPersistedReviewDraft(stored);
            if (stored !== undefined && !current) {
                await transaction.done;
                return false;
            }
            const currentMatches = stored !== undefined && JSON.stringify(current) === expected;
            const legacyRows = await Promise.all(legacyKeys.map(legacyKey => transaction.store.get(legacyKey)));
            if (!isBrowserDraftEpochCurrent(userId, epoch)) { await transaction.done; return true; }
            const deletions: Promise<void>[] = [];
            try {
                // Submission owns only the captured revision in each namespace.
                // Preserve edits made by another composer after capture.
                // A replacement in the current namespace does not revoke the
                // independently captured authority over matching legacy rows.
                if (currentMatches) deletions.push(transaction.store.delete(key));
                legacyKeys.forEach((legacyKey, index) => {
                    const captured = expectedLegacy.get(legacyKey[0]);
                    if (captured !== undefined && JSON.stringify(readPersistedReviewDraft(legacyRows[index])) === captured) {
                        deletions.push(transaction.store.delete(legacyKey));
                    }
                });
                await Promise.all(deletions);
                await transaction.done;
                return true;
            } catch {
                try { transaction.abort(); } catch { /* It may already have completed. */ }
                await Promise.allSettled(deletions);
                await transaction.done.catch(() => {});
                return false;
            }
        } catch {
            return false;
        } finally {
            cleanupDb?.close();
        }
    };
}

// Delete every scoped row and read back from the same transaction before reporting success.
export async function deleteAllDraftsByUser(userId: string, cleanupEpoch?: BrowserDraftEpoch): Promise<boolean> {
    if (!isValidIdentifier(userId)) return false;
    const epoch = cleanupEpoch ?? beginBrowserDraftCleanup(userId);
    try {
        const db = await initDB();
        if (!isBrowserDraftEpochCurrent(userId, epoch)) return false;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const index = transaction.store.index('by-user');
        let remaining = 0;
        for (const ownerKey of [draftStorageOwnerKey(userId), ...legacyDraftStorageOwnerKeys(userId)]) {
            let cursor = await index.openCursor(ownerKey);
            let deleted = 0;
            while (cursor && deleted < 100) {
                if (!isBrowserDraftEpochCurrent(userId, epoch)) { await transaction.done; return false; }
                await cursor.delete();
                deleted++;
                cursor = await cursor.continue();
            }
            const count = readNonNegativeSafeInteger(await index.count(ownerKey));
            if (count === null) { await transaction.done; return false; }
            remaining += count;
        }
        await transaction.done;
        return remaining === 0 && isBrowserDraftEpochCurrent(userId, epoch);
    } catch { return false; }
}

export async function getAllDraftsByUser(userId: string): Promise<ReviewDraftReadResult[]> {
    if (!isValidIdentifier(userId)) return [];

    const epoch = captureBrowserDraftEpoch(userId);
    if (!isBrowserDraftEpochCurrent(userId, epoch, true)) return [];

    try {
        const db = await initDB();
        assertBrowserDraftWrite(userId, epoch);
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        await enforceUserDraftLimit(transaction.store, userId, epoch);

        const drafts: ReviewDraftReadResult[] = [];
        const index = transaction.store.index('by-user-saved-at');
        let cursor = await index.openCursor(userDraftRange(userId));
        let scannedRows = 0;
        const now = Date.now();
        while (cursor && scannedRows < MAX_DRAFTS_PER_USER) {
            const draft = readPersistedReviewDraft(cursor.value, now);
            if (draft && draft.userId === draftStorageOwnerKey(userId)) {
                drafts.push(toPublicDraft(draft));
            } else {
                assertBrowserDraftWrite(userId, epoch);
                await cursor.delete();
            }
            scannedRows += 1;
            cursor = await cursor.continue();
        }

        await transaction.done;
        return isBrowserDraftEpochCurrent(userId, epoch, true) ? drafts : [];
    } catch {
        console.error('Draft 목록 불러오기 실패:');
        return [];
    }
}

export async function cleanupOldDrafts(): Promise<void> {
    try {
        const db = await initDB();
        await sweepExpiredOrInvalidDrafts(db);
    } catch {
        console.error('오래된 Draft 정리 실패:');
    }
}

// Explicit, owner-scoped recovery preserves timestamps/expiry and never replaces
// an existing current draft. Old clients may still write legacy rows afterward;
// those rows never become an automatic restore source.
export async function recoverLegacyDrafts(userId: string): Promise<number> {
    if (!isValidIdentifier(userId)) return 0;
    const epoch = captureBrowserDraftEpoch(userId);
    assertBrowserDraftWrite(userId, epoch);
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    try {
        const index = transaction.store.index('by-user');
        const existingCount = readNonNegativeSafeInteger(await index.count(draftStorageOwnerKey(userId)));
        if (existingCount === null) throw new Error('DRAFT_RECOVERY_FAILED');
        let count = existingCount;
        let imported = 0;
        let scanned = 0;
        const legacyOwners = legacyDraftStorageOwnerKeys(userId);
        const progress = legacyRecoveryPositions.get(epoch);
        let namespace = progress?.namespace ?? 0;
        let after = progress?.after;
        for (; namespace < legacyOwners.length && scanned < MAX_DRAFTS_PER_USER && count < MAX_DRAFTS_PER_USER; namespace++) {
            const legacyOwner = legacyOwners[namespace];
            // A closed upper endpoint cannot become an exclusive lower bound.
            if (after && after[1] >= '\uffff') { after = undefined; continue; }
            let cursor = await transaction.store.openCursor(IDBKeyRange.bound(
                after ?? [legacyOwner, ''], [legacyOwner, '\uffff'], after !== undefined,
            ));
            after = undefined;
            while (cursor && scanned < MAX_DRAFTS_PER_USER && count < MAX_DRAFTS_PER_USER) {
                const row = readPersistedReviewDraft(cursor.value);
                const candidate = row && readPersistedReviewDraft({ ...row, userId: draftStorageOwnerKey(userId) });
                if (candidate && row && row.userId === legacyOwner) {
                    const key = [draftStorageOwnerKey(userId), row.restaurantId] as DraftKey;
                    const existing = await transaction.store.get(key);
                    assertBrowserDraftWrite(userId, epoch);
                    if (existing === undefined) {
                        await transaction.store.put(candidate);
                        // Move only after the validated copy is admitted. Both operations
                        // share this transaction; failure preserves the original.
                        assertBrowserDraftWrite(userId, epoch);
                        await cursor.delete();
                        imported++;
                        count++;
                    }
                }
                scanned++;
                after = cursor.primaryKey;
                if (scanned >= MAX_DRAFTS_PER_USER || count >= MAX_DRAFTS_PER_USER) break;
                cursor = await cursor.continue();
            }
            if (cursor) break;
            after = undefined;
        }
        await transaction.done;
        assertBrowserDraftWrite(userId, epoch);
        // Commit progress with the copy, never with an aborted or stale session.
        if (namespace < legacyOwners.length) legacyRecoveryPositions.set(epoch, { namespace, after });
        else legacyRecoveryPositions.delete(epoch);
        return imported;
    } catch {
        try { transaction.abort(); } catch { /* It may already have completed. */ }
        await transaction.done.catch(() => {});
        throw new Error('DRAFT_RECOVERY_FAILED');
    } finally { db.close(); }
}
