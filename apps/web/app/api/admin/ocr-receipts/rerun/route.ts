/**
 * 단일 리뷰 OCR 재실행 API
 * 
 * POST /api/admin/ocr-receipts/rerun
 * - 해당 리뷰의 OCR 데이터를 초기화하고 GitHub Actions 워크플로우 트리거
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
    isResetReceiptOcrState,
    resetReceiptOcrRowWithCas,
} from '@/lib/ocr/admin-receipt-reset';

export const runtime = 'nodejs';

// 환경 변수
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const GITHUB_REPO = process.env.GITHUB_REPO!;

const MAX_OCR_RERUN_REQUEST_BYTES = 4 * 1024;

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

        const requestBody = await readBoundedJsonRequest(request, MAX_OCR_RERUN_REQUEST_BYTES);
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
            reviewId?: string;
            guardedMutationConfirmation?: string;
        };
        const { reviewId } = body;

        if (!reviewId) {
            return noStoreJson(
                { error: '리뷰 ID가 필요합니다.' },
                { status: 400 }
            );
        }

        if (!hasGuardedMutationConfirmation(request, body)) {
            return noStoreJson(
                buildGuardedMutationRequiredResponse('ocr_receipt', 'rerun'),
                { status: 400 }
            );
        }

        const correlationId = `ocr-rerun-${reviewId}-${Date.now()}`;

        const supabase = createSupabaseServiceRoleClient();

        // 1. 리뷰 존재 여부 확인 및 롤백용 OCR 스냅샷 확보
        const { data: review, error: fetchError } = await supabase
            .from('reviews')
            .select('id, verification_photo, ocr_processed_at, receipt_data, receipt_hash, is_duplicate')
            .eq('id', reviewId)
            .single();

        if (fetchError || !review) {
            return NextResponse.json(
                { error: '리뷰를 찾을 수 없습니다.' },
                { status: 404 }
            );
        }

        if (!review.verification_photo) {
            return NextResponse.json(
                { error: '영수증 사진이 없는 리뷰입니다.' },
                { status: 400 }
            );
        }

        // 2. GitHub Actions 워크플로우 사전 확인: 인증/권한 실패 시 OCR 데이터를 먼저 지우지 않습니다.
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return NextResponse.json(
                {
                    error: 'GitHub 환경 변수가 설정되지 않아 OCR 데이터를 초기화하지 않았습니다.',
                    step: 'workflow-preflight',
                    resetSkipped: true,
                },
                { status: 503 }
            );
        }

        let workflowInputs: Record<string, string>;
        try {
            workflowInputs = await buildReceiptOcrWorkflowInputs([reviewId]);
        } catch {
            return noStoreJson(
                {
                    error: 'OCR 워크플로우 설정을 확인하지 못해 OCR 데이터를 초기화하지 않았습니다.',
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
            }
        );

        if (!workflowPreflightResponse.ok) {
            await workflowPreflightResponse.body?.cancel().catch(() => undefined);
            console.error('[admin/ocr-receipts/rerun] guarded mutation preflight failed', {
                domain: 'ocr_receipt',
                action: 'rerun',
                step: 'workflow-preflight',
                status: workflowPreflightResponse.status,
                correlationId,
            });
            return NextResponse.json(
                {
                    error: `GitHub Actions 권한 확인 실패: ${workflowPreflightResponse.status}. OCR 데이터를 초기화하지 않았습니다.`,
                    step: 'workflow-preflight',
                    resetSkipped: true,
                },
                { status: workflowPreflightResponse.status === 401 || workflowPreflightResponse.status === 403 ? 502 : 503 }
            );
        }


        // 3. OCR 데이터 초기화 (재처리 대상으로 만들기)
        const previousOcrState = {
            ocr_processed_at: review.ocr_processed_at,
            receipt_data: review.receipt_data,
            receipt_hash: review.receipt_hash,
            is_duplicate: review.is_duplicate,
        };
        const resetAlreadyPending = isResetReceiptOcrState({ id: reviewId, ...previousOcrState });
        let resetApplied = false;
        if (!resetAlreadyPending) {
            const resetResult = await resetReceiptOcrRowWithCas(
                supabase,
                { id: reviewId, ...previousOcrState },
            );
            if (resetResult !== 'applied') {
                console.error('[admin/ocr-receipts/rerun] guarded mutation reset failed', {
                    domain: 'ocr_receipt',
                    action: 'rerun',
                    step: 'ocr-reset',
                    correlationId,
                    resetResult,
                });
                return noStoreJson(
                    { error: 'OCR 상태가 변경되어 초기화하지 않았습니다.', step: 'ocr-reset' },
                    { status: resetResult === 'conflict' ? 409 : 503 }
                );
            }
            resetApplied = true;
        }

        // 4. GitHub Actions 워크플로우 트리거

        const dispatch = await dispatchReceiptOcrWorkflow({
            url: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${RECEIPT_OCR_WORKFLOW_FILE}/dispatches`,
            token: GITHUB_TOKEN,
            inputs: workflowInputs,
        });

        if (dispatch.status !== 'accepted') {
            console.error('[admin/ocr-receipts/rerun] guarded mutation dispatch failed', {
                domain: 'ocr_receipt',
                action: 'rerun',
                step: 'workflow-dispatch',
                status: dispatch.httpStatus,
                correlationId,
            });
            return noStoreJson(
                {
                    error: 'GitHub Actions 접수 여부를 확인하지 못했습니다. 처리 상태를 확인한 뒤 다시 시도해 주세요.',
                    step: 'workflow-dispatch',
                    dispatchIndeterminate: true,
                    guardedMutation: {
                        domain: 'ocr_receipt',
                        action: 'rerun',
                        confirmation: GUARDED_MUTATION_CONFIRMATION,
                        readback: {
                            resetApplied,
                            resetAlreadyPending,
                            resetReadbackVerified: true,
                            resetPreserved: true,
                            workflowDispatched: null,
                            workflowDispatchAccepted: null,
                            workflowDeliveryVerified: false,
                            reviewId,
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

        return NextResponse.json({
            success: true,
            message: 'OCR 재실행 요청이 접수되었습니다. 처리 상태에서 결과를 확인해 주세요.',
            reviewId,
            guardedMutation: {
                domain: 'ocr_receipt',
                action: 'rerun',
                confirmation: GUARDED_MUTATION_CONFIRMATION,
                readback: {
                    resetApplied,
                    resetAlreadyPending,
                    resetReadbackVerified: true,
                    workflowDispatched: true,
                    workflowDispatchAccepted: true,
                    workflowDeliveryVerified: false,
                    reviewId,
                },
                audit: {
                    source: 'github-actions-workflow-dispatch',
                    correlationId,
                },
            },
        });

    } catch (err) {
        console.error('[admin/ocr-receipts/rerun] guarded mutation failed', {
            domain: 'ocr_receipt',
            action: 'rerun',
            step: 'unexpected',
            errorName: getGuardedMutationErrorName(err),
        });
        return NextResponse.json(
            { error: 'OCR 재실행을 시작하지 못했습니다.' },
            { status: 500 }
        );
    }
}
