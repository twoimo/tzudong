import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { streamAdminInsightChat } from '@/lib/insight/chat';
import {
    CHAT_ROUTE_NO_STORE_HEADERS,
    INSIGHT_CHAT_FALLBACK_CONTENTS,
    buildInsightChatFallbackResponse,
    logInsightChatRouteEvent,
} from '@/lib/insight/insight-chat-route-utils';
import { parseInsightChatRequestBody } from '@/lib/insight/insight-chat-request';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    let requestId: string | undefined;
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const { message, requestId: parsedRequestId, llmConfig } = parseInsightChatRequestBody(await request.json().catch(() => null));
        requestId = parsedRequestId;
        logInsightChatRouteEvent('stream', 'request.parsed', {
            requestId,
            hasLlmConfig: !!llmConfig,
        });

        if (!message.trim()) {
            logInsightChatRouteEvent('stream', 'request.empty_input', { requestId });
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'empty_input',
                    error: 'empty_input',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        const result = await streamAdminInsightChat(message, llmConfig, request.signal, requestId);

        if ('local' in result) {
            logInsightChatRouteEvent('stream', 'response.local_fallback', { requestId });
            return NextResponse.json(result.local, {
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            });
        }

        logInsightChatRouteEvent('stream', 'response.stream', { requestId });
        return new Response(result.stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });
    } catch (error) {
        logInsightChatRouteEvent('stream', 'request.failed', {
            requestId,
            error: error instanceof Error ? error.message : 'unknown',
        });
        console.error('[admin/insight/chat/stream] failed:', error);
        return NextResponse.json(
            buildInsightChatFallbackResponse({
                requestId,
                fallbackReason: 'stream_error',
                content: INSIGHT_CHAT_FALLBACK_CONTENTS.streamError,
            }),
            { status: 200, headers: CHAT_ROUTE_NO_STORE_HEADERS },
        );
    }
}
