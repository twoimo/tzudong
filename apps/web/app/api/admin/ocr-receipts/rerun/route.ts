/**
 * 단일 리뷰 OCR 재실행 API
 * 
 * POST /api/admin/ocr-receipts/rerun
 * - 해당 리뷰의 OCR 데이터를 초기화하고 GitHub Actions 워크플로우 트리거
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

// 환경 변수
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const GITHUB_REPO = process.env.GITHUB_REPO!;

export async function POST(request: Request) {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const { reviewId } = await request.json();

        if (!reviewId) {
            return NextResponse.json(
                { error: '리뷰 ID가 필요합니다.' },
                { status: 400 }
            );
        }

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
            console.error('GitHub OCR workflow preflight failed:', workflowPreflightResponse.status);
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
            console.error('OCR 초기화 실패:', updateError);
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
            console.error('GitHub API 오류:', response.status);
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
                },
                { status: response.status === 401 || response.status === 403 ? 502 : response.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'OCR 재실행이 시작되었습니다. 약 30~40초 후 결과가 반영됩니다.',
            reviewId,
        });

    } catch (err) {
        console.error('OCR 재실행 오류:', err);
        return NextResponse.json(
            { error: 'OCR 재실행을 시작하지 못했습니다.' },
            { status: 500 }
        );
    }
}
