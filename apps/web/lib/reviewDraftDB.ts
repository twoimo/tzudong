import { createBoundedDraftStore, type DraftStoreFailure } from '@/lib/drafts/bounded-draft-store';
import { containsMediaReference, isBoundedIdentifier, isWithinRecordBytes } from '@/lib/drafts/draft-fields';
import { draftStorageOwnerKey, draftPublicOwnerId, legacyDraftStorageOwnerKeys } from '@/lib/privacy/draft-storage-owner';
import { captureBrowserDraftEpoch, isBrowserDraftEpochCurrent } from '@/lib/privacy/browser-draft-lifecycle';
import { isRecord } from '@/lib/validation/records';
import type { IDBPDatabase } from 'idb';

const STORE_NAME = 'review-drafts';
const REVIEW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
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

function hasExactKeys(value: Record<string, unknown>): boolean {
    const keys = Object.getOwnPropertyNames(value);
    return Object.getOwnPropertySymbols(value).length === 0
        && keys.length === PERSISTED_DRAFT_KEYS.length
        && keys.every((key) => PERSISTED_DRAFT_KEYS.includes(key as typeof PERSISTED_DRAFT_KEYS[number]));
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

function isValidDraftInput(draft: ReviewDraftSaveInput): boolean {
    return isRecord(draft)
        && isBoundedIdentifier(draft.userId)
        && isBoundedIdentifier(draft.restaurantId)
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

    if (!isBoundedIdentifier(userId)
        || !isBoundedIdentifier(restaurantId)
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
    return isWithinRecordBytes(draft, MAX_RECORD_BYTES) ? draft : null;
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

    return isWithinRecordBytes(persistedDraft, MAX_RECORD_BYTES) ? persistedDraft : null;
}

function toPublicDraft(draft: PersistedReviewDraft): ReviewDraftReadResult {
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

const FAILURE_LOG_LABELS: Record<DraftStoreFailure, string> = {
    save: 'Draft 저장 실패:',
    delete: 'Draft 삭제 실패:',
    list: 'Draft 목록 불러오기 실패:',
    cleanup: '오래된 Draft 정리 실패:',
};

const store = createBoundedDraftStore({
    dbName: 'tzudong-review-drafts',
    // Version 2 used a lossy string key and could contain media/reference fields.
    dbVersion: 3,
    storeName: STORE_NAME,
    slotField: 'restaurantId',
    isSlot: isBoundedIdentifier,
    maxDraftsPerUser: 20,
    sweepBatchSize: 100,
    parseInput: createPersistedDraft,
    parseStored: readPersistedReviewDraft,
    toPublic: toPublicDraft,
    invalidInputError: '임시 저장 데이터가 유효하지 않습니다.',
    invalidRowSweep: 'resume-after-last-key',
    legacyRecovery: 'resume-after-last-key',
    pruneOnRead: true,
    extraSweepOnSave: true,
    onFailure: (operation) => console.error(FAILURE_LOG_LABELS[operation]),
});

export const {
    saveDraft,
    getDraft,
    hasDraft,
    deleteDraft,
    deleteAllDraftsByUser,
    getAllDraftsByUser,
    cleanupOldDrafts,
    recoverLegacyDrafts,
} = store;

// Capture only the bounded text revision this composer saved or restored. The returned
// cleanup may finish after the composer unmounts, but cannot delete a newer
// draft from another composer. Compare and delete share one IDB transaction.
// This adds no persisted fields, media, operation IDs, or retention policy.
export async function prepareDraftDeletion(
    userId: string,
    restaurantId: string,
    revision: ReviewDraft | null,
): Promise<() => Promise<boolean>> {
    if (!isBoundedIdentifier(userId) || !isBoundedIdentifier(restaurantId)) return async () => false;
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
    let db: IDBPDatabase | undefined;
    try {
        db = await store.openDatabase();
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
        let cleanupDb: IDBPDatabase | undefined;
        try {
            if (!isBrowserDraftEpochCurrent(userId, epoch)) return true;
            cleanupDb = await store.openDatabase();
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
