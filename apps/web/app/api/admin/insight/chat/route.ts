import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { answerAdminInsightChat } from '@/lib/insight/chat';

export const runtime = 'nodejs';

function fallbackResponse() {
  return {
    asOf: new Date().toISOString(),
    content: '지금은 챗봇 응답을 즉시 반환하기 어려워요. 잠시 후 다시 시도해 주세요.',
    meta: {
      source: 'fallback',
      fallbackReason: 'server_error',
    },
    sources: [],
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const message = typeof body?.message === 'string' ? body.message : '';
    if (!message.trim()) {
      return NextResponse.json({
        asOf: new Date().toISOString(),
        content: '질문을 입력해 주세요.',
        meta: {
          source: 'fallback',
          fallbackReason: 'empty_input',
        },
        sources: [],
      }, { status: 400 });
    }

    const data = await answerAdminInsightChat(message);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin/insight/chat] failed:', error);
    return NextResponse.json(fallbackResponse(), { status: 200 });
  }
}

