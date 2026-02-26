/**
 * 리뷰 영수증 OCR GitHub Actions 트리거 API
 * 
 * POST /api/admin/ocr-receipts - GitHub Actions 워크플로우 트리거
 * GET /api/admin/ocr-receipts - OCR 처리 상태 조회
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

// POST: GitHub Actions 워크플로우 트리거
export async function POST() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return NextResponse.json(
                { error: 'GitHub 환경 변수가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

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
            const errorText = await response.text();
            console.error('GitHub API 오류:', response.status, errorText);
            return NextResponse.json(
                { error: `GitHub Actions 트리거 실패: ${response.status}` },
                { status: response.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'OCR 처리가 시작되었습니다.'
        });

    } catch (err) {
        console.error('OCR 트리거 오류:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

// GET: OCR 처리 상태 조회
export async function GET() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { count: pending } = await supabase
            .from('reviews')
            .select('*', { count: 'exact', head: true })
            .is('ocr_processed_at', null)
            .not('verification_photo', 'is', null);

        const { count: duplicate } = await supabase
            .from('reviews')
            .select('*', { count: 'exact', head: true })
            .eq('is_duplicate', true);

        const { count: processed } = await supabase
            .from('reviews')
            .select('*', { count: 'exact', head: true })
            .not('ocr_processed_at', 'is', null);

        return NextResponse.json({
            pending: pending || 0,
            duplicate: duplicate || 0,
            processed: processed || 0
        });

    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
