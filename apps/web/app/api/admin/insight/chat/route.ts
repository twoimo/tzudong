import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { answerAdminInsightChat } from '@/lib/insight/chat';
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
        logInsightChatRouteEvent('chat', 'request.parsed', {
            requestId,
            hasLlmConfig: !!llmConfig,
        });

        if (!message.trim()) {
            logInsightChatRouteEvent('chat', 'request.empty_input', { requestId });
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'empty_input',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        const data = await answerAdminInsightChat(message, llmConfig, requestId);
        logInsightChatRouteEvent('chat', 'response.success', { requestId });
        return NextResponse.json(data, {
            headers: CHAT_ROUTE_NO_STORE_HEADERS,
        });
    } catch (error) {
        logInsightChatRouteEvent('chat', 'request.failed', {
            requestId,
            error: error instanceof Error ? error.message : 'unknown',
        });
        console.error('[admin/insight/chat] failed:', error);
        return NextResponse.json(
            buildInsightChatFallbackResponse({
                requestId,
                fallbackReason: 'server_error',
                content: INSIGHT_CHAT_FALLBACK_CONTENTS.serverError,
            }),
            {
                status: 200,
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    }
}
