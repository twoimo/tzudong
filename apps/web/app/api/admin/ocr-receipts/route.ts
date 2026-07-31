/**
 * 리뷰 영수증 OCR GitHub Actions 트리거 API
 * 
 * POST /api/admin/ocr-receipts - GitHub Actions 워크플로우 트리거
 * GET /api/admin/ocr-receipts - OCR 처리 상태 조회
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

const MAX_OCR_RECEIPT_REQUEST_BYTES = 4 * 1024;

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

// POST: GitHub Actions 워크플로우 트리거
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

        const requestBody = await readBoundedJsonRequest(request, MAX_OCR_RECEIPT_REQUEST_BYTES);
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
            guardedMutationConfirmation?: string;
        };

        if (!hasGuardedMutationConfirmation(request, body)) {
            return noStoreJson(
                buildGuardedMutationRequiredResponse('ocr_receipt', 'dispatch_workflow'),
                { status: 400 }
            );
        }

        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return NextResponse.json(
                { error: 'GitHub 환경 변수가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

        const correlationId = `ocr-dispatch-${Date.now()}`;

        // GitHub Actions workflow_dispatch 트리거
        const response = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ocr-review-receipts.yml/dispatches`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ref: 'main' }),
            }
        );

        if (!response.ok) {
            await response.text().catch(() => null);
            console.error('[admin/ocr-receipts] guarded mutation dispatch failed', {
                domain: 'ocr_receipt',
                action: 'dispatch_workflow',
                step: 'workflow-dispatch',
                status: response.status,
                correlationId,
            });
            return NextResponse.json(
                { error: `GitHub Actions 트리거 실패: ${response.status}` },
                { status: response.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'OCR 처리가 시작되었습니다.',
            guardedMutation: {
                domain: 'ocr_receipt',
                action: 'dispatch_workflow',
                confirmation: GUARDED_MUTATION_CONFIRMATION,
                readback: {
                    workflowDispatched: true,
                    workflow: 'ocr-review-receipts.yml',
                    ref: 'main',
                },
                audit: {
                    source: 'github-actions-workflow-dispatch',
                    correlationId,
                },
            },
        });

    } catch (err) {
        console.error('[admin/ocr-receipts] guarded mutation dispatch failed', {
            domain: 'ocr_receipt',
            action: 'dispatch_workflow',
            step: 'unexpected',
            errorName: getGuardedMutationErrorName(err),
        });
        return NextResponse.json(
            { error: 'OCR 처리를 시작하지 못했습니다.' },
            { status: 500 }
        );
    }
}

// GET: OCR 처리 상태 조회
export async function GET() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const supabase = createSupabaseServiceRoleClient();

        const { count: pending } = await supabase
            .from('reviews')
            .select('id', { count: 'exact', head: true })
            .is('ocr_processed_at', null)
            .not('verification_photo', 'is', null);

        const { count: duplicate } = await supabase
            .from('reviews')
            .select('id', { count: 'exact', head: true })
            .eq('is_duplicate', true);

        const { count: processed } = await supabase
            .from('reviews')
            .select('id', { count: 'exact', head: true })
            .not('ocr_processed_at', 'is', null);

        return NextResponse.json({
            pending: pending || 0,
            duplicate: duplicate || 0,
            processed: processed || 0
        });

    } catch (err) {
        console.error('[admin/ocr-receipts] status read failed', {
            domain: 'ocr_receipt',
            action: 'status',
            step: 'status-read',
            errorName: getGuardedMutationErrorName(err),
        });
        return NextResponse.json(
            { error: 'OCR 처리 상태를 조회하지 못했습니다.' },
            { status: 500 }
        );
    }
}
