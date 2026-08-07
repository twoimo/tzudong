import { openDB, DBSchema, IDBPDatabase, IDBPObjectStore } from 'idb';
import {
    PRIVACY_UNSAFE_VALUE_REASON,
    PrivacyUnsafeValueError,
    assertPrivacySafe,
} from '@/lib/privacy/sanitize';

export interface SubmissionDraft {
    userId: string;
    submissionMode: 'new' | 'request';
    currentStep?: 1 | 2 | 3;
    restaurant_name: string;
    address: string;
    phone: string;
    categories: string[];
    youtube_link: string;
    description: string;
    savedAt: string;
}

type PersistedSubmissionDraft = Omit<SubmissionDraft, 'currentStep'> & {
    currentStep: 1 | 2 | 3 | null;
    expiresAt: number;
};

interface SubmissionDraftDB extends DBSchema {
    'submission-drafts': {
        key: [string, 'new' | 'request'];
        value: PersistedSubmissionDraft;
        indexes: {
            'by-user': string;
            'by-user-saved-at': [string, string];
            'by-expires-at': number;
        };
    };
}

const DB_NAME = 'tzudong-submission-drafts';
const DB_VERSION = 2;
const STORE_NAME = 'submission-drafts';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DRAFTS_PER_USER = 2;
const MAX_SWEEP_RECORDS = 50;
const MAX_RECORD_BYTES = 8 * 1024;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MAX_PHONE_LENGTH = 32;
const MAX_CATEGORY_COUNT = 8;
const MAX_CATEGORY_LENGTH = 64;
const MAX_LINK_LENGTH = 2_048;
const MAX_DESCRIPTION_LENGTH = 2_000;

const DRAFT_FIELDS = new Set([
    'userId',
    'submissionMode',
    'currentStep',
    'restaurant_name',
    'address',
    'phone',
    'categories',
    'youtube_link',
    'description',
]);

