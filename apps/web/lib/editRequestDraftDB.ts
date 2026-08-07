import { openDB, DBSchema, IDBPDatabase, IDBPObjectStore } from 'idb';
import {
    PRIVACY_UNSAFE_VALUE_REASON,
    PrivacyUnsafeValueError,
    assertPrivacySafe,
} from '@/lib/privacy/sanitize';

export interface EditRequestDraft {
    userId: string;
    restaurantId: string;
    currentStep?: 1 | 2 | 3;
    requestKind?: 'edit' | 'closure';
    name: string;
    address: string;
    phone: string;
    category: string[];
    youtube_reviews: Array<{
        youtube_link: string;
        tzuyang_review: string;
        restaurant_id: string;
    }>;
    savedAt: string;
}

type PersistedEditRequestDraft = Omit<EditRequestDraft, 'currentStep' | 'requestKind'> & {
    currentStep: 1 | 2 | 3 | null;
    requestKind: 'edit' | 'closure' | null;
    expiresAt: number;
};

interface EditRequestDraftDB extends DBSchema {
    'edit-request-drafts': {
        key: [string, string];
        value: PersistedEditRequestDraft;
        indexes: {
            'by-user': string;
            'by-user-saved-at': [string, string];
            'by-expires-at': number;
        };
    };
}

const DB_NAME = 'tzudong-edit-request-drafts';
const DB_VERSION = 2;
const STORE_NAME = 'edit-request-drafts';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DRAFTS_PER_USER = 20;
const MAX_SWEEP_RECORDS = 50;
const MAX_RECORD_BYTES = 12 * 1024;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MAX_PHONE_LENGTH = 32;
const MAX_CATEGORY_COUNT = 8;
const MAX_CATEGORY_LENGTH = 64;
const MAX_REVIEW_COUNT = 12;
const MAX_LINK_LENGTH = 2_048;
const MAX_REVIEW_TEXT_LENGTH = 1_000;

const DRAFT_FIELDS = new Set([
    'userId',
    'restaurantId',
    'currentStep',
    'requestKind',
    'name',
    'address',
    'phone',
    'category',
    'youtube_reviews',
]);

const STORED_DRAFT_FIELDS = new Set([
    ...DRAFT_FIELDS,
    'savedAt',
    'expiresAt',
]);

const YOUTUBE_REVIEW_FIELDS = new Set([
    'youtube_link',
    'tzuyang_review',
    'restaurant_id',
]);

function isBoundedIdentifier(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_IDENTIFIER_LENGTH
        && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}
function readNonNegativeSafeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}


function isKnownProxy(value: object): boolean {
    try {
        const runtime = globalThis as typeof globalThis & {
            process?: {
                getBuiltinModule?: (name: string) => unknown;
            };
        };
        const getBuiltinModule = runtime.process?.getBuiltinModule;
        if (typeof getBuiltinModule !== 'function') return false;

        const util = getBuiltinModule('node:util') as {
            types?: {
                isProxy?: (candidate: object) => boolean;
            };
        } | undefined;

        return util?.types?.isProxy?.(value) === true;
    } catch {
        return true;
    }
}

// Browsers have no trap-free Proxy identity API. Without Node/Bun's detector, descriptor
// inspection rejects observable exotic shapes but cannot synchronously identify a transparent Proxy.
function readPlainDataRecord(value: unknown, allowedFields: ReadonlySet<string>): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || isKnownProxy(value) || Array.isArray(value)) return null;

    try {
        if (Object.getPrototypeOf(value) !== Object.prototype) return null;

        const keys = Reflect.ownKeys(value);
        if (keys.length > allowedFields.size || keys.some((key) => typeof key !== 'string' || !allowedFields.has(key))) {
            return null;
        }

        const descriptors = Object.getOwnPropertyDescriptors(value);
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = descriptors[key as string];
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            snapshot[key as string] = descriptor.value;
        }
        return snapshot;
    } catch {
        return null;
    }
}

