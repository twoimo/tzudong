import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

/** 서버에 설정된 Gemini 환경변수 키를 관리자에게 반환 */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const envKey = process.env.GEMINI_OCR_YEON?.trim() || '';

    return NextResponse.json(
        { geminiEnvKey: envKey || null },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
