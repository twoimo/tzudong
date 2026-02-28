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

const DEFAULT_STREAM_ROUTE_TIMEOUT_MS = 35_000;

function getStreamRouteTimeoutMs(): number {
    const raw = Number(process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_STREAM_ROUTE_TIMEOUT_MS;
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
        logInsightChatRouteEvent('stream', 'request.parsed', {
            requestId,
            hasLlmConfig: !!llmConfig,
        });

        if (invalidAttachmentReason) {
            logInsightChatRouteEvent('stream', 'request.invalid_attachment', {
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
                    toolTrace: ['route:stream', 'request.invalid_attachment'],
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (inputPolicyViolationReason) {
            logInsightChatRouteEvent('stream', 'request.policy_blocked', {
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
                    toolTrace: ['route:stream', 'request.policy_blocked'],
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (!message.trim()) {
            logInsightChatRouteEvent('stream', 'request.empty_input', { requestId });
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'empty_input',
                    error: 'empty_input',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
                    responseMode,
                    confidence: 0.85,
                    latencyMs: getElapsedMs(startedAt),
                    toolTrace: ['route:stream', 'request.empty_input'],
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        const timeoutMs = getStreamRouteTimeoutMs();
        const timedOut = Symbol('insight-chat-stream-route-timeout');
        const result = await Promise.race([
            streamAdminInsightChat(message, llmConfig, request.signal, requestId, responseMode, feedbackContext, attachments),
            new Promise<typeof timedOut>((resolve) => {
                setTimeout(() => resolve(timedOut), timeoutMs);
            }),
        ]);

        if (result === timedOut) {
            logInsightChatRouteEvent('stream', 'response.route_timeout', { requestId, timeoutMs });
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'route_timeout',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.streamError,
                    responseMode,
                    latencyMs: getElapsedMs(startedAt),
                    toolTrace: ['route:stream', 'request.timeout'],
                }),
                { status: 200, headers: CHAT_ROUTE_NO_STORE_HEADERS },
            );
        }

        if ('local' in result) {
            logInsightChatRouteEvent('stream', 'response.local_fallback', { requestId });
            return NextResponse.json({
                ...result.local,
                meta: {
                    ...(result.local.meta ?? { source: 'fallback' }),
                    latencyMs: getElapsedMs(startedAt),
                },
            }, {
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
                responseMode,
                latencyMs: getElapsedMs(startedAt),
                toolTrace: ['route:stream', 'request.failed'],
            }),
            { status: 200, headers: CHAT_ROUTE_NO_STORE_HEADERS },
        );
    }
}