function readPlainDataArray(value: unknown): unknown[] | null {
    if (!value || typeof value !== 'object' || isKnownProxy(value) || !Array.isArray(value)) return null;

    try {
        if (Object.getPrototypeOf(value) !== Array.prototype) return null;

        const keys = Reflect.ownKeys(value);
        if (keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) {
            return null;
        }

        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
        const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
            ? readNonNegativeSafeInteger(lengthDescriptor.value)
            : null;
        if (length === null) return null;
        if (keys.length !== length + 1) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);

        const snapshot: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            snapshot.push(descriptor.value);
        }
        return snapshot;
    } catch {
        return null;
    }
}

function containsMediaReference(value: string): boolean {
    return /(?:data|blob):|\bbase64\b/i.test(value);
}

function normalizeText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string' || value.length > maxLength || containsMediaReference(value)) return null;
    return value.trim();
}

function normalizeStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | null {
    const values = readPlainDataArray(value);
    if (!values || values.length > maxItems) return null;

    const normalized: string[] = [];
    for (const item of values) {
        const text = normalizeText(item, maxItemLength);
        if (!text || normalized.includes(text)) return null;
        normalized.push(text);
    }
    return normalized;
}

function normalizeBusinessPhone(value: unknown): string | null {
    const phone = normalizeText(value, MAX_PHONE_LENGTH);
    if (phone === null) return null;
    if (!phone) return '';
    if (!/^\+?[\d\s().-]+$/.test(phone)) return null;

    const canonical = phone.replace(/[^\d+]/g, '');
    const digits = canonical.replace(/\+/g, '');
    if (!/^\+?\d+$/.test(canonical) || digits.length < 7 || digits.length > 20) return null;
    return canonical;
}

function normalizeYoutubeReviews(value: unknown): EditRequestDraft['youtube_reviews'] | null {
    const values = readPlainDataArray(value);
    if (!values || values.length > MAX_REVIEW_COUNT) return null;

    const reviews: EditRequestDraft['youtube_reviews'] = [];
    for (const item of values) {
        const record = readPlainDataRecord(item, YOUTUBE_REVIEW_FIELDS);
        if (!record) return null;

        const youtubeLink = normalizeText(record.youtube_link, MAX_LINK_LENGTH);
        const reviewText = normalizeText(record.tzuyang_review, MAX_REVIEW_TEXT_LENGTH);
        const restaurantId = record.restaurant_id;
        if (youtubeLink === null || reviewText === null || !isBoundedIdentifier(restaurantId)) return null;

        reviews.push({
            youtube_link: youtubeLink,
            tzuyang_review: reviewText,
            restaurant_id: restaurantId,
        });
    }

    return reviews;
}

function isInputCurrentStep(value: unknown): value is 1 | 2 | 3 | undefined {
    return value === undefined || value === 1 || value === 2 || value === 3;
}

function isStoredCurrentStep(value: unknown): value is 1 | 2 | 3 | null {
    return value === null || value === 1 || value === 2 || value === 3;
}

function isInputRequestKind(value: unknown): value is 'edit' | 'closure' | undefined {
    return value === undefined || value === 'edit' || value === 'closure';
}

function isStoredRequestKind(value: unknown): value is 'edit' | 'closure' | null {
    return value === null || value === 'edit' || value === 'closure';
}

function isWithinRecordByteLimit(value: PersistedEditRequestDraft): boolean {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_RECORD_BYTES;
    } catch {
        return false;
    }
}

function hasOnlyPrivacySafeText(draft: Omit<PersistedEditRequestDraft, 'phone'>): boolean {
    try {
        // Phone is validated separately as an explicit restaurant business-contact field.
        assertPrivacySafe(draft);
        return true;
    } catch {
        return false;
    }
}

