import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { NextResponse } from 'next/server';

import {
    PRIVACY_UNSAFE_VALUE_REASON,
    PrivacyUnsafeValueError,
    assertPrivacySafe,
} from '@/lib/privacy/sanitize';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
    GUARDED_MUTATION_CONFIRMATION,
    buildGuardedMutationRequiredResponse,
    isGuardedMutationConfirmationValid,
    isInlineOcrProcessEnabled,
    getGuardedMutationErrorName,
} from '@/lib/admin/guarded-mutation-contract';
import {
    AdminReceiptImageSecurityError,
    canonicalizeReceiptImage,
    cleanupAdminReceiptTempRun,
    createAdminReceiptTempRun,
    createPrivateReceiptTempDirectory,
    downloadPrivateReceiptObject,
    getReceiptImageMimeTypeFromSignature,
    readContainedPrivateReceiptFile,
    writeExclusivePrivateReceiptFile,
} from '@/lib/ocr/admin-receipt-image-security';
import { callGeminiReceiptOcr } from '@/lib/ocr/gemini';
import type { ReceiptOcrData } from '@/lib/ocr/types';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseStorageServerClient } from '@/lib/supabase/storage-server';

export const runtime = 'nodejs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_PREPROCESS_RESULT_BYTES = 16 * 1024;
const PREPROCESS_DEADLINE_MS = 30_000;
const MAX_RECEIPT_TEXT_LENGTH = 120;
const MAX_RECEIPT_ITEMS = 30;
const MAX_RECEIPT_AMOUNT = 10_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const PHONE_LIKE_PATTERN = /(?:\+?82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}|0[2-6][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const RECEIPT_SCHEMA_VERSION = 'receipt_summary_v1';
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
type InlineOcrProcessBody = {
    reviewId: string;
    guardedMutationConfirmation: string;
};
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

const routeDirname = path.dirname(fileURLToPath(import.meta.url));
const preprocessScriptPath = path.resolve(
    /* turbopackIgnore: true */ routeDirname,
    '../../../../../../../backend/geminiCLI-ocr-receipts/preprocess_receipt.py',
);

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

function parseInlineOcrProcessBody(value: unknown): InlineOcrProcessBody | null {
    if (!isRecord(value)) return null;

    const keys = Object.keys(value);
    if (
        keys.length !== 2
        || keys.some((key) => key !== 'reviewId' && key !== 'guardedMutationConfirmation')
        || typeof value.reviewId !== 'string'
        || typeof value.guardedMutationConfirmation !== 'string'
    ) {
        return null;
    }

    return {
        reviewId: value.reviewId.trim(),
        guardedMutationConfirmation: value.guardedMutationConfirmation,
    };
}


function hasGuardedMutationConfirmation(body: InlineOcrProcessBody): boolean {
    return isGuardedMutationConfirmationValid(body.guardedMutationConfirmation);
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
        && Date.parse(value.ocr_processed_at) === Date.parse(expected.ocr_processed_at)
        && hasExpectedReceiptData(value.receipt_data, expected.receipt_data);
}

async function persistOcrResult(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    reviewId: string,
    update: OcrReviewUpdate,
): Promise<void> {
    assertPrivacySafe(update);

    const { data: readback, error } = await supabase
        .from('reviews')
        .update(update)
        .eq('id', reviewId)
        .select('id, receipt_hash, receipt_data, is_duplicate, ocr_processed_at')
        .maybeSingle();

    if (error || !hasExpectedReviewReadback(readback, reviewId, update)) {
        throw new OcrPersistenceError();
    }
}

type PreprocessResult = {
    warped?: string;
};

function runPythonPreprocess(inputPath: string, outputDir: string): Promise<PreprocessResult> {
    return new Promise((resolve, reject) => {
        const python = process.platform === 'win32' ? 'python' : 'python3';
        const proc = spawn(python, [/* turbopackIgnore: true */ preprocessScriptPath, inputPath, outputDir]);
        const stdoutChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let settled = false;

        const fail = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new OcrPersistenceError());
        };
        const succeed = (result: PreprocessResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const timeout = setTimeout(() => {
            try {
                proc.kill();
            } catch {
                // The fixed preprocessing deadline has already failed closed.
            }
            fail();
        }, PREPROCESS_DEADLINE_MS);

        proc.stdout.on('data', (chunk: Buffer) => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            stdoutBytes += bytes.byteLength;
            if (stdoutBytes > MAX_PREPROCESS_RESULT_BYTES) {
                try {
                    proc.kill();
                } catch {
                    // The bounded stdout rejection is already final.
                }
                fail();
                return;
            }
            stdoutChunks.push(bytes);
        });
        proc.stderr.on('data', () => {
            // Drain stderr without retaining potentially sensitive receipt text.
        });
        proc.on('error', fail);
        proc.on('close', (code) => {
            if (settled) return;
            if (code !== 0) {
                fail();
                return;
            }
            try {
                const result = JSON.parse(Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8').trim()) as unknown;
                if (!isRecord(result) || Object.keys(result).some((key) => key !== 'warped')) {
                    fail();
                    return;
                }
                if (result.warped === undefined) {
                    succeed({});
                    return;
                }
                if (
                    typeof result.warped !== 'string'
                    || result.warped.length === 0
                    || result.warped.length > 1_024
                ) {
                    fail();
                    return;
                }
                succeed({ warped: result.warped });
            } catch {
                fail();
            }
        });
    });
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

function buildReplacementReceiptObjectPath(oldObjectPath: string): string {
    const separatorIndex = oldObjectPath.lastIndexOf('/');
    const directory = separatorIndex === -1 ? '' : oldObjectPath.slice(0, separatorIndex);
    const newObjectPath = `${directory ? `${directory}/` : ''}ocr-${crypto.randomUUID()}.jpg`;
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

async function removeReplacementObject(
    storageAdmin: ReturnType<typeof getSupabaseStorageAdmin>,
    objectPath: string,
): Promise<boolean> {
    try {
        const { error } = await storageAdmin.from('review-photos').remove([objectPath]);
        return !error;
    } catch {
        return false;
    }
}

async function replaceReceiptWithCompressedObject(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    storageAdmin: ReturnType<typeof getSupabaseStorageAdmin>,
    reviewId: string,
    oldObjectPath: string,
    canonicalImage: Buffer,
): Promise<string> {
    const newObjectPath = buildReplacementReceiptObjectPath(oldObjectPath);
    const storage = storageAdmin.from('review-photos');
    let databaseUpdated = false;
    let replacementRemoved = false;
    let replacementStateIndeterminate = false;

    try {
        const { data: uploadData, error: uploadError } = await storage.upload(newObjectPath, canonicalImage, {
            cacheControl: '3600',
            contentType: 'image/jpeg',
            upsert: false,
        });
        if (uploadError || uploadData?.path !== newObjectPath) throw new OcrPersistenceError();

        const uploadedImage = await downloadPrivateReceiptObject(() => storage.download(newObjectPath));
        if (
            uploadedImage.mimeType !== 'image/jpeg'
            || uploadedImage.bytes.byteLength !== canonicalImage.byteLength
            || !uploadedImage.bytes.equals(canonicalImage)
        ) {
            throw new OcrPersistenceError();
        }

        const { data: updateReadback, error: updateError } = await supabase
            .from('reviews')
            .update({ verification_photo: newObjectPath })
            .eq('id', reviewId)
            .eq('verification_photo', oldObjectPath)
            .select('id, verification_photo')
            .maybeSingle();

        if (updateError || !hasExpectedReplacementReadback(updateReadback, reviewId, newObjectPath)) {
            const { data: currentReadback, error: currentReadbackError } = await supabase
                .from('reviews')
                .select('id, verification_photo')
                .eq('id', reviewId)
                .maybeSingle();

            if (!currentReadbackError && hasExpectedReplacementReadback(currentReadback, reviewId, newObjectPath)) {
                databaseUpdated = true;
            } else if (
                !currentReadbackError
                && hasExpectedReplacementReadback(currentReadback, reviewId, oldObjectPath)
            ) {
                if (!(await removeReplacementObject(storageAdmin, newObjectPath))) {
                    throw new OcrPersistenceError();
                }
                replacementRemoved = true;
            } else {
                replacementStateIndeterminate = true;
            }
            throw new OcrPersistenceError();
        }

        databaseUpdated = true;
        const { error: removeOldObjectError } = await storage.remove([oldObjectPath]);
        if (removeOldObjectError) throw new OcrPersistenceError();
        return newObjectPath;
    } catch {
        if (
            !databaseUpdated
            && !replacementRemoved
            && !replacementStateIndeterminate
            && !(await removeReplacementObject(storageAdmin, newObjectPath))
        ) {
            throw new OcrPersistenceError();
        }
        throw new OcrPersistenceError();
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    if (!isTrustedSameOriginMutation(request)) {
        return noStoreJson(
            { code: 'INVALID_REQUEST', error: OCR_ERROR_MESSAGES.INVALID_REQUEST },
            { status: 403 },
        );
    }

    if (!isInlineOcrProcessEnabled()) {
        return noStoreJson(
            buildGuardedMutationRequiredResponse('ocr_receipt', 'inline_process'),
            { status: 403 },
        );
    }

    const parsedBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    if (!parsedBody.ok) {
        return errorResponse(
            'INVALID_REQUEST',
            parsedBody.code === 'BODY_TOO_LARGE' ? 413 : 400,
        );
    }

    const body = parseInlineOcrProcessBody(parsedBody.value);
    if (!body || !UUID_PATTERN.test(body.reviewId)) {
        return errorResponse('INVALID_REQUEST', 400);
    }

    if (!hasGuardedMutationConfirmation(body)) {
        return noStoreJson(
            buildGuardedMutationRequiredResponse('ocr_receipt', 'inline_process'),
            { status: 400 },
        );
    }

    const correlationId = `ocr-inline-${crypto.randomUUID()}`;

    if (!GEMINI_API_KEY?.trim()) {
        return NextResponse.json(
            {
                code: 'OCR_PROVIDER_UNAVAILABLE',
                error: OCR_ERROR_MESSAGES.OCR_PROVIDER_UNAVAILABLE,
                guardedMutation: buildInlineOcrGuardedMutation(correlationId, {
                    reviewId: body.reviewId,
                    applied: false,
                    providerConfigured: false,
                }),
            },
            { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
    }

    const supabase = getSupabaseAdmin();
    const storageAdmin = getSupabaseStorageAdmin();
    let tempRun: ReturnType<typeof createAdminReceiptTempRun> | null = null;

    try {
        const { data: review, error: fetchError } = await supabase
            .from('reviews')
            .select('id, verification_photo')
            .eq('id', body.reviewId)
            .single();

        if (fetchError || !review) return errorResponse('REVIEW_NOT_FOUND', 404);
        if (!review.verification_photo) return errorResponse('RECEIPT_NOT_FOUND', 400);
        assertSafeReceiptObjectPath(review.verification_photo);

        const storage = storageAdmin.from('review-photos');
        const downloadedImage = await downloadPrivateReceiptObject(
            () => storage.download(review.verification_photo),
        );
        const canonicalStorageImage = await canonicalizeReceiptImage(
            downloadedImage.bytes,
            downloadedImage.mimeType,
        );
        if (canonicalStorageImage.bytes.byteLength < downloadedImage.bytes.byteLength) {
            await replaceReceiptWithCompressedObject(
                supabase,
                storageAdmin,
                body.reviewId,
                review.verification_photo,
                canonicalStorageImage.bytes,
            );
        }

        tempRun = createAdminReceiptTempRun();
        const tempInputPath = writeExclusivePrivateReceiptFile(
            tempRun,
            'input.jpg',
            canonicalStorageImage.bytes,
        );
        const preprocessOutputDir = createPrivateReceiptTempDirectory(tempRun, 'stages');

        let preprocessResult: PreprocessResult;
        try {
            preprocessResult = await runPythonPreprocess(tempInputPath, preprocessOutputDir);
        } catch {
            preprocessResult = {};
        }

        let providerImage = canonicalStorageImage;
        if (preprocessResult.warped) {
            const preprocessedBytes = readContainedPrivateReceiptFile(tempRun, preprocessResult.warped);
            const preprocessedMimeType = getReceiptImageMimeTypeFromSignature(preprocessedBytes);
            if (!preprocessedMimeType) throw new OcrPersistenceError();
            providerImage = await canonicalizeReceiptImage(preprocessedBytes, preprocessedMimeType);
        }

        const imageBase64 = providerImage.bytes.toString('base64');
        const ocrResult = await callGeminiReceiptOcr({
            apiKey: GEMINI_API_KEY,
            imageBase64,
            mimeType: 'image/jpeg',
            prompt: OCR_PROMPT,
            signal: request.signal,
        });
        const ocrData = ocrResult.data;

        assertOcrInputSafe(ocrData);
        const receiptData = buildReceiptPersistenceData(ocrData);
        const confidence = receiptData.confidence ?? 0;

        if (ocrData.error || confidence < 0.5) {
            const failureData = buildReceiptFailureData(
                ocrData.error ? getSafeOcrFailureCode(ocrData.error) : 'low_confidence',
            );
            await persistOcrResult(supabase, body.reviewId, {
                receipt_hash: null,
                receipt_data: failureData,
                is_duplicate: false,
                ocr_processed_at: new Date().toISOString(),
            });

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

        await persistOcrResult(supabase, body.reviewId, {
            receipt_hash: duplicateOfId ? null : receiptHash,
            receipt_data: receiptData,
            is_duplicate: Boolean(duplicateOfId),
            ocr_processed_at: new Date().toISOString(),
        });

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
        if (error instanceof AdminReceiptImageSecurityError || error instanceof OcrPersistenceError) {
            return errorResponse('OCR_READBACK_FAILED', 503);
        }
        return errorResponse('OCR_PROCESSING_FAILED', 500);
    } finally {
        if (tempRun) cleanupAdminReceiptTempRun(tempRun);
    }
}
