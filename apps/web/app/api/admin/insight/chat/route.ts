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

const DEFAULT_CHAT_ROUTE_TIMEOUT_MS = 25_000;

function getChatRouteTimeoutMs(): number {
    const raw = Number(process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CHAT_ROUTE_TIMEOUT_MS;
}

function getElapsedMs(startedAt: number): number {
    return Math.max(0, Date.now() - startedAt);
}

export async function POST(request: NextRequest) {
    let requestId: string | undefined;
    let responseMode: 'fast' | 'deep' | 'structured' | undefined;
    const startedAt = Date.now();
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const {
            message,
            requestId: parsedRequestId,
            llmConfig,
            responseMode: parsedResponseMode,
            attachments,
            feedbackContext,
            inputPolicyViolationReason,
            invalidAttachmentReason,
        } = parseInsightChatRequestBody(await request.json().catch(() => null));
        responseMode = parsedResponseMode;
        requestId = parsedRequestId;
        logInsightChatRouteEvent('chat', 'request.parsed', {
            requestId,
            hasLlmConfig: !!llmConfig,
        });

        if (invalidAttachmentReason) {
            logInsightChatRouteEvent('chat', 'request.invalid_attachment', {
                requestId,
                reason: invalidAttachmentReason,
            });

            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'invalid_attachment',
                    content: '첨부 파일 형식이 유효하지 않습니다. txt/csv 파일만 업로드해 주세요.',
                    responseMode,
                    latencyMs: getElapsedMs(startedAt),
                    toolTrace: ['route:chat', 'request.invalid_attachment'],
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (inputPolicyViolationReason) {
            logInsightChatRouteEvent('chat', 'request.policy_blocked', {
                requestId,
                reason: inputPolicyViolationReason,
            });

            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'policy_rejection',
                    content: '해당 메시지는 보안 정책상 처리할 수 없습니다.',
                    responseMode,
                    latencyMs: getElapsedMs(startedAt),
                    toolTrace: ['route:chat', 'request.policy_blocked'],
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (!message.trim()) {
            logInsightChatRouteEvent('chat', 'request.empty_input', { requestId });
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'empty_input',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
                    responseMode,
                    confidence: 0.85,
                    latencyMs: getElapsedMs(startedAt),
                    toolTrace: ['route:chat', 'request.empty_input'],
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        const timeoutMs = getChatRouteTimeoutMs();
        const timedOut = Symbol('insight-chat-route-timeout');
        const data = await Promise.race([
            answerAdminInsightChat(message, llmConfig, requestId, responseMode, feedbackContext, attachments),
            new Promise<typeof timedOut>((resolve) => {
                setTimeout(() => resolve(timedOut), timeoutMs);
            }),
        ]);

        if (data === timedOut) {
            logInsightChatRouteEvent('chat', 'response.route_timeout', { requestId, timeoutMs });
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'route_timeout',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.serverError,
                    responseMode,
                    latencyMs: getElapsedMs(startedAt),
                    toolTrace: ['route:chat', 'request.timeout'],
                }),
                {
                    status: 200,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        logInsightChatRouteEvent('chat', 'response.success', { requestId });
        return NextResponse.json({
            ...data,
            meta: {
                ...(data.meta ?? { source: 'fallback' }),
                latencyMs: getElapsedMs(startedAt),
            },
        }, {
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
                responseMode,
                latencyMs: getElapsedMs(startedAt),
                toolTrace: ['route:chat', 'request.failed'],
            }),
            {
                status: 200,
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    }
}
