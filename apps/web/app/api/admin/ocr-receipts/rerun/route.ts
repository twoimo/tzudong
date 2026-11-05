/** Single-review OCR rerun and explicit indeterminate-result recovery. */

import crypto from 'node:crypto';
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
    buildBoundReceiptOcrRecoveryWorkflowInputs,
    dispatchReceiptOcrWorkflow,
    RECEIPT_OCR_WORKFLOW_FILE,
} from '@/lib/ocr/workflow-dispatch';
import {
    isResetReceiptOcrState,
    resetReceiptOcrRowWithCas,
} from '@/lib/ocr/admin-receipt-reset';
import {
    ReceiptOcrRecoveryCapabilityHeldError,
    ReceiptOcrRecoveryPersistenceError,
    applyReceiptOcrIndeterminateRecovery,
    assertReceiptOcrRecoveryCapabilityReady,
    isReceiptOcrRecoveryOperationId,
    isReceiptOcrRecoverySnapshotHash,
    previewReceiptOcrIndeterminateRecovery,
    type ReceiptOcrRecoveryApply,
    ADMIN_RECEIPT_OCR_PREPROCESS_VERSION,
    ADMIN_RECEIPT_OCR_PROMPT_VERSION,
} from '@/lib/ocr/admin-receipt-recovery';
import { RECEIPT_OCR_NORMALIZATION_VERSION } from '@/lib/ocr/receipt-normalization';

export const runtime = 'nodejs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const GITHUB_REPO = process.env.GITHUB_REPO!;
const MAX_OCR_RERUN_REQUEST_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_ACTION = 'preview_provider_indeterminate' as const;
const RECOVERY_ACTION = 'recover_provider_indeterminate' as const;

type RerunRequest = {
    action?: typeof PREVIEW_ACTION | typeof RECOVERY_ACTION;
    reviewId?: string;
    recoveryOperationId?: string;
    expectedGeneration?: string;
    inputSnapshotHash?: string;
    guardedMutationConfirmation?: string;
};

