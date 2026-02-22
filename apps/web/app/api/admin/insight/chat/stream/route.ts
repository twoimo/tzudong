import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { streamAdminInsightChat } from '@/lib/insight/chat';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const body = await request.json().catch(() => null);
        const message = typeof body?.message === 'string' ? body.message : '';
        if (!message.trim()) {
            return NextResponse.json(
                { error: 'empty_input', content: '질문을 입력해 주세요.' },
                { status: 400, headers: { 'Cache-Control': 'no-store' } },
            );
        }

        const provider = typeof body?.provider === 'string' ? body.provider : undefined;
        const model = typeof body?.model === 'string' ? body.model : undefined;
        const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : undefined;
        const storyboardModelProfile = typeof body?.storyboardModelProfile === 'string'
            ? body.storyboardModelProfile
            : undefined;
        const imageModelProfile = typeof body?.imageModelProfile === 'string'
            ? body.imageModelProfile
            : undefined;
        const resolvedImageModelProfile = imageModelProfile === 'nanobanana_pro' || imageModelProfile === 'nanobanana'
            ? imageModelProfile
            : undefined;

        const llmConfig = provider && model && apiKey
            ? {
                provider: provider as 'gemini' | 'openai' | 'anthropic',
                model,
                apiKey,
                storyboardModelProfile:
                    storyboardModelProfile === 'nanobanana_pro' || storyboardModelProfile === 'nanobanana'
                        ? storyboardModelProfile
                        : undefined,
                imageModelProfile: resolvedImageModelProfile,
            }
            : undefined;

        const result = await streamAdminInsightChat(message, llmConfig);

        if ('local' in result) {
            return NextResponse.json(result.local, {
                headers: { 'Cache-Control': 'no-store' },
            });
        }

        return new Response(result.stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });
    } catch (error) {
        console.error('[admin/insight/chat/stream] failed:', error);
        return NextResponse.json(
            {
                asOf: new Date().toISOString(),
                content: '스트리밍 응답 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
                meta: { source: 'fallback', fallbackReason: 'stream_error' },
                sources: [],
            },
            { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
    }
}
