/**
 * 전체 리뷰 OCR 초기화 및 재실행 API
 * 
 * POST /api/admin/ocr-receipts/reset-all
 * - 대기 중인 리뷰 또는 최대 50개의 명시적 리뷰만 워크플로우와 함께 초기화
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
    GUARDED_MUTATION_CONFIRMATION,
    buildGuardedMutationRequiredResponse,
    getGuardedMutationErrorName,
    isGuardedMutationConfirmationValid,
} from '@/lib/admin/guarded-mutation-contract';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { FEATURE_DATABASE_HELD_CODE, FEATURE_DATABASE_HELD_MESSAGE } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';
import {
    buildReceiptOcrWorkflowInputs,
    dispatchReceiptOcrWorkflow,
    RECEIPT_OCR_WORKFLOW_FILE,
} from '@/lib/ocr/workflow-dispatch';
import {
    OCR_RESET_PROJECTION,
    resetReceiptOcrRowsWithCas,
    resetReceiptOcrRowWithCas,
    type ReceiptOcrResetSnapshot,
} from '@/lib/ocr/admin-receipt-reset';

export const runtime = 'nodejs';

// 환경 변수
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const GITHUB_REPO = process.env.GITHUB_REPO!;

const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화';

const MAX_OCR_RESET_ALL_REQUEST_BYTES = 4 * 1024;
const MAX_OCR_RESET_BATCH = 50;

function hasGuardedMutationConfirmation(
    request: Request,
    body: { guardedMutationConfirmation?: string },
): boolean {
    return (
        isGuardedMutationConfirmationValid(body.guardedMutationConfirmation) ||
        isGuardedMutationConfirmationValid(request.headers.get('x-admin-guarded-mutation-confirmation'))
    );
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) {
            auth.response.headers.set('Cache-Control', 'no-store');
            return auth.response;
        }

        if ((await readFeatureDatabaseReadiness({ ownerId: auth.userId })).status !== 'ready') {
            return noStoreJson(
                { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
                { status: 409 },
            );
        }

        if (!isTrustedSameOriginMutation(request)) {
            return noStoreJson(
                { error: '요청을 처리할 수 없습니다.' },
                { status: 403 }
            );
        }

        const requestBody = await readBoundedJsonRequest(request, MAX_OCR_RESET_ALL_REQUEST_BYTES);
        if (
            !requestBody.ok ||
            !requestBody.value ||
            typeof requestBody.value !== 'object' ||
            Array.isArray(requestBody.value)
        ) {
            return noStoreJson(
                { error: '요청 본문이 올바르지 않습니다.' },
                { status: 400 }
            );
        }
        const body = requestBody.value as {
            confirmation?: string;
            guardedMutationConfirmation?: string;
        };

        if (!hasGuardedMutationConfirmation(request, body)) {
            return noStoreJson(
                buildGuardedMutationRequiredResponse('ocr_receipt', 'reset_all'),
                { status: 400 }
            );
        }

        if (body.confirmation !== OCR_RESET_ALL_CONFIRMATION) {
            return noStoreJson(
                {
                    ...buildGuardedMutationRequiredResponse('ocr_receipt', 'reset_all'),
                    error: 'OCR 전체 초기화 확인 문구가 일치하지 않습니다.',
                },
                { status: 400 }
            );
        }

        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return NextResponse.json(
                { error: 'GitHub 환경 변수가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

        const correlationId = `ocr-reset-all-${Date.now()}`;

        const workflowUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${RECEIPT_OCR_WORKFLOW_FILE}`;
        const githubHeaders = {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        };

        const workflowPreflightResponse = await fetch(workflowUrl, {
            method: 'GET',
            headers: githubHeaders,
        });

        if (!workflowPreflightResponse.ok) {
            await workflowPreflightResponse.body?.cancel().catch(() => undefined);
            console.error('[admin/ocr-receipts/reset-all] guarded mutation preflight failed', {
                domain: 'ocr_receipt',
                action: 'reset_all',
                step: 'workflow-preflight',
                status: workflowPreflightResponse.status,
                correlationId,
            });
            return NextResponse.json(
                { error: `GitHub Actions 사전 확인 실패: ${workflowPreflightResponse.status}` },
                { status: workflowPreflightResponse.status }
            );
        }

        const supabase = createSupabaseServiceRoleClient();

        // Preserve already-reset rows first. A retry therefore re-dispatches
        // the same generations instead of rotating them again.
        const { data: pendingRows, error: pendingError } = await supabase
            .from('reviews')
            .select(OCR_RESET_PROJECTION)
            .not('verification_photo', 'is', null)
            .is('ocr_processed_at', null)
            .is('receipt_data', null)
            .is('receipt_hash', null)
            .eq('is_duplicate', false)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(MAX_OCR_RESET_BATCH);

        if (pendingError) {
            return noStoreJson(
                { error: 'OCR 대기 배치를 확인하지 못했습니다.', resetSkipped: true },
                { status: 503 },
            );
        }

        let targetRows = (pendingRows ?? []) as ReceiptOcrResetSnapshot[];
        let resetApplied = false;
        if (targetRows.length === 0) {
            const { data: resetCandidates, error: candidateError } = await supabase
                .from('reviews')
                .select(OCR_RESET_PROJECTION)
                .not('verification_photo', 'is', null)
                .or('ocr_processed_at.not.is.null,receipt_data.not.is.null,receipt_hash.not.is.null,is_duplicate.eq.true,is_duplicate.is.null')
                .order('ocr_processed_at', { ascending: true, nullsFirst: true })
                .order('id', { ascending: true })
                .limit(MAX_OCR_RESET_BATCH);
            if (candidateError) {
                return noStoreJson(
                    { error: 'OCR 초기화 대상을 확인하지 못했습니다.', resetSkipped: true },
                    { status: 503 },
                );
            }
            targetRows = (resetCandidates ?? []) as ReceiptOcrResetSnapshot[];
        }

        if (targetRows.length === 0) {
            return noStoreJson({
                success: true,
                message: '재실행할 영수증 OCR이 없습니다.',
                guardedMutation: {
                    domain: 'ocr_receipt', action: 'reset_all', confirmation: GUARDED_MUTATION_CONFIRMATION,
                    readback: { resetApplied: false, workflowDispatched: false, affectedCount: 0 },
                    audit: { source: 'bounded-ocr-reset-preview', correlationId },
                },
            });
        }

        const targetReviewIds = targetRows.map((row) => row.id);
        let workflowInputs: Record<string, string>;
        try {
            workflowInputs = await buildReceiptOcrWorkflowInputs(targetReviewIds);
        } catch {
            return noStoreJson(
                { error: 'OCR 워크플로우 설정을 확인하지 못했습니다.', resetSkipped: true },
                { status: 503 },
            );
        }

        const resetOutcome = await resetReceiptOcrRowsWithCas(
            targetRows,
            (snapshot) => resetReceiptOcrRowWithCas(supabase, snapshot),
        );
        if (resetOutcome.status !== 'complete') {
            resetApplied = resetOutcome.appliedReviewIds.length > 0;
            console.error('[admin/ocr-receipts/reset-all] guarded mutation reset conflict', {
                domain: 'ocr_receipt',
                action: 'reset_all',
                step: 'ocr-reset',
                correlationId,
                resetResult: resetOutcome.status,
                appliedCount: resetOutcome.appliedReviewIds.length,
            });
            return noStoreJson(
                {
                    error: 'OCR 상태가 동시에 변경되어 workflow를 시작하지 않았습니다. 처리 상태를 확인한 뒤 다시 시도해 주세요.',
                    partialFailure: resetApplied,
                    resetApplied,
                    resetPreserved: true,
                    dispatchSkipped: true,
                    readbackRequired: true,
                    affectedCount: resetOutcome.appliedReviewIds.length,
                },
                { status: resetOutcome.status === 'conflict' ? 409 : 503 },
            );
        }
        resetApplied = resetOutcome.appliedReviewIds.length > 0;

        const dispatch = await dispatchReceiptOcrWorkflow({
            url: `${workflowUrl}/dispatches`,
            token: GITHUB_TOKEN,
            inputs: workflowInputs,
        });

        if (dispatch.status !== 'accepted') {
            console.error('[admin/ocr-receipts/reset-all] guarded mutation dispatch failed', {
                domain: 'ocr_receipt',
                action: 'reset_all',
                step: 'workflow-dispatch',
                status: dispatch.httpStatus,
                correlationId,
            });
            return noStoreJson(
                {
                    error: 'GitHub Actions 접수 여부를 확인하지 못했습니다. 처리 상태를 확인한 뒤 다시 시도해 주세요.',
                    partialFailure: true,
                    dispatchIndeterminate: true,
                    resetApplied,
                    readbackRequired: true,
                    guardedMutation: {
                        domain: 'ocr_receipt',
                        action: 'reset_all',
                        confirmation: GUARDED_MUTATION_CONFIRMATION,
                        readback: {
                            resetApplied,
                            resetReadbackVerified: true,
                            resetPreserved: true,
                            workflowDispatched: null,
                            workflowDispatchAccepted: null,
                            workflowDeliveryVerified: false,
                            affectedCount: targetReviewIds.length,
                        },
                        audit: {
                            source: 'github-actions-workflow-dispatch',
                            correlationId,
                        },
                    },
                },
                { status: dispatch.httpStatus === 401 || dispatch.httpStatus === 403 ? 502 : 503 }
            );
        }

        return noStoreJson({
            success: true,
            message: `영수증 OCR ${targetReviewIds.length}개 배치의 재실행 요청이 접수되었습니다.`,
            guardedMutation: {
                domain: 'ocr_receipt',
                action: 'reset_all',
                confirmation: GUARDED_MUTATION_CONFIRMATION,
                readback: {
                    resetApplied,
                    resetReadbackVerified: true,
                    workflowDispatched: true,
                    workflowDispatchAccepted: true,
                    workflowDeliveryVerified: false,
                    affectedCount: targetReviewIds.length,
                },
                audit: {
                    source: 'github-actions-workflow-dispatch',
                    correlationId,
                },
            },
        });

    } catch (err) {
        console.error('[admin/ocr-receipts/reset-all] guarded mutation failed', {
            domain: 'ocr_receipt',
            action: 'reset_all',
            step: 'unexpected',
            errorName: getGuardedMutationErrorName(err),
        });
        return NextResponse.json(
            { error: 'OCR 전체 재실행을 시작하지 못했습니다.' },
            { status: 500 }
        );
    }
}
