import 'server-only';
import * as crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
    downloadReviewVerification,
    REVIEW_VERIFICATION_BUCKET,
    LEGACY_REVIEW_VERIFICATION_BUCKET,
} from '@/lib/reviews/private-verification';
import { canDiscardReceiptReplacement } from '@/lib/ocr/receipt-replacement-reconciliation';
import { createAdminVerificationCleanupDependencies, drainAdminVerificationCleanup, uploadStagedAdminVerificationImage } from '@/lib/reviews/admin-verification-cleanup';
import { buildReviewPhotoObjectPath, getOwnedReviewPhotoObjectPath } from '@/lib/review-photo-url';

import {
    PRIVACY_UNSAFE_VALUE_REASON,
    PrivacyUnsafeValueError,
    assertPrivacySafe,
} from '@/lib/privacy/sanitize';
import {
    GUARDED_MUTATION_CONFIRMATION,
    getGuardedMutationErrorName,
} from '@/lib/admin/guarded-mutation-contract';
import {
    AdminReceiptImageSecurityError,
    canonicalizeReceiptImage,
    downloadPrivateReceiptObject,
} from '@/lib/ocr/admin-receipt-image-security';
import { callGeminiReceiptOcr, getGeminiOcrInferenceConfigSnapshot } from '@/lib/ocr/gemini';
import { parseReceiptOcrWorkflowPolicy, type ReceiptOcrWorkflowPolicy } from '@/lib/ocr/workflow-policy';
import { getOcrModelPolicy, resolveOcrAiRuntimeConfig } from '@/lib/ocr/runtime-config';
import { getRunnableCredentials } from '@/lib/ocr/route-helpers';
import { buildReceiptOcrEnvelope, RECEIPT_OCR_NORMALIZATION_VERSION } from '@/lib/ocr/receipt-normalization';
import {
    DurableReceiptOcrPendingError,
    DurableReceiptOcrPersistenceError,
    buildDurableReceiptOcrPayload,
    buildOcrInputContextHash,
    createSupabaseDurableReceiptOcrStore,
    executeDurableReceiptOcr,
    getReviewReceiptOcrGeneration,
    hasDurableOcrReviewResult,
    publishReviewReceiptOcrResult,
} from '@/lib/ocr/durable-result';
import type { ReceiptOcrData } from '@/lib/ocr/types';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseStorageServerClient } from '@/lib/supabase/storage-server';
import { FEATURE_DATABASE_HELD_CODE, FEATURE_DATABASE_HELD_MESSAGE } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';


