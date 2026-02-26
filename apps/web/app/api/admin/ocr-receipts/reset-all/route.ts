/**
 * 전체 리뷰 OCR 초기화 및 재실행 API
 * 
 * POST /api/admin/ocr-receipts/reset-all
 * - 모든 리뷰의 OCR 데이터를 초기화하고 GitHub Actions 워크플로우 트리거
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

export async function POST() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. 영수증 사진이 있는 리뷰 수 조회
        const { count } = await supabase
            .from('reviews')
            .select('*', { count: 'exact', head: true })
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
                { error: `OCR 초기화 실패: ${resetError.message}` },
                { status: 500 }
            );
        }

        // 2. GitHub Actions 워크플로우 트리거
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
                body: JSON.stringify({ ref: 'main' }),
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
            message: `모든 리뷰(${count || 0}개)의 OCR을 초기화하고 재실행을 시작했습니다.`,
        });

    } catch (err) {
        console.error('OCR 전체 재실행 오류:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
