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
      return NextResponse.json(
        {
          asOf: new Date().toISOString(),
          content: '질문을 입력해 주세요.',
          meta: {
            source: 'fallback',
            fallbackReason: 'empty_input',
          },
          sources: [],
        },
        {
          status: 400,
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const provider = typeof body?.provider === 'string' ? body.provider : undefined;
    const model = typeof body?.model === 'string' ? body.model : undefined;
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : undefined;
    const useServerKey = body?.useServerKey === true;
    const storyboardModelProfile = typeof body?.storyboardModelProfile === 'string'
      ? body.storyboardModelProfile
      : undefined;
    const imageModelProfile = typeof body?.imageModelProfile === 'string'
      ? body.imageModelProfile
      : undefined;
    const resolvedImageModelProfile = imageModelProfile === 'nanobanana_pro' || imageModelProfile === 'nanobanana'
      ? imageModelProfile
      : undefined;

    const normalizedProvider = provider === 'gemini' || provider === 'openai' || provider === 'anthropic'
      ? provider
      : undefined;
    const shouldUseServerKey = useServerKey || (normalizedProvider === 'gemini' && !apiKey);
    const llmConfig = normalizedProvider && model
      ? {
        provider: normalizedProvider,
        model,
        apiKey,
        useServerKey: shouldUseServerKey,
        storyboardModelProfile: storyboardModelProfile === 'nanobanana_pro' || storyboardModelProfile === 'nanobanana'
          ? storyboardModelProfile
          : undefined,
        imageModelProfile: resolvedImageModelProfile,
      }
      : undefined;

    const data = await answerAdminInsightChat(message, llmConfig);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[admin/insight/chat] failed:', error);
    return NextResponse.json(fallbackResponse(), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
}