const MAX_RECEIPT_TEXT_LENGTH = 120;
const MAX_RECEIPT_ITEMS = 30;
const MAX_RECEIPT_AMOUNT = 10_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const PHONE_LIKE_PATTERN = /(?:\+?82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}|0[2-6][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const RECEIPT_SCHEMA_VERSION = 'receipt_summary_v1';
const ADMIN_OCR_PROMPT_VERSION = 'admin-receipt-summary-v1';
const ADMIN_OCR_PREPROCESS_VERSION = 'admin-canonical-jpeg-v2';
const SAFE_OCR_FAILURE_CODES = new Set([
    'not_receipt',
    'unreadable',
    'low_quality',
    'low_confidence',
    'ocr_failed',
]);
const OCR_ERROR_MESSAGES = {
    INVALID_REQUEST: 'OCR 요청 정보를 확인할 수 없습니다.',
    OCR_PROCESSING_FAILED: 'OCR 처리에 실패했습니다.',
    OCR_PROVIDER_UNAVAILABLE: 'OCR 제공자를 사용할 수 없습니다.',
    OCR_READBACK_FAILED: 'OCR 처리 결과를 확인하지 못했습니다.',
    PRIVACY_UNSAFE_VALUE: '민감정보가 포함된 OCR 결과는 저장할 수 없습니다.',
    RECEIPT_NOT_FOUND: '영수증 사진이 없는 리뷰입니다.',
    REVIEW_NOT_FOUND: '리뷰를 찾을 수 없습니다.',
} as const;

type OcrErrorCode = keyof typeof OCR_ERROR_MESSAGES;
type ReceiptItem = {
    name: string;
    price: number | null;
};
type ReceiptPersistenceData = {
    schema_version: typeof RECEIPT_SCHEMA_VERSION;
    status: 'processed';
    store_name?: string;
    date?: string;
    time?: string;
    total_amount?: number;
    category?: string;
    items?: ReceiptItem[];
    item_count: number;
    confidence?: number;
    duplicate_of?: string;
};
type ReceiptFailureData = {
    schema_version: typeof RECEIPT_SCHEMA_VERSION;
    status: 'failed';
    failure_code: string;
};
type OcrReviewUpdate = {
    receipt_hash: string | null;
    receipt_data: ReceiptPersistenceData | ReceiptFailureData;
    is_duplicate: boolean;
    ocr_processed_at: string;
};

class OcrPersistenceError extends Error {}
class OcrUnsafeReceiptValueError extends Error {}
class OcrProviderUnavailableError extends Error {}

const OCR_PROMPT = `한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

## 핵심 지침

### 1. 가게명 추출 (가장 중요!)
- 배달앱(쿠팡이츠, 배달의민족, 요기요 등) 영수증은 "주문매장", "가맹점", "상호" 필드를 우선 참조하세요.
- 일반 영수증은 상단 로고/상호명 영역에서 추출하세요.

### 2. 메뉴 항목 완전 추출
- 모든 주문 항목을 items 배열에 이름과 가격으로 포함하세요.
- 옵션, 변경사항, 이벤트와 0원 서비스 항목도 포함하세요.

### 3. 금액 및 시간 추출
- 총결제금액, 합계, 결제금액 필드를 우선 참조하세요.
- date는 YYYY-MM-DD, time은 HH:MM 형식으로 반환하세요.

## 응답 형식 (JSON만 반환)
성공 시: { "store_name": "가게명", "date": "YYYY-MM-DD", "time": "HH:MM", "total_amount": 0, "items": [{ "name": "메뉴명", "price": 0 }], "confidence": 0.0 }
실패 시: { "error": "not_receipt / unreadable / low_quality", "confidence": 0.0 }`;

function getSupabaseAdmin() {
    return createSupabaseServiceRoleClient();
}

function getSupabaseStorageAdmin() {
    return createSupabaseStorageServerClient();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function errorResponse(code: OcrErrorCode, status: number) {
    return noStoreJson(
        { code, error: OCR_ERROR_MESSAGES[code] },
        { status },
    );
}

function buildInlineOcrGuardedMutation(
    correlationId: string,
    readback: Record<string, unknown>,
) {
    return {
        domain: 'ocr_receipt',
        action: 'inline_process',
        confirmation: GUARDED_MUTATION_CONFIRMATION,
        readback,
        audit: {
            source: 'local-inline-ocr-process',
            correlationId,
        },
    };
}

function getSafeOcrFailureCode(value: unknown): string {
    return typeof value === 'string' && SAFE_OCR_FAILURE_CODES.has(value)
        ? value
        : 'ocr_failed';
}

function normalizeReceiptText(value: unknown, maxLength = MAX_RECEIPT_TEXT_LENGTH): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new OcrUnsafeReceiptValueError();

    const normalized = value
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized.length > maxLength || PHONE_LIKE_PATTERN.test(normalized)) {
        throw new OcrUnsafeReceiptValueError();
    }
    return normalized;
}

function normalizeReceiptAmount(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_RECEIPT_AMOUNT) {
        throw new OcrUnsafeReceiptValueError();
    }
    return value;
}

function normalizeReceiptItems(value: unknown): ReceiptItem[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > MAX_RECEIPT_ITEMS) {
        throw new OcrUnsafeReceiptValueError();
    }

    return value.map((item) => {
        if (!isRecord(item)) throw new OcrUnsafeReceiptValueError();
        const name = normalizeReceiptText(item.name);
        const price = item.price === null ? null : normalizeReceiptAmount(item.price);
        if (!name || price === undefined) {
            throw new OcrUnsafeReceiptValueError();
        }
        return { name, price };
    });
}

function normalizeReceiptConfidence(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new OcrUnsafeReceiptValueError();
    }
    return Math.round(value * 100) / 100;
}

