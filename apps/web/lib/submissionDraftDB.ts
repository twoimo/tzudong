import { createBoundedDraftStore } from '@/lib/drafts/bounded-draft-store';
import {
    isBoundedIdentifier,
    isWithinRecordBytes,
    normalizeDraftPhone,
    normalizeStringArray,
    normalizeText,
    readDraftLifetime,
    readOptionalChoice,
    readPlainDataRecord,
} from '@/lib/drafts/draft-fields';
import { draftStorageOwnerKey, draftPublicOwnerId } from '@/lib/privacy/draft-storage-owner';
import { PRIVACY_UNSAFE_VALUE_REASON, assertPrivacySafe } from '@/lib/privacy/sanitize';

type SubmissionMode = 'new' | 'request';

export interface SubmissionDraft {
    userId: string;
    submissionMode: SubmissionMode;
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

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORD_BYTES = 8 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MAX_PHONE_LENGTH = 32;
const MAX_CATEGORY_COUNT = 8;
const MAX_CATEGORY_LENGTH = 64;
const MAX_LINK_LENGTH = 2_048;
const MAX_DESCRIPTION_LENGTH = 2_000;
const DRAFT_STEPS = [1, 2, 3] as const;

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

function isSubmissionMode(value: unknown): value is SubmissionMode {
    return value === 'new' || value === 'request';
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

function readDraft(value: unknown, allowStoredFields: boolean, now: number): PersistedSubmissionDraft | null {
    const record = readPlainDataRecord(value, allowStoredFields ? STORED_DRAFT_FIELDS : DRAFT_FIELDS);
    if (!record) return null;

    const userId = record.userId;
    const submissionMode = record.submissionMode;
    const currentStep = readOptionalChoice(record.currentStep, DRAFT_STEPS, allowStoredFields);
    const restaurantName = normalizeText(record.restaurant_name, MAX_NAME_LENGTH);
    const address = normalizeText(record.address, MAX_ADDRESS_LENGTH);
    const phone = normalizeDraftPhone(record.phone, MAX_PHONE_LENGTH);
    const categories = normalizeStringArray(record.categories, MAX_CATEGORY_COUNT, MAX_CATEGORY_LENGTH);
    const youtubeLink = normalizeText(record.youtube_link, MAX_LINK_LENGTH);
    const description = normalizeText(record.description, MAX_DESCRIPTION_LENGTH);

    if (!isBoundedIdentifier(userId)
        || !isSubmissionMode(submissionMode)
        || !currentStep.valid
        || restaurantName === null
        || address === null
        || phone === null
        || categories === null
        || youtubeLink === null
        || description === null) {
        return null;
    }

    const lifetime = readDraftLifetime(record, allowStoredFields, now, DRAFT_TTL_MS);
    if (!lifetime) return null;

    const draft: PersistedSubmissionDraft = {
        userId: allowStoredFields ? userId : draftStorageOwnerKey(userId),
        submissionMode,
        currentStep: currentStep.value,
        restaurant_name: restaurantName,
        address,
        phone,
        categories,
        youtube_link: youtubeLink,
        description,
        savedAt: lifetime.savedAt,
        expiresAt: lifetime.expiresAt,
    };

    const { phone: _phone, ...privacySafeFields } = draft;
    return hasOnlyPrivacySafeText(privacySafeFields) && isWithinRecordBytes(draft, MAX_RECORD_BYTES) ? draft : null;
}

function toPublicDraft(draft: PersistedSubmissionDraft): SubmissionDraft {
    const publicDraft: SubmissionDraft = {
        userId: draftPublicOwnerId(draft.userId),
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

const store = createBoundedDraftStore({
    dbName: 'tzudong-submission-drafts',
    dbVersion: 2,
    storeName: 'submission-drafts',
    slotField: 'submissionMode',
    isSlot: isSubmissionMode,
    maxDraftsPerUser: 2,
    sweepBatchSize: 50,
    parseInput: (draft: Omit<SubmissionDraft, 'savedAt'>, now) => readDraft(draft, false, now),
    parseStored: (value, now) => readDraft(value, true, now),
    toPublic: toPublicDraft,
    invalidInputError: PRIVACY_UNSAFE_VALUE_REASON,
    invalidRowSweep: 'restart-from-first-key',
    legacyRecovery: 'rescan-owner-index',
    pruneOnRead: false,
    extraSweepOnSave: false,
});

export const {
    getDraft,
    hasDraft,
    deleteDraft,
    deleteAllDraftsByUser,
    getAllDraftsByUser,
    cleanupOldDrafts,
    recoverLegacyDrafts,
} = store;

export async function saveDraft(draft: Omit<SubmissionDraft, 'savedAt'>): Promise<void> {
    await store.saveDraft(draft);
}
