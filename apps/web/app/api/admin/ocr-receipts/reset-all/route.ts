/**
 * 전체 리뷰 OCR 초기화 및 재실행 API
 * 
 * POST /api/admin/ocr-receipts/reset-all
 * - 모든 리뷰의 OCR 데이터를 초기화하고 GitHub Actions 워크플로우 트리거
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

export const runtime = 'nodejs';

// 환경 변수
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const GITHUB_REPO = process.env.GITHUB_REPO!;

const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화';

export async function POST(request: Request) {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        let body: { confirmation?: string } = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }

        if (body.confirmation !== OCR_RESET_ALL_CONFIRMATION) {
            return NextResponse.json(
                { error: 'OCR 전체 초기화 확인 문구가 일치하지 않습니다.' },
                { status: 400 }
            );
        }

        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return NextResponse.json(
                { error: 'GitHub 환경 변수가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

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
            console.error('GitHub Actions 사전 확인 실패:', workflowPreflightResponse.status);
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
            console.error('OCR 초기화 실패:', resetError);
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
            console.error('GitHub API 오류:', response.status);
            return NextResponse.json(
                {
                    error: `GitHub Actions 트리거 실패: ${response.status}`,
                    partialFailure: true,
                    resetApplied: true,
                    readbackRequired: true,
                },
                { status: response.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: `모든 리뷰(${count || 0}개)의 OCR을 초기화하고 재실행을 시작했습니다.`,
        });

    } catch (err) {
        console.error('OCR 전체 재실행 오류:', err);
        return NextResponse.json(
            { error: 'OCR 전체 재실행을 시작하지 못했습니다.' },
            { status: 500 }
        );
    }
}