function hasGuardedMutationConfirmation(request: Request, body: RerunRequest): boolean {
    return isGuardedMutationConfirmationValid(body.guardedMutationConfirmation)
        || isGuardedMutationConfirmationValid(request.headers.get('x-admin-guarded-mutation-confirmation'));
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function recoveryConflictCode(status: Exclude<ReceiptOcrRecoveryApply['status'], 'rotated'>) {
    if (status === 'processing') return 'OCR_RECOVERY_PROCESSING';
    if (status === 'not_indeterminate') return 'OCR_RECOVERY_NOT_INDETERMINATE';
    if (status === 'stale_operation') return 'OCR_RECOVERY_OPERATION_STALE';
    return 'OCR_RECOVERY_CONFLICT';
}

function recoveryConflictMessage(status: Exclude<ReceiptOcrRecoveryApply['status'], 'rotated'>) {
    if (status === 'processing') return '기존 OCR 처리가 진행 중입니다. 처리 상태를 확인해 주세요.';
    if (status === 'not_indeterminate') return '복구할 불확실 OCR 결과가 확인되지 않았습니다.';
    return 'OCR 복구 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.';
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
            return noStoreJson({ error: '요청을 처리할 수 없습니다.' }, { status: 403 });
        }

        const requestBody = await readBoundedJsonRequest(request, MAX_OCR_RERUN_REQUEST_BYTES);
        if (!requestBody.ok || !requestBody.value || typeof requestBody.value !== 'object'
            || Array.isArray(requestBody.value)) {
            return noStoreJson({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });
        }
        const body = requestBody.value as RerunRequest;
        const reviewId = body.reviewId;
        if (!reviewId || !UUID.test(reviewId)
            || (body.action !== undefined && body.action !== PREVIEW_ACTION && body.action !== RECOVERY_ACTION)) {
            return noStoreJson({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });
        }

        const supabase = createSupabaseServiceRoleClient();
        if (body.action === PREVIEW_ACTION) {
            try {
                const recovery = await previewReceiptOcrIndeterminateRecovery(supabase, reviewId);
                return noStoreJson({ success: true, recovery });
            } catch (error) {
                if (error instanceof ReceiptOcrRecoveryCapabilityHeldError) {
                    return noStoreJson(
                        { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
                        { status: 503 },
                    );
                }
                throw error;
            }
        }

        try {
            await assertReceiptOcrRecoveryCapabilityReady(supabase);
        } catch (error) {
            if (error instanceof ReceiptOcrRecoveryCapabilityHeldError) {
                return noStoreJson(
                    { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
                    { status: 503 },
                );
            }
            throw error;
        }

        if (!hasGuardedMutationConfirmation(request, body)) {
            return noStoreJson(
                buildGuardedMutationRequiredResponse(
                    'ocr_receipt',
                    body.action === RECOVERY_ACTION ? 'recover_provider_indeterminate' : 'rerun',
                ),
                { status: 400 },
            );
        }
        if (body.action === RECOVERY_ACTION
            && (!isReceiptOcrRecoveryOperationId(body.recoveryOperationId)
                || !isReceiptOcrRecoveryOperationId(body.expectedGeneration)
                || !isReceiptOcrRecoverySnapshotHash(body.inputSnapshotHash))) {
            return noStoreJson({ error: 'OCR 복구 요청이 올바르지 않습니다.' }, { status: 400 });
        }

        const correlationId = crypto.randomUUID();
        const { data: review, error: fetchError } = await supabase
            .from('reviews')
            .select('id, verification_photo, ocr_processed_at, receipt_data, receipt_hash, is_duplicate')
            .eq('id', reviewId)
            .single();
        if (fetchError || !review) {
            return noStoreJson({ error: '리뷰를 찾을 수 없습니다.' }, { status: 404 });
        }
        if (!review.verification_photo) {
            return noStoreJson({ error: '영수증 사진이 없는 리뷰입니다.' }, { status: 400 });
        }

        const previousOcrState = {
            ocr_processed_at: review.ocr_processed_at,
            receipt_data: review.receipt_data,
            receipt_hash: review.receipt_hash,
            is_duplicate: review.is_duplicate,
        };
        const resetAlreadyPending = isResetReceiptOcrState({ id: reviewId, ...previousOcrState });
        if (body.action === RECOVERY_ACTION && !resetAlreadyPending) {
            return noStoreJson(
                { code: 'OCR_RECOVERY_CONFLICT', error: 'OCR 복구 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.' },
                { status: 409 },
            );
        }
        if (body.action === undefined && resetAlreadyPending) {
            try {
                const recovery = await previewReceiptOcrIndeterminateRecovery(supabase, reviewId);
                if (recovery.status !== 'not_indeterminate') {
                    const code = recovery.status === 'processing'
                        ? 'OCR_RECOVERY_PROCESSING'
                        : recovery.status === 'eligible' || recovery.status === 'recovery_in_progress'
                            ? 'OCR_RECOVERY_REQUIRED'
                            : 'OCR_RECOVERY_CONFLICT';
                    const error = recovery.status === 'processing'
                        ? '기존 OCR 처리가 진행 중입니다. 처리 상태를 확인해 주세요.'
                        : recovery.status === 'eligible' || recovery.status === 'recovery_in_progress'
                            ? '불확실 OCR 결과는 복구 확인 후 다시 실행할 수 있습니다.'
                            : 'OCR 복구 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.';
                    return noStoreJson({ code, error, dispatchSkipped: true }, { status: 409 });
                }
            } catch (error) {
                if (error instanceof ReceiptOcrRecoveryCapabilityHeldError) {
                    return noStoreJson(
                        { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE, dispatchSkipped: true },
                        { status: 503 },
                    );
                }
                if (error instanceof ReceiptOcrRecoveryPersistenceError) {
                    return noStoreJson(
                        { code: 'OCR_RECOVERY_READBACK_FAILED', error: 'OCR 복구 상태를 확인하지 못했습니다.', dispatchSkipped: true },
                        { status: 503 },
                    );
                }
                throw error;
            }
        }

        // No row or generation may change before this external preflight succeeds.
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return noStoreJson(
                {
                    code: 'OCR_WORKFLOW_PREFLIGHT_FAILED',
                    error: '워크플로우 설정을 확인하지 못해 OCR 상태를 변경하지 않았습니다.',
                    step: 'workflow-preflight',
                    resetSkipped: true,
                },
                { status: 503 },
            );
        }

        let workflowInputs: Record<string, string>;
        try {
            workflowInputs = await buildReceiptOcrWorkflowInputs([reviewId]);
        } catch {
            return noStoreJson(
                {
                    code: 'OCR_WORKFLOW_CONFIGURATION_UNAVAILABLE',
                    error: 'OCR 워크플로우 설정을 확인하지 못해 OCR 상태를 변경하지 않았습니다.',
                    step: 'workflow-config',
                    resetSkipped: true,
                },
                { status: 503 },
            );
        }

        const workflowPreflightResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${RECEIPT_OCR_WORKFLOW_FILE}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
            },
        );
        if (!workflowPreflightResponse.ok) {
            await workflowPreflightResponse.body?.cancel().catch(() => undefined);
            console.error('[admin/ocr-receipts/rerun] guarded mutation preflight failed', {
                domain: 'ocr_receipt', action: body.action ?? 'rerun', step: 'workflow-preflight',
                code: 'OCR_WORKFLOW_PREFLIGHT_FAILED', correlationId,
            });
            return noStoreJson(
                {
                    code: 'OCR_WORKFLOW_PREFLIGHT_FAILED',
                    error: '워크플로우 사전 확인에 실패해 OCR 상태를 변경하지 않았습니다.',
                    step: 'workflow-preflight',
                    resetSkipped: true,
                },
                { status: workflowPreflightResponse.status === 401 || workflowPreflightResponse.status === 403 ? 502 : 503 },
            );
        }

        try {
            await assertReceiptOcrRecoveryCapabilityReady(supabase);
        } catch (error) {
            if (error instanceof ReceiptOcrRecoveryCapabilityHeldError) {
                return noStoreJson(
                    { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE, dispatchSkipped: true },
                    { status: 503 },
                );
            }
            throw error;
        }

        let resetApplied = false;
        let recoveryReadback: Extract<ReceiptOcrRecoveryApply, { status: 'rotated' }> | null = null;
        if (body.action === RECOVERY_ACTION) {
            try {
                const recovery = await applyReceiptOcrIndeterminateRecovery(supabase, {
                    actorUserId: auth.userId,
                    reviewId,
                    recoveryOperationId: body.recoveryOperationId!,
                    expectedGeneration: body.expectedGeneration!,
                    inputSnapshotHash: body.inputSnapshotHash!,
                    modelPolicy: JSON.parse(workflowInputs.modelPolicy) as string[],
                    thinkingLevel: workflowInputs.thinkingLevel,
                    promptVersion: ADMIN_RECEIPT_OCR_PROMPT_VERSION,
                    preprocessVersion: ADMIN_RECEIPT_OCR_PREPROCESS_VERSION,
                    normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
                });
                if (recovery.status !== 'rotated') {
                    return noStoreJson(
                        { code: recoveryConflictCode(recovery.status), error: recoveryConflictMessage(recovery.status), dispatchSkipped: true },
                        { status: 409 },
                    );
                }
                recoveryReadback = recovery;
                workflowInputs = buildBoundReceiptOcrRecoveryWorkflowInputs({
                    reviewId,
                    recoveryOperationId: recovery.operationId,
                    modelPolicy: recovery.modelPolicy,
                    thinkingLevel: recovery.thinkingLevel,
                });
            } catch (error) {
                if (error instanceof ReceiptOcrRecoveryCapabilityHeldError) {
                    return noStoreJson(
                        { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE, dispatchSkipped: true },
                        { status: 503 },
                    );
                }
                if (error instanceof ReceiptOcrRecoveryPersistenceError) {
                    return noStoreJson(
                        { code: 'OCR_RECOVERY_READBACK_FAILED', error: 'OCR 복구 상태를 확인하지 못했습니다.', dispatchSkipped: true },
                        { status: 503 },
                    );
                }
                throw error;
            }
        } else if (!resetAlreadyPending) {
            const resetResult = await resetReceiptOcrRowWithCas(supabase, { id: reviewId, ...previousOcrState });
            if (resetResult !== 'applied') {
                console.error('[admin/ocr-receipts/rerun] guarded mutation reset failed', {
                    domain: 'ocr_receipt', action: 'rerun', step: 'ocr-reset', correlationId,
                    code: resetResult === 'conflict' ? 'OCR_RESET_CONFLICT' : 'OCR_RESET_FAILED',
                });
                return noStoreJson(
                    { code: resetResult === 'conflict' ? 'OCR_RESET_CONFLICT' : 'OCR_RESET_FAILED', error: 'OCR 상태가 변경되어 초기화하지 않았습니다.', step: 'ocr-reset' },
                    { status: resetResult === 'conflict' ? 409 : 503 },
                );
            }
            resetApplied = true;
        }

        const dispatch = await dispatchReceiptOcrWorkflow({
            url: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${RECEIPT_OCR_WORKFLOW_FILE}/dispatches`,
            token: GITHUB_TOKEN,
            inputs: workflowInputs,
        });

        const readback = {
            resetApplied,
            resetAlreadyPending,
            resetReadbackVerified: true,
            resetPreserved: true,
            reviewId,
            ...(recoveryReadback ? {
                recoveryOperationId: recoveryReadback.operationId,
                previousGeneration: recoveryReadback.previousGeneration,
                generation: recoveryReadback.generation,
                inputSnapshotHash: recoveryReadback.inputSnapshotHash,
                recoveryIdempotent: recoveryReadback.idempotent,
                providerOutcomeCertain: false,
            } : {}),
        };

        if (dispatch.status !== 'accepted') {
            console.error('[admin/ocr-receipts/rerun] guarded mutation dispatch failed', {
                domain: 'ocr_receipt', action: body.action ?? 'rerun', step: 'workflow-dispatch',
                code: 'OCR_WORKFLOW_DISPATCH_INDETERMINATE', correlationId,
            });
            return noStoreJson(
                {
                    code: 'OCR_WORKFLOW_DISPATCH_INDETERMINATE',
                    error: '워크플로우 접수 여부를 확인하지 못했습니다. 처리 상태를 확인한 뒤 다시 시도해 주세요.',
                    step: 'workflow-dispatch',
                    dispatchIndeterminate: true,
                    guardedMutation: {
                        domain: 'ocr_receipt', action: body.action ?? 'rerun',
                        confirmation: GUARDED_MUTATION_CONFIRMATION,
                        readback: {
                            ...readback,
                            workflowDispatched: null,
                            workflowDispatchAccepted: null,
                            workflowDeliveryVerified: false,
                        },
                        audit: { source: 'github-actions-workflow-dispatch', correlationId },
                    },
                },
                { status: dispatch.httpStatus === 401 || dispatch.httpStatus === 403 ? 502 : 503 },
            );
        }

        return noStoreJson({
            success: true,
            message: body.action === RECOVERY_ACTION
                ? 'OCR 복구 요청이 접수되었습니다. 처리 상태에서 결과를 확인해 주세요.'
                : 'OCR 재실행 요청이 접수되었습니다. 처리 상태에서 결과를 확인해 주세요.',
            reviewId,
            guardedMutation: {
                domain: 'ocr_receipt', action: body.action ?? 'rerun',
                confirmation: GUARDED_MUTATION_CONFIRMATION,
                readback: {
                    ...readback,
                    workflowDispatched: true,
                    workflowDispatchAccepted: true,
                    workflowDeliveryVerified: false,
                },
                audit: { source: 'github-actions-workflow-dispatch', correlationId },
            },
        });
    } catch (error) {
        console.error('[admin/ocr-receipts/rerun] guarded mutation failed', {
            domain: 'ocr_receipt', action: 'rerun', step: 'unexpected',
            errorName: getGuardedMutationErrorName(error),
        });
        return noStoreJson({ error: 'OCR 재실행을 시작하지 못했습니다.' }, { status: 500 });
    }
}
