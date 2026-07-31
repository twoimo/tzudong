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

        const workflowPreflightResponse = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ocr-review-receipts.yml`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
            }
        );

        if (!workflowPreflightResponse.ok) {
            await workflowPreflightResponse.text().catch(() => null);
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
        const { error: updateError } = await supabase
            .from('reviews')
            .update({
                ocr_processed_at: null,
                receipt_data: null,
                receipt_hash: null,
                is_duplicate: false,
            })
            .eq('id', reviewId);

        if (updateError) {
            console.error('[admin/ocr-receipts/rerun] guarded mutation reset failed', {
                domain: 'ocr_receipt',
                action: 'rerun',
                step: 'ocr-reset',
                correlationId,
                errorName: getGuardedMutationErrorName(updateError),
            });
            return NextResponse.json(
                { error: 'OCR 초기화에 실패했습니다.', step: 'ocr-reset' },
                { status: 500 }
            );
        }

        // 4. GitHub Actions 워크플로우 트리거

        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ocr-review-receipts.yml/dispatches`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ref: 'main',
                    inputs: {
                        reviewId: reviewId,  // 특정 리뷰 ID 전달
                    },
                }),
            }
        );

        if (!response.ok) {
            await response.text().catch(() => null);
            console.error('[admin/ocr-receipts/rerun] guarded mutation dispatch failed', {
                domain: 'ocr_receipt',
                action: 'rerun',
                step: 'workflow-dispatch',
                status: response.status,
                correlationId,
            });
            const { error: rollbackError } = await supabase
                .from('reviews')
                .update(previousOcrState)
                .eq('id', reviewId);
            return NextResponse.json(
                {
                    error: `GitHub Actions 트리거 실패: ${response.status}`,
                    step: 'workflow-dispatch',
                    resetRolledBack: !rollbackError,
                    rollbackError: rollbackError ? 'OCR 초기화 롤백에 실패했습니다. 수동 확인이 필요합니다.' : null,
                    guardedMutation: {
                        domain: 'ocr_receipt',
                        action: 'rerun',
                        confirmation: GUARDED_MUTATION_CONFIRMATION,
                        readback: {
                            resetApplied: true,
                            resetRolledBack: !rollbackError,
                            workflowDispatched: false,
                            reviewId,
                        },
                        audit: {
                            source: 'github-actions-workflow-dispatch',
                            correlationId,
                        },
                    },
                },
                { status: response.status === 401 || response.status === 403 ? 502 : response.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'OCR 재실행이 시작되었습니다. 약 30~40초 후 결과가 반영됩니다.',
            reviewId,
            guardedMutation: {
                domain: 'ocr_receipt',
                action: 'rerun',
                confirmation: GUARDED_MUTATION_CONFIRMATION,
                readback: {
                    resetApplied: true,
                    workflowDispatched: true,
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