function readDraft(value: unknown, allowStoredFields: boolean, now = Date.now()): PersistedEditRequestDraft | null {
    const record = readPlainDataRecord(value, allowStoredFields ? STORED_DRAFT_FIELDS : DRAFT_FIELDS);
    if (!record) return null;

    const userId = record.userId;
    const restaurantId = record.restaurantId;
    const currentStep = record.currentStep;
    const requestKind = record.requestKind;
    const normalizedRequestKind = requestKind === 'edit' || requestKind === 'closure'
        ? requestKind
        : null;
    const name = normalizeText(record.name, MAX_NAME_LENGTH);
    const address = normalizeText(record.address, MAX_ADDRESS_LENGTH);
    const phone = normalizeBusinessPhone(record.phone);
    const category = normalizeStringArray(record.category, MAX_CATEGORY_COUNT, MAX_CATEGORY_LENGTH);
    const youtubeReviews = normalizeYoutubeReviews(record.youtube_reviews);

    const currentStepIsValid = allowStoredFields
        ? isStoredCurrentStep(currentStep)
        : isInputCurrentStep(currentStep);
    const requestKindIsValid = allowStoredFields
        ? isStoredRequestKind(requestKind)
        : isInputRequestKind(requestKind);
    const normalizedCurrentStep = currentStep === 1 || currentStep === 2 || currentStep === 3
        ? currentStep
        : null;
    if (!isBoundedIdentifier(userId)
        || !isBoundedIdentifier(restaurantId)
        || !currentStepIsValid
        || !requestKindIsValid
        || name === null
        || address === null
        || phone === null
        || category === null
        || youtubeReviews === null) {
        return null;
    }

    const savedAt = allowStoredFields ? normalizeText(record.savedAt, 32) : new Date(now).toISOString();
    const savedAtMs = savedAt ? Date.parse(savedAt) : Number.NaN;
    const expiresAt = allowStoredFields ? record.expiresAt : now + DRAFT_TTL_MS;
    if (savedAt === null
        || !Number.isFinite(savedAtMs)
        || typeof expiresAt !== 'number'
        || !Number.isSafeInteger(expiresAt)
        || expiresAt !== savedAtMs + DRAFT_TTL_MS
        || savedAtMs > now + 5 * 60 * 1000
        || (allowStoredFields && expiresAt <= now)) {
        return null;
    }

    const draft: PersistedEditRequestDraft = {
        userId,
        restaurantId,
        currentStep: normalizedCurrentStep,
        requestKind: normalizedRequestKind,
        name,
        address,
        phone,
        category,
        youtube_reviews: youtubeReviews,
        savedAt,
        expiresAt,
    };

    const { phone: _phone, ...privacySafeFields } = draft;
    return hasOnlyPrivacySafeText(privacySafeFields) && isWithinRecordByteLimit(draft) ? draft : null;
}

function getDraftKey(userId: string, restaurantId: string): [string, string] {
    return [userId, restaurantId];
}

function toPublicDraft(draft: PersistedEditRequestDraft): EditRequestDraft {
    const publicDraft: EditRequestDraft = {
        userId: draft.userId,
        restaurantId: draft.restaurantId,
        name: draft.name,
        address: draft.address,
        phone: draft.phone,
        category: [...draft.category],
        youtube_reviews: draft.youtube_reviews.map((review) => ({
            youtube_link: review.youtube_link,
            tzuyang_review: review.tzuyang_review,
            restaurant_id: review.restaurant_id,
        })),
        savedAt: draft.savedAt,
    };
    if (draft.currentStep !== null) publicDraft.currentStep = draft.currentStep;
    if (draft.requestKind !== null) publicDraft.requestKind = draft.requestKind;
    return publicDraft;
}

async function sweepExpiredDrafts(db: IDBPDatabase<EditRequestDraftDB>): Promise<void> {
    const now = Date.now();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const expiryIndex = tx.store.index('by-expires-at');
    let expiredCursor = await expiryIndex.openCursor(IDBKeyRange.upperBound(now));
    let processed = 0;

    while (expiredCursor && processed < MAX_SWEEP_RECORDS) {
        await expiredCursor.delete();
        processed += 1;
        expiredCursor = await expiredCursor.continue();
    }
    await tx.done;

    const invalidTx = db.transaction(STORE_NAME, 'readwrite');
    let invalidCursor = await invalidTx.store.openCursor();
    processed = 0;
    while (invalidCursor && processed < MAX_SWEEP_RECORDS) {
        if (!readDraft(invalidCursor.value, true, now)) await invalidCursor.delete();
        processed += 1;
        invalidCursor = await invalidCursor.continue();
    }
    await invalidTx.done;
}

