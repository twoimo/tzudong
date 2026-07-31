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
        userId: draft.userId,
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
        userId: draft.userId,
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
    return IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
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
): Promise<void> {
    const index = store.index('by-user-saved-at');
    const range = userDraftRange(userId);
    const countedDrafts = readNonNegativeSafeInteger(await index.count(range));
    if (countedDrafts === null) throw new Error('임시 저장 데이터 수를 확인할 수 없습니다.');

    let draftCount = countedDrafts;
    let cursor = await index.openCursor(range);

    while (cursor && draftCount > MAX_DRAFTS_PER_USER) {
        await cursor.delete();
        draftCount -= 1;
        cursor = await cursor.continue();
    }
}

export async function saveDraft(draft: ReviewDraftSaveInput): Promise<void> {
    const persistedDraft = createPersistedDraft(draft, Date.now());
    if (!persistedDraft) {
        throw new Error('임시 저장 데이터가 유효하지 않습니다.');
    }

    try {
        const db = await initDB();
        await sweepExpiredOrInvalidDrafts(db);
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        await transaction.store.put(persistedDraft);
        await enforceUserDraftLimit(transaction.store, persistedDraft.userId);
        await transaction.done;
    } catch {
        console.error('Draft 저장 실패:');
        throw new Error('임시 저장에 실패했습니다.');
    }
}

export async function getDraft(userId: string, restaurantId: string): Promise<ReviewDraftReadResult | null> {
    if (!isValidIdentifier(userId) || !isValidIdentifier(restaurantId)) return null;

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        await enforceUserDraftLimit(transaction.store, userId);
        await transaction.done;

        const key: DraftKey = [userId, restaurantId];
        const storedDraft = await db.get(STORE_NAME, key);
        const draft = readPersistedReviewDraft(storedDraft);
        if (!draft || draft.userId !== userId || draft.restaurantId !== restaurantId) {
            if (storedDraft) await db.delete(STORE_NAME, key);
            return null;
        }
        return toPublicDraft(draft);
    } catch {
        console.error('Draft 불러오기 실패:');
        return null;
    }
}

export async function hasDraft(userId: string, restaurantId: string): Promise<boolean> {
    return (await getDraft(userId, restaurantId)) !== null;
}

export async function deleteDraft(userId: string, restaurantId: string): Promise<void> {
    if (!isValidIdentifier(userId) || !isValidIdentifier(restaurantId)) return;

    try {
        const db = await initDB();
        await db.delete(STORE_NAME, [userId, restaurantId]);
    } catch {
        console.error('Draft 삭제 실패:');
        throw new Error('임시 저장 데이터 삭제에 실패했습니다.');
    }
}

// Delete every scoped row and read back from the same transaction before reporting success.
export async function deleteAllDraftsByUser(userId: string): Promise<boolean> {
    if (!isValidIdentifier(userId)) return false;

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const index = transaction.store.index('by-user');
        let cursor = await index.openCursor(userId);
        while (cursor) {
            await cursor.delete();
            cursor = await cursor.continue();
        }

        const remainingDrafts = await index.count(userId);
        const remainingDraftCount = readNonNegativeSafeInteger(remainingDrafts);
        await transaction.done;
        return remainingDraftCount === 0;
    } catch {
        return false;
    }
}

export async function getAllDraftsByUser(userId: string): Promise<ReviewDraftReadResult[]> {
    if (!isValidIdentifier(userId)) return [];

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        await enforceUserDraftLimit(transaction.store, userId);

        const drafts: ReviewDraftReadResult[] = [];
        const index = transaction.store.index('by-user-saved-at');
        let cursor = await index.openCursor(userDraftRange(userId));
        let scannedRows = 0;
        const now = Date.now();
        while (cursor && scannedRows < MAX_DRAFTS_PER_USER) {
            const draft = readPersistedReviewDraft(cursor.value, now);
            if (draft && draft.userId === userId) {
                drafts.push(toPublicDraft(draft));
            } else {
                await cursor.delete();
            }
            scannedRows += 1;
            cursor = await cursor.continue();
        }

        await transaction.done;
        return drafts;
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
