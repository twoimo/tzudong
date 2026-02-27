import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

/**
 * 서버에 설정된 Gemini 환경변수 키 존재 여부만 반환합니다.
 * raw key 값은 노출되지 않습니다.
 */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const hasGeminiServerKey =
        process.env.GEMINI_OCR_YEON?.trim()
        || process.env.STORYBOARD_AGENT_GEMINI_API_KEY?.trim()
        || process.env.GEMINI_API_KEY?.trim()
        || process.env.GOOGLE_API_KEY?.trim()
        ? true
        : false;

    return NextResponse.json(
        { hasGeminiServerKey },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
