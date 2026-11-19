import { createBoundedDraftStore } from '@/lib/drafts/bounded-draft-store';
import {
    isBoundedIdentifier,
    isWithinRecordBytes,
    normalizeDraftPhone,
    normalizeStringArray,
    normalizeText,
    readDraftLifetime,
    readOptionalChoice,
    readPlainDataArray,
    readPlainDataRecord,
} from '@/lib/drafts/draft-fields';
import { draftStorageOwnerKey, draftPublicOwnerId } from '@/lib/privacy/draft-storage-owner';
import { MAX_EDIT_SUBMISSION_BYTES } from '@/lib/restaurant-edit-submit-contract';
import { PRIVACY_UNSAFE_VALUE_REASON, assertPrivacySafe } from '@/lib/privacy/sanitize';

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

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Valid submit payloads also need room for owner, step and expiry metadata.
const MAX_RECORD_BYTES = MAX_EDIT_SUBMISSION_BYTES + 1024;
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MAX_PHONE_LENGTH = 40;
const MAX_CATEGORY_COUNT = 10;
const MAX_CATEGORY_LENGTH = 64;
const MAX_REVIEW_COUNT = 100;
const MAX_LINK_LENGTH = 2_048;
const MAX_REVIEW_TEXT_LENGTH = 4_000;
const DRAFT_STEPS = [1, 2, 3] as const;
const REQUEST_KINDS = ['edit', 'closure'] as const;

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

function hasOnlyPrivacySafeText(draft: Omit<PersistedEditRequestDraft, 'phone'>): boolean {
    try {
        // Phone is validated separately as an explicit restaurant business-contact field.
        // Match submit's bounded groups without relaxing the sanitizer's limits.
        const { youtube_reviews: reviews, ...metadata } = draft;
        assertPrivacySafe(metadata);
        for (const review of reviews) assertPrivacySafe(review);
        return true;
    } catch {
        return false;
    }
}

function readDraft(value: unknown, allowStoredFields: boolean, now: number): PersistedEditRequestDraft | null {
    const record = readPlainDataRecord(value, allowStoredFields ? STORED_DRAFT_FIELDS : DRAFT_FIELDS);
    if (!record) return null;

    const userId = record.userId;
    const restaurantId = record.restaurantId;
    const currentStep = readOptionalChoice(record.currentStep, DRAFT_STEPS, allowStoredFields);
    const requestKind = readOptionalChoice(record.requestKind, REQUEST_KINDS, allowStoredFields);
    const name = normalizeText(record.name, MAX_NAME_LENGTH);
    const address = normalizeText(record.address, MAX_ADDRESS_LENGTH);
    const phone = normalizeDraftPhone(record.phone, MAX_PHONE_LENGTH);
    const category = normalizeStringArray(record.category, MAX_CATEGORY_COUNT, MAX_CATEGORY_LENGTH);
    const youtubeReviews = normalizeYoutubeReviews(record.youtube_reviews);

    if (!isBoundedIdentifier(userId)
        || !isBoundedIdentifier(restaurantId)
        || !currentStep.valid
        || !requestKind.valid
        || name === null
        || address === null
        || phone === null
        || category === null
        || youtubeReviews === null) {
        return null;
    }

    const lifetime = readDraftLifetime(record, allowStoredFields, now, DRAFT_TTL_MS);
    if (!lifetime) return null;

    const draft: PersistedEditRequestDraft = {
        userId: allowStoredFields ? userId : draftStorageOwnerKey(userId),
        restaurantId,
        currentStep: currentStep.value,
        requestKind: requestKind.value,
        name,
        address,
        phone,
        category,
        youtube_reviews: youtubeReviews,
        savedAt: lifetime.savedAt,
        expiresAt: lifetime.expiresAt,
    };

    const { phone: _phone, ...privacySafeFields } = draft;
    return isWithinRecordBytes(draft, MAX_RECORD_BYTES) && hasOnlyPrivacySafeText(privacySafeFields) ? draft : null;
}

function toPublicDraft(draft: PersistedEditRequestDraft): EditRequestDraft {
    const publicDraft: EditRequestDraft = {
        userId: draftPublicOwnerId(draft.userId),
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

const store = createBoundedDraftStore({
    dbName: 'tzudong-edit-request-drafts',
    dbVersion: 2,
    storeName: 'edit-request-drafts',
    slotField: 'restaurantId',
    isSlot: isBoundedIdentifier,
    maxDraftsPerUser: 20,
    sweepBatchSize: 50,
    parseInput: (draft: Omit<EditRequestDraft, 'savedAt'>, now) => readDraft(draft, false, now),
    parseStored: (value, now) => readDraft(value, true, now),
    toPublic: toPublicDraft,
    invalidInputError: PRIVACY_UNSAFE_VALUE_REASON,
    invalidRowSweep: 'restart-from-first-key',
    legacyRecovery: 'resume-after-last-key',
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

export async function saveDraft(draft: Omit<EditRequestDraft, 'savedAt'>): Promise<void> {
    await store.saveDraft(draft);
}
