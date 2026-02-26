/**
 * 단일 리뷰 OCR 재실행 API
 * 
 * POST /api/admin/ocr-receipts/rerun
 * - 해당 리뷰의 OCR 데이터를 초기화하고 GitHub Actions 워크플로우 트리거
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

// 환경 변수
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. 리뷰 존재 여부 확인
        const { data: review, error: fetchError } = await supabase
            .from('reviews')
            .select('id, verification_photo')
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

        // 2. OCR 데이터 초기화 (재처리 대상으로 만들기)
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
                { error: `OCR 초기화 실패: ${updateError.message}` },
                { status: 500 }
            );
        }

        // 3. GitHub Actions 워크플로우 트리거
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return NextResponse.json(
                { error: 'GitHub 환경 변수가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

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
            const errorText = await response.text();
            console.error('GitHub API 오류:', response.status, errorText);
            return NextResponse.json(
                { error: `GitHub Actions 트리거 실패: ${response.status}` },
                { status: response.status }
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
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