function buildReceiptPersistenceData(ocrData: ReceiptOcrData): ReceiptPersistenceData {
    const storeName = normalizeReceiptText(ocrData.store_name);
    const date = normalizeReceiptText(ocrData.date, 10);
    const time = normalizeReceiptText(ocrData.time, 5);
    const totalAmount = normalizeReceiptAmount(ocrData.total_amount);
    const category = normalizeReceiptText(ocrData.category, 32);
    const items = normalizeReceiptItems(ocrData.items);
    const confidence = normalizeReceiptConfidence(ocrData.confidence);

    if ((date && !DATE_PATTERN.test(date)) || (time && !TIME_PATTERN.test(time))) {
        throw new OcrUnsafeReceiptValueError();
    }

    const receiptData: ReceiptPersistenceData = {
        schema_version: RECEIPT_SCHEMA_VERSION,
        status: 'processed',
        item_count: items?.length ?? 0,
    };
    if (storeName) receiptData.store_name = storeName;
    if (date) receiptData.date = date;
    if (time) receiptData.time = time;
    if (totalAmount !== undefined) receiptData.total_amount = totalAmount;
    if (category) receiptData.category = category;
    if (items?.length) receiptData.items = items;
    if (confidence !== undefined) receiptData.confidence = confidence;

    assertPrivacySafe(receiptData);
    return receiptData;
}

function buildReceiptFailureData(errorCode: string): ReceiptFailureData {
    const receiptData: ReceiptFailureData = {
        schema_version: RECEIPT_SCHEMA_VERSION,
        status: 'failed',
        failure_code: errorCode,
    };
    assertPrivacySafe(receiptData);
    return receiptData;
}

function assertOcrInputSafe(ocrData: ReceiptOcrData): void {
    assertPrivacySafe({
        store_name: ocrData.store_name,
        date: ocrData.date,
        time: ocrData.time,
        total_amount: ocrData.total_amount,
        category: ocrData.category,
        review_draft: ocrData.review_draft,
        items: ocrData.items,
        confidence: ocrData.confidence,
    });
}