async function enforceUserDraftLimit(
    store: IDBPObjectStore<EditRequestDraftDB, ['edit-request-drafts'], 'edit-request-drafts', 'readwrite'>,
    userId: string,
): Promise<void> {
    const index = store.index('by-user-saved-at');
    const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
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

async function initDB(): Promise<IDBPDatabase<EditRequestDraftDB>> {
    const db = await openDB<EditRequestDraftDB>(DB_NAME, DB_VERSION, {
        upgrade(database, oldVersion) {
            if (oldVersion < DB_VERSION && database.objectStoreNames.contains(STORE_NAME)) {
                database.deleteObjectStore(STORE_NAME);
            }

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, {
                    keyPath: ['userId', 'restaurantId'],
                });
                store.createIndex('by-user', 'userId');
                store.createIndex('by-user-saved-at', ['userId', 'savedAt']);
                store.createIndex('by-expires-at', 'expiresAt');
            }
        },
    });

    await sweepExpiredDrafts(db);
    return db;
}

export async function saveDraft(draft: Omit<EditRequestDraft, 'savedAt'>): Promise<void> {
    const normalizedDraft = readDraft(draft, false);
    if (!normalizedDraft) throw new Error(PRIVACY_UNSAFE_VALUE_REASON);

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        await transaction.store.put(normalizedDraft);
        await enforceUserDraftLimit(transaction.store, normalizedDraft.userId);
        await transaction.done;
    } catch (error) {
        if (error instanceof PrivacyUnsafeValueError) throw new Error(PRIVACY_UNSAFE_VALUE_REASON);
        throw new Error('임시 저장에 실패했습니다.');
    }
}

export async function getDraft(userId: string, restaurantId: string): Promise<EditRequestDraft | null> {
    if (!isBoundedIdentifier(userId) || !isBoundedIdentifier(restaurantId)) return null;

    try {
        const db = await initDB();
        const key = getDraftKey(userId, restaurantId);
        const stored = await db.get(STORE_NAME, key);
        const draft = readDraft(stored, true);
        if (!draft || draft.userId !== userId || draft.restaurantId !== restaurantId) {
            if (stored) await db.delete(STORE_NAME, key);
            return null;
        }
        return toPublicDraft(draft);
    } catch {
        return null;
    }
}

export async function hasDraft(userId: string, restaurantId: string): Promise<boolean> {
    return (await getDraft(userId, restaurantId)) !== null;
}

export async function deleteDraft(userId: string, restaurantId: string): Promise<void> {
    if (!isBoundedIdentifier(userId) || !isBoundedIdentifier(restaurantId)) return;

    try {
        const db = await initDB();
        await db.delete(STORE_NAME, getDraftKey(userId, restaurantId));
    } catch {
        throw new Error('임시 저장 데이터 삭제에 실패했습니다.');
    }
}

export async function deleteAllDraftsByUser(userId: string): Promise<boolean> {
    if (!isBoundedIdentifier(userId)) return false;

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const index = transaction.store.index('by-user');
        let cursor = await index.openCursor(userId);
        let deletedRows = 0;
        while (cursor && deletedRows < MAX_SWEEP_RECORDS) {
            await cursor.delete();
            deletedRows += 1;
            cursor = await cursor.continue();
        }

        const remainingDrafts = readNonNegativeSafeInteger(await index.count(userId));
        await transaction.done;
        return remainingDrafts === 0;
    } catch {
        return false;
    }
}

export async function getAllDraftsByUser(userId: string): Promise<EditRequestDraft[]> {
    if (!isBoundedIdentifier(userId)) return [];

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const index = transaction.store.index('by-user-saved-at');
        const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
        const drafts: EditRequestDraft[] = [];
        let cursor = await index.openCursor(range);
        let processed = 0;
        const now = Date.now();

        while (cursor && processed < MAX_DRAFTS_PER_USER) {
            const draft = readDraft(cursor.value, true, now);
            if (!draft || draft.userId !== userId) {
                await cursor.delete();
            } else {
                drafts.push(toPublicDraft(draft));
            }
            processed += 1;
            cursor = await cursor.continue();
        }

        await transaction.done;
        return drafts;
    } catch {
        return [];
    }
}

export async function cleanupOldDrafts(): Promise<void> {
    try {
        const db = await initDB();
        await sweepExpiredDrafts(db);
    } catch {
        // Cleanup is best effort and never exposes stored values.
    }
}
