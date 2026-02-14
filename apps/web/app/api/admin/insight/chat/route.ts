import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { answerAdminInsightChat } from '@/lib/insight/chat';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const message = typeof body?.message === 'string' ? body.message : '';

    const data = await answerAdminInsightChat(message);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin/insight/chat] failed:', error);
    return NextResponse.json(
      { error: 'Failed to answer insight chat.' },
      { status: 500 },
    );
  }
}