function generateReceiptHash(data: ReceiptPersistenceData): string {
    const hashInput = `${data.store_name}|${data.date}|${data.time}|${data.total_amount}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
}

function hasExpectedReceiptData(
    value: unknown,
    expected: ReceiptPersistenceData | ReceiptFailureData,
): boolean {
    if (!isRecord(value)) return false;
    assertPrivacySafe(value);

    const expectedEntries = Object.entries(expected);
    const actualKeys = Object.keys(value);
    return actualKeys.length === expectedEntries.length
        && expectedEntries.every(
            ([key, expectedValue]) => Object.prototype.hasOwnProperty.call(value, key)
                && JSON.stringify(value[key]) === JSON.stringify(expectedValue),
        );
}

function hasExpectedReviewReadback(
    value: unknown,
    reviewId: string,
    expected: OcrReviewUpdate,
): boolean {
    return isRecord(value)
        && value.id === reviewId
        && value.receipt_hash === expected.receipt_hash
        && value.is_duplicate === expected.is_duplicate
        && typeof value.ocr_processed_at === 'string'
        && Number.isFinite(Date.parse(value.ocr_processed_at))
        && hasExpectedReceiptData(value.receipt_data, expected.receipt_data);
}

async function persistOcrResult(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    reviewId: string,
    userId: string,
    generation: string,
    resultRef: string,
    resultRevision: string,
    update: OcrReviewUpdate,
): Promise<void> {
    assertPrivacySafe(update);
    const readback = await publishReviewReceiptOcrResult(supabase as never, {
        userId,
        reviewId,
        generation,
        resultRef,
        resultRevision,
        receiptHash: update.receipt_hash,
        receiptData: update.receipt_data,
        isDuplicate: update.is_duplicate,
    });
    if (!hasExpectedReviewReadback(readback, reviewId, update)) {
        throw new OcrPersistenceError();
    }
}

function assertSafeReceiptObjectPath(value: unknown): asserts value is string {
    if (
        typeof value !== 'string'
        || value.length === 0
        || value.length > 1_024
        || value.startsWith('/')
        || value.includes('\\')
        || value.includes('\u0000')
        || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
        throw new OcrPersistenceError();
    }
}

function buildReplacementReceiptObjectPath(oldObjectPath: string, reviewId: string): string {
    const ownerId = oldObjectPath.split('/')[0];
    const newObjectPath = buildReviewPhotoObjectPath({ ownerId, reviewId, purpose: 'verification' }, `ocr-${crypto.randomUUID()}.jpg`);
    if (!newObjectPath) throw new OcrPersistenceError();
    assertSafeReceiptObjectPath(newObjectPath);
    return newObjectPath;
}

function hasExpectedReplacementReadback(
    value: unknown,
    reviewId: string,
    expectedObjectPath: string,
): boolean {
    return isRecord(value)
        && value.id === reviewId
        && value.verification_photo === expectedObjectPath;
}

async function replaceReceiptWithCompressedObject(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    storageAdmin: ReturnType<typeof getSupabaseStorageAdmin>,
    reviewId: string,
    oldStoredValue: string,
    oldObjectPath: string,
    canonicalImage: Buffer,
): Promise<string> {
    const newObjectPath = buildReplacementReceiptObjectPath(oldObjectPath, reviewId);
    const storage = storageAdmin.from(REVIEW_VERIFICATION_BUCKET);
    const cleanup = createAdminVerificationCleanupDependencies(supabase, storageAdmin);
    let databaseUpdated = false;
    let replacementRemoved = false;
    let replacementStateIndeterminate = false;
    let uploadConfirmed = false;

    try {
        const accepted = await uploadStagedAdminVerificationImage(cleanup, reviewId, oldObjectPath.split('/')[0], newObjectPath, () => storage.upload(newObjectPath, canonicalImage, {
            cacheControl: '3600',
            contentType: 'image/jpeg',
            upsert: false,
        }));
        if (!accepted) {
            replacementStateIndeterminate = true;
            throw new OcrPersistenceError();
        }
        uploadConfirmed = true;

        const uploadedImage = await downloadPrivateReceiptObject(() => storage.download(newObjectPath));
        if (
            uploadedImage.mimeType !== 'image/jpeg'
            || uploadedImage.bytes.byteLength !== canonicalImage.byteLength
            || !uploadedImage.bytes.equals(canonicalImage)
        ) {
            throw new OcrPersistenceError();
        }

        // SQL integration dependency: the authoritative review-media UPDATE
        // trigger must enqueue the old normalized key in the same transaction
        // that replaces this reference. A transport error is never rollback
        // proof, even when a following read still observes the old value.
        let definiteNoMatch = false;
        try {
            const { data: updateReadback, error: updateError } = await supabase
                .from('reviews')
                .update({ verification_photo: newObjectPath })
                .eq('id', reviewId)
                .eq('verification_photo', oldStoredValue)
                .select('id, verification_photo')
                .maybeSingle();
            if (!updateError && hasExpectedReplacementReadback(updateReadback, reviewId, newObjectPath)) {
                databaseUpdated = true;
            } else if (!updateError && updateReadback === null) {
                definiteNoMatch = true;
            }
        } catch { /* authoritative readback below */ }

        if (!databaseUpdated) {
            const { data: currentReadback, error: currentReadbackError } = await supabase
                .from('reviews')
                .select('id, verification_photo')
                .eq('id', reviewId)
                .maybeSingle();

            if (!currentReadbackError && hasExpectedReplacementReadback(currentReadback, reviewId, newObjectPath)) {
                databaseUpdated = true;
            } else if (canDiscardReceiptReplacement(
                definiteNoMatch, Boolean(currentReadbackError), currentReadback, reviewId, newObjectPath,
            )) {
                if (!(await drainAdminVerificationCleanup(cleanup, reviewId, oldObjectPath.split('/')[0]))) {
                    throw new OcrPersistenceError();
                }
                replacementRemoved = true;
            } else {
                replacementStateIndeterminate = true;
            }
            if (!databaseUpdated) throw new OcrPersistenceError();
        }

        // The authoritative review-media UPDATE enqueues the original. Only
        // its durable retirement fence may remove it after all references end.
        // A privileged direct removal here would break another legacy review.
        return newObjectPath;
    } catch {
        if (
            uploadConfirmed
            && !databaseUpdated
            && !replacementRemoved
            && !replacementStateIndeterminate
            && !(await drainAdminVerificationCleanup(cleanup, reviewId, oldObjectPath.split('/')[0]))
        ) {
            throw new OcrPersistenceError();
        }
        throw new OcrPersistenceError();
    }
}

export async function processAdminReceiptOcr(input: {
    reviewId: string;
    signal?: AbortSignal;
    policy?: ReceiptOcrWorkflowPolicy;
}): Promise<Response> {
    if (!UUID_PATTERN.test(input.reviewId)) return errorResponse('INVALID_REQUEST', 400);
    const explicitPolicy = input.policy
        ? parseReceiptOcrWorkflowPolicy(JSON.stringify(input.policy.modelPolicy), input.policy.inferenceConfig.thinkingLevel)
        : undefined;
    const body = { reviewId: input.reviewId };
    const correlationId = `ocr-inline-${crypto.randomUUID()}`;

    const supabase = getSupabaseAdmin();
    const storageAdmin = getSupabaseStorageAdmin();

    try {
        const { data: review, error: fetchError } = await supabase
            .from('reviews')
            .select('id, user_id, verification_photo, receipt_hash, receipt_data, is_duplicate, ocr_processed_at')
            .eq('id', body.reviewId)
            .single();

        if (fetchError || !review) return errorResponse('REVIEW_NOT_FOUND', 404);
        if ((await readFeatureDatabaseReadiness({ ownerId: review.user_id })).status !== 'ready') {
            return noStoreJson(
                { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
                { status: 409 },
            );
        }
        if (!review.verification_photo) return errorResponse('RECEIPT_NOT_FOUND', 400);
        if (hasDurableOcrReviewResult(review)) {
            return NextResponse.json({
                success: true,
                isDuplicate: review.is_duplicate === true,
                message: '기존 OCR 결과를 유지했습니다.',
                guardedMutation: buildInlineOcrGuardedMutation(correlationId, {
                    reviewId: body.reviewId,
                    applied: false,
                    readbackVerified: true,
                    status: 'preserved',
                }),
            }, { headers: { 'Cache-Control': 'no-store' } });
        }
        const receiptObjectPath = getOwnedReviewPhotoObjectPath(review.verification_photo, {
            ownerId: review.user_id,
            reviewId: body.reviewId,
            purpose: 'verification',
        });
        if (!receiptObjectPath) return errorResponse('RECEIPT_NOT_FOUND', 400);
        assertSafeReceiptObjectPath(receiptObjectPath);

        const cleanup = createAdminVerificationCleanupDependencies(supabase, storageAdmin);
        // Reconcile prior committed replacements before another download/provider
        // call. An absent migration or pending public object fails closed.
        if (!await drainAdminVerificationCleanup(cleanup, body.reviewId, review.user_id)) throw new OcrPersistenceError();

        const receiptDownload = await downloadReviewVerification(storageAdmin, receiptObjectPath);
        const downloadedImage = await downloadPrivateReceiptObject(() => Promise.resolve(receiptDownload));
        const canonicalStorageImage = await canonicalizeReceiptImage(
            downloadedImage.bytes,
            downloadedImage.mimeType,
        );
        if (receiptDownload.bucket === LEGACY_REVIEW_VERIFICATION_BUCKET
            || canonicalStorageImage.bytes.byteLength < downloadedImage.bytes.byteLength) {
            await replaceReceiptWithCompressedObject(
                supabase,
                storageAdmin,
                body.reviewId,
                review.verification_photo,
                receiptObjectPath,
                canonicalStorageImage.bytes,
            );
            if (!await drainAdminVerificationCleanup(cleanup, body.reviewId, review.user_id)) throw new OcrPersistenceError();
        }

        const imageHash = crypto.createHash('sha256').update(canonicalStorageImage.bytes).digest('hex');
        const aiRuntime = await resolveOcrAiRuntimeConfig();
        const modelPolicy = explicitPolicy?.modelPolicy ?? getOcrModelPolicy(aiRuntime);
        const inferenceConfig = explicitPolicy?.inferenceConfig ?? getGeminiOcrInferenceConfigSnapshot();
        const generation = await getReviewReceiptOcrGeneration(
            supabase as never,
            review.user_id,
            body.reviewId,
        );
        const credentials = getRunnableCredentials({ candidate: aiRuntime, routingMode: aiRuntime.routingMode });
        const durable = await executeDurableReceiptOcr({
            store: createSupabaseDurableReceiptOcrStore(supabase as never),
            binding: {
                userId: review.user_id,
                imageHash,
                inputContextHash: buildOcrInputContextHash(imageHash, null, inferenceConfig),
                provider: 'gemini',
                modelPolicy,
                generation,
                promptVersion: ADMIN_OCR_PROMPT_VERSION,
                preprocessVersion: ADMIN_OCR_PREPROCESS_VERSION,
                normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
            },
            operationId: crypto.randomUUID(),
            forceRefresh: false,
            beforeProvider: async () => {
                if (!credentials[0]) throw new OcrProviderUnavailableError();
            },
            runProvider: async () => {
                const ocrResult = await callGeminiReceiptOcr({
                    apiKey: credentials[0]!.apiKey,
                    imageBase64: canonicalStorageImage.bytes.toString('base64'),
                    mimeType: 'image/jpeg',
                    prompt: OCR_PROMPT,
                    env: { ...process.env, GEMINI_OCR_MODEL: modelPolicy.join(',') },
                    inferenceConfig,
                    signal: input.signal,
                });
                const envelope = buildReceiptOcrEnvelope({
                    provider: 'gemini',
                    model: ocrResult.model,
                    attempts: ocrResult.attempts,
                    data: ocrResult.data,
                });
                const payload = buildDurableReceiptOcrPayload({ provider: 'gemini', model: ocrResult.model, envelope });
                assertPrivacySafe(payload);
                return payload;
            },
        });
        const ocrData: ReceiptOcrData = {
            ...durable.payload.normalized,
            ...(durable.payload.failure_code ? { error: durable.payload.failure_code } : {}),
        };

        assertOcrInputSafe(ocrData);
        const receiptData = buildReceiptPersistenceData(ocrData);
        const confidence = receiptData.confidence ?? 0;

        if (ocrData.error || confidence < 0.5) {
            const failureData = buildReceiptFailureData(
                ocrData.error ? getSafeOcrFailureCode(ocrData.error) : 'low_confidence',
            );
            await persistOcrResult(
                supabase,
                body.reviewId,
                review.user_id,
                generation,
                durable.resultRef,
                durable.resultRevision,
                {
                    receipt_hash: null,
                    receipt_data: failureData,
                    is_duplicate: false,
                    ocr_processed_at: new Date().toISOString(),
                },
            );

            return NextResponse.json(
                {
                    success: false,
                    code: failureData.failure_code,
                    message: 'OCR 처리 실패',
                    guardedMutation: buildInlineOcrGuardedMutation(correlationId, {
                        reviewId: body.reviewId,
                        applied: true,
                        readbackVerified: true,
                        status: 'failed',
                    }),
                },
                { headers: { 'Cache-Control': 'no-store' } },
            );
        }

        const hasHashInputs = receiptData.store_name
            && receiptData.date
            && receiptData.time
            && receiptData.total_amount !== undefined;
        const receiptHash = hasHashInputs ? generateReceiptHash(receiptData) : null;
        let duplicateOfId: string | null = null;

        if (receiptHash) {
            const { data: existingReviews, error: duplicateLookupError } = await supabase
                .from('reviews')
                .select('id')
                .eq('receipt_hash', receiptHash)
                .neq('id', body.reviewId)
                .limit(1);
            if (duplicateLookupError) throw new OcrPersistenceError();

            const candidateId = existingReviews?.[0]?.id;
            if (candidateId !== undefined) {
                if (typeof candidateId !== 'string' || !UUID_PATTERN.test(candidateId)) {
                    throw new OcrPersistenceError();
                }
                duplicateOfId = candidateId;
            }
        }

        if (duplicateOfId) receiptData.duplicate_of = duplicateOfId;
        assertPrivacySafe(receiptData);

        await persistOcrResult(
            supabase,
            body.reviewId,
            review.user_id,
            generation,
            durable.resultRef,
            durable.resultRevision,
            {
                receipt_hash: duplicateOfId ? null : receiptHash,
                receipt_data: receiptData,
                is_duplicate: Boolean(duplicateOfId),
                ocr_processed_at: new Date().toISOString(),
            },
        );

        return NextResponse.json(
            {
                success: true,
                isDuplicate: Boolean(duplicateOfId),
                message: duplicateOfId ? 'OCR 처리 완료 (중복 의심)' : 'OCR 처리 완료',
                guardedMutation: buildInlineOcrGuardedMutation(correlationId, {
                    reviewId: body.reviewId,
                    applied: true,
                    readbackVerified: true,
                    status: 'processed',
                    isDuplicate: Boolean(duplicateOfId),
                }),
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        console.error('[admin/ocr-receipts/process] inline process failed', {
            domain: 'ocr_receipt',
            action: 'inline_process',
            step: 'unexpected',
            correlationId,
            errorName: getGuardedMutationErrorName(error),
        });
        if (error instanceof PrivacyUnsafeValueError || error instanceof OcrUnsafeReceiptValueError) {
            return errorResponse(PRIVACY_UNSAFE_VALUE_REASON, 422);
        }
        if (error instanceof OcrProviderUnavailableError) {
            return errorResponse('OCR_PROVIDER_UNAVAILABLE', 503);
        }
        if (error instanceof AdminReceiptImageSecurityError
            || error instanceof OcrPersistenceError
            || error instanceof DurableReceiptOcrPersistenceError
            || error instanceof DurableReceiptOcrPendingError) {
            return errorResponse('OCR_READBACK_FAILED', 503);
        }
        return errorResponse('OCR_PROCESSING_FAILED', 500);
    }
}
