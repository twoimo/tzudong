/**
 * 전체 리뷰 OCR 초기화 및 재실행 API
 * 
 * POST /api/admin/ocr-receipts/reset-all
 * - 모든 리뷰의 OCR 데이터를 초기화하고 GitHub Actions 워크플로우 트리거
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

const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화';

const MAX_OCR_RESET_ALL_REQUEST_BYTES = 4 * 1024;

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

        const workflowUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ocr-review-receipts.yml`;
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
            await workflowPreflightResponse.text().catch(() => null);
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

        // 1. 영수증 사진이 있는 리뷰 수 조회
        const { count } = await supabase
            .from('reviews')
            .select('id', { count: 'exact', head: true })
            .not('verification_photo', 'is', null);

        // 2. 모든 리뷰의 OCR 데이터 초기화
        const { error: resetError } = await supabase
            .from('reviews')
            .update({
                ocr_processed_at: null,
                receipt_data: null,
                receipt_hash: null,
                is_duplicate: false,
            })
            .not('verification_photo', 'is', null);

        if (resetError) {
            console.error('[admin/ocr-receipts/reset-all] guarded mutation reset failed', {
                domain: 'ocr_receipt',
                action: 'reset_all',
                step: 'ocr-reset',
                correlationId,
                errorName: getGuardedMutationErrorName(resetError),
            });
            return NextResponse.json(
                { error: 'OCR 초기화에 실패했습니다.' },
                { status: 500 }
            );
        }

        // 3. GitHub Actions 워크플로우 트리거

        const response = await fetch(`${workflowUrl}/dispatches`, {
            method: 'POST',
            headers: githubHeaders,
            body: JSON.stringify({ ref: 'main' }),
        });

        if (!response.ok) {
            await response.text().catch(() => null);
            console.error('[admin/ocr-receipts/reset-all] guarded mutation dispatch failed', {
                domain: 'ocr_receipt',
                action: 'reset_all',
                step: 'workflow-dispatch',
                status: response.status,
                correlationId,
            });
            return NextResponse.json(
                {
                    error: `GitHub Actions 트리거 실패: ${response.status}`,
                    partialFailure: true,
                    resetApplied: true,
                    readbackRequired: true,
                    guardedMutation: {
                        domain: 'ocr_receipt',
                        action: 'reset_all',
                        confirmation: GUARDED_MUTATION_CONFIRMATION,
                        readback: {
                            resetApplied: true,
                            workflowDispatched: false,
                            affectedCount: count || 0,
                        },
                        audit: {
                            source: 'github-actions-workflow-dispatch',
                            correlationId,
                        },
                    },
                },
                { status: response.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: `모든 리뷰(${count || 0}개)의 OCR을 초기화하고 재실행을 시작했습니다.`,
            guardedMutation: {
                domain: 'ocr_receipt',
                action: 'reset_all',
                confirmation: GUARDED_MUTATION_CONFIRMATION,
                readback: {
                    resetApplied: true,
                    workflowDispatched: true,
                    affectedCount: count || 0,
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
