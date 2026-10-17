import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
    buildGuardedMutationRequiredResponse,
    isGuardedMutationConfirmationValid,
    isInlineOcrProcessEnabled,
} from '@/lib/admin/guarded-mutation-contract';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { FEATURE_DATABASE_HELD_CODE, FEATURE_DATABASE_HELD_MESSAGE } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';
import { processAdminReceiptOcr } from '@/lib/ocr/admin-receipt-processor';

export const runtime = 'nodejs';
const MAX_REQUEST_BYTES = 4 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OCR_ERROR_MESSAGES = { INVALID_REQUEST: 'OCR 요청 정보를 확인할 수 없습니다.' } as const;
type OcrErrorCode = keyof typeof OCR_ERROR_MESSAGES;
type InlineOcrProcessBody = { reviewId: string; guardedMutationConfirmation: string };

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

export async function POST(request: Request) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    if ((await readFeatureDatabaseReadiness({ ownerId: auth.userId })).status !== 'ready') {
        return noStoreJson(
            { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
            { status: 409 },
        );
    }

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

    return processAdminReceiptOcr({ reviewId: body.reviewId, signal: request.signal });
}