const STORED_DRAFT_FIELDS = new Set([
    ...DRAFT_FIELDS,
    'savedAt',
    'expiresAt',
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

function isInputCurrentStep(value: unknown): value is 1 | 2 | 3 | undefined {
    return value === undefined || value === 1 || value === 2 || value === 3;
}

function isStoredCurrentStep(value: unknown): value is 1 | 2 | 3 | null {
    return value === null || value === 1 || value === 2 || value === 3;
}

function isWithinRecordByteLimit(value: PersistedSubmissionDraft): boolean {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_RECORD_BYTES;
    } catch {
        return false;
    }
}

function hasOnlyPrivacySafeText(draft: Omit<PersistedSubmissionDraft, 'phone'>): boolean {
    try {
        // Phone is validated separately as an explicit restaurant business-contact field.
        assertPrivacySafe(draft);
        return true;
    } catch {
        return false;
    }
}

function readDraft(value: unknown, allowStoredFields: boolean, now = Date.now()): PersistedSubmissionDraft | null {
    const record = readPlainDataRecord(value, allowStoredFields ? STORED_DRAFT_FIELDS : DRAFT_FIELDS);
    if (!record) return null;

    const userId = record.userId;
    const submissionMode = record.submissionMode;
    const currentStep = record.currentStep;
    const restaurantName = normalizeText(record.restaurant_name, MAX_NAME_LENGTH);
    const address = normalizeText(record.address, MAX_ADDRESS_LENGTH);
    const phone = normalizeBusinessPhone(record.phone);
    const categories = normalizeStringArray(record.categories, MAX_CATEGORY_COUNT, MAX_CATEGORY_LENGTH);
    const youtubeLink = normalizeText(record.youtube_link, MAX_LINK_LENGTH);
    const description = normalizeText(record.description, MAX_DESCRIPTION_LENGTH);

    const currentStepIsValid = allowStoredFields
        ? isStoredCurrentStep(currentStep)
        : isInputCurrentStep(currentStep);
    const normalizedCurrentStep = currentStep === 1 || currentStep === 2 || currentStep === 3
        ? currentStep
        : null;
    if (!isBoundedIdentifier(userId)
        || (submissionMode !== 'new' && submissionMode !== 'request')
        || !currentStepIsValid
        || restaurantName === null
        || address === null
        || phone === null
        || categories === null
        || youtubeLink === null
        || description === null) {
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

    const draft: PersistedSubmissionDraft = {
        userId,
        submissionMode,
        currentStep: normalizedCurrentStep,
        restaurant_name: restaurantName,
        address,
        phone,
        categories,
        youtube_link: youtubeLink,
        description,
        savedAt,
        expiresAt,
    };

    const { phone: _phone, ...privacySafeFields } = draft;
    return hasOnlyPrivacySafeText(privacySafeFields) && isWithinRecordByteLimit(draft) ? draft : null;
}

function getDraftKey(userId: string, submissionMode: 'new' | 'request'): [string, 'new' | 'request'] {
    return [userId, submissionMode];
}

function toPublicDraft(draft: PersistedSubmissionDraft): SubmissionDraft {
    const publicDraft: SubmissionDraft = {
        userId: draft.userId,
        submissionMode: draft.submissionMode,
        restaurant_name: draft.restaurant_name,
        address: draft.address,
        phone: draft.phone,
        categories: [...draft.categories],
        youtube_link: draft.youtube_link,
        description: draft.description,
        savedAt: draft.savedAt,
    };
    if (draft.currentStep !== null) publicDraft.currentStep = draft.currentStep;
    return publicDraft;
}

async function sweepExpiredDrafts(db: IDBPDatabase<SubmissionDraftDB>): Promise<void> {
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
    store: IDBPObjectStore<SubmissionDraftDB, ['submission-drafts'], 'submission-drafts', 'readwrite'>,
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

async function initDB(): Promise<IDBPDatabase<SubmissionDraftDB>> {
    const db = await openDB<SubmissionDraftDB>(DB_NAME, DB_VERSION, {
        upgrade(database, oldVersion) {
            if (oldVersion < DB_VERSION && database.objectStoreNames.contains(STORE_NAME)) {
                database.deleteObjectStore(STORE_NAME);
            }

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, {
                    keyPath: ['userId', 'submissionMode'],
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

export async function saveDraft(draft: Omit<SubmissionDraft, 'savedAt'>): Promise<void> {
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

export async function getDraft(userId: string, submissionMode: 'new' | 'request'): Promise<SubmissionDraft | null> {
    if (!isBoundedIdentifier(userId) || (submissionMode !== 'new' && submissionMode !== 'request')) return null;

    try {
        const db = await initDB();
        const key = getDraftKey(userId, submissionMode);
        const stored = await db.get(STORE_NAME, key);
        const draft = readDraft(stored, true);
        if (!draft || draft.userId !== userId || draft.submissionMode !== submissionMode) {
            if (stored) await db.delete(STORE_NAME, key);
            return null;
        }
        return toPublicDraft(draft);
    } catch {
        return null;
    }
}

export async function hasDraft(userId: string, submissionMode: 'new' | 'request'): Promise<boolean> {
    return (await getDraft(userId, submissionMode)) !== null;
}

export async function deleteDraft(userId: string, submissionMode: 'new' | 'request'): Promise<void> {
    if (!isBoundedIdentifier(userId) || (submissionMode !== 'new' && submissionMode !== 'request')) return;

    try {
        const db = await initDB();
        await db.delete(STORE_NAME, getDraftKey(userId, submissionMode));
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

export async function getAllDraftsByUser(userId: string): Promise<SubmissionDraft[]> {
    if (!isBoundedIdentifier(userId)) return [];

    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const index = transaction.store.index('by-user-saved-at');
        const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
        const drafts: SubmissionDraft[] = [];
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
