import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { streamAdminInsightChat } from '@/lib/insight/chat';
import {
    CHAT_ROUTE_NO_STORE_HEADERS,
    INSIGHT_CHAT_FALLBACK_CONTENTS,
    buildInsightChatRouteToolTrace,
    buildInsightChatFallbackResponse,
    recordInsightChatRouteRequest,
    deriveInsightChatCitationQuality,
    recordInsightChatRouteProviderRequest,
    recordInsightChatRouteResponseMode,
    recordInsightChatRouteMemoryMode,
    recordInsightChatRouteFeedback,
    recordInsightChatRouteCitationQuality,
    recordInsightChatRouteResponseSource,
    recordInsightChatRouteFallbackResponse,
    recordInsightChatRouteStreamResponse,
    recordInsightChatRouteErrorResponse,
    evaluateInsightChatRouteGuardrails,
    logInsightChatRouteEvent,
} from '@/lib/insight/insight-chat-route-utils';
import { parseInsightChatRequestBody } from '@/lib/insight/insight-chat-request';
import { buildInsightChatRejectedRequestFallbackResponse } from '../request-fallback-response';

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
    let memoryMode: 'off' | 'session' | 'pinned' = 'off';
    const startedAt = Date.now();
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        const parsedBody = await request.json().catch(() => null) as Record<string, unknown> | null;
        const {
            message,
            requestId: parsedRequestId,
            llmConfig,
            responseMode: parsedResponseMode,
            memoryMode: parsedMemoryMode,
            memoryProfileNote,
            attachments,
            contextMessages,
            feedbackContext,
            invalidFeedbackReason,
            inputPolicyViolationReason,
            invalidAttachmentReason,
            invalidContextReason,
            invalidModelReason,
        } = parseInsightChatRequestBody(parsedBody);
        responseMode = parsedResponseMode;
        memoryMode = parsedMemoryMode ?? 'off';
        requestId = parsedRequestId;
        recordInsightChatRouteRequest('stream');
        recordInsightChatRouteResponseMode('stream', responseMode);
        recordInsightChatRouteMemoryMode('stream', memoryMode);
        recordInsightChatRouteFeedback('stream', feedbackContext);
        const provider = llmConfig?.provider;
        recordInsightChatRouteProviderRequest('stream', provider);
        logInsightChatRouteEvent('stream', 'request.parsed', {
            requestId,
            hasLlmConfig: !!llmConfig,
        });

        if (invalidAttachmentReason) {
            return buildInsightChatRejectedRequestFallbackResponse({
                route: 'stream',
                requestId,
                responseMode,
                memoryMode,
                latencyMs: getElapsedMs(startedAt),
                event: 'request.invalid_attachment',
                fallbackReason: 'invalid_attachment',
                content: '첨부 파일 형식이 유효하지 않습니다. txt/csv 파일만 업로드해 주세요.',
                reason: invalidAttachmentReason,
            });
        }

        if (invalidFeedbackReason) {
            return buildInsightChatRejectedRequestFallbackResponse({
                route: 'stream',
                requestId,
                responseMode,
                memoryMode,
                latencyMs: getElapsedMs(startedAt),
                event: 'request.invalid_feedback',
                fallbackReason: 'invalid_feedback',
                content: '피드백 형식이 올바르지 않습니다.',
                reason: invalidFeedbackReason,
            });
        }

        if (invalidContextReason) {
            return buildInsightChatRejectedRequestFallbackResponse({
                route: 'stream',
                requestId,
                responseMode,
                memoryMode,
                latencyMs: getElapsedMs(startedAt),
                event: 'request.invalid_context',
                fallbackReason: 'invalid_context',
                content: '대화 기억 컨텍스트 형식이 올바르지 않습니다.',
                reason: invalidContextReason,
            });
        }

        if (invalidModelReason) {
            return buildInsightChatRejectedRequestFallbackResponse({
                route: 'stream',
                requestId,
                responseMode,
                memoryMode,
                latencyMs: getElapsedMs(startedAt),
                event: 'request.invalid_model',
                fallbackReason: 'invalid_model',
                content: 'LLM 설정값이 올바르지 않습니다.',
                reason: invalidModelReason,
            });
        }

        if (inputPolicyViolationReason) {
            return buildInsightChatRejectedRequestFallbackResponse({
                route: 'stream',
                requestId,
                responseMode,
                memoryMode,
                latencyMs: getElapsedMs(startedAt),
                event: 'request.policy_blocked',
                fallbackReason: 'policy_rejection',
                content: '해당 메시지는 보안 정책상 처리할 수 없습니다.',
                reason: inputPolicyViolationReason,
            });
        }

        if (!message.trim()) {
            return buildInsightChatRejectedRequestFallbackResponse({
                route: 'stream',
                requestId,
                responseMode,
                memoryMode,
                latencyMs: getElapsedMs(startedAt),
                event: 'request.empty_input',
                fallbackReason: 'empty_input',
                error: 'empty_input',
                content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
                confidence: 0.85,
            });
        }

        const timeoutMs = getStreamRouteTimeoutMs();
        const timedOut = { kind: 'insight-chat-stream-route-timeout' } as const;
        const routeAbortController = new AbortController();
        let didRouteTimeout = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const onRequestAbort = () => {
            routeAbortController.abort();
        };

        if (request.signal.aborted) {
            routeAbortController.abort();
        } else {
            request.signal.addEventListener('abort', onRequestAbort, { once: true });
        }

        try {
            const result: Awaited<ReturnType<typeof streamAdminInsightChat>> | typeof timedOut = await Promise.race([
                streamAdminInsightChat(
                    message,
                    llmConfig,
                    routeAbortController.signal,
                    requestId,
                    responseMode,
                    memoryMode,
                    feedbackContext,
                    attachments,
                    contextMessages,
                    memoryProfileNote,
                ).catch((error) => {
                    if (didRouteTimeout) {
                        return timedOut;
                    }
                    throw error;
                }),
                new Promise<typeof timedOut>((resolve) => {
                    timeoutHandle = setTimeout(() => {
                        didRouteTimeout = true;
                        routeAbortController.abort();
                        resolve(timedOut);
                    }, timeoutMs);
                }),
            ]);

            if ('kind' in result) {
                logInsightChatRouteEvent('stream', 'response.route_timeout', { requestId, timeoutMs });
                const latencyMs = getElapsedMs(startedAt);
                const { toolTrace } = evaluateInsightChatRouteGuardrails({
                    route: 'stream',
                    requestId,
                    latencyMs,
                    fallbackReason: 'route_timeout',
                    toolTrace: buildInsightChatRouteToolTrace('stream', 'request.timeout', memoryMode),
                });
                recordInsightChatRouteErrorResponse('stream');
                recordInsightChatRouteResponseSource('stream', 'fallback');
                recordInsightChatRouteCitationQuality('stream', []);
                return NextResponse.json(
                    buildInsightChatFallbackResponse({
                        requestId,
                        fallbackReason: 'route_timeout',
                        content: INSIGHT_CHAT_FALLBACK_CONTENTS.streamError,
                        responseMode,
                        ...(memoryMode ? { memoryMode } : {}),
                        latencyMs,
                        toolTrace,
                    }),
                    { status: 200, headers: CHAT_ROUTE_NO_STORE_HEADERS },
                );
            }

            if ('local' in result) {
                logInsightChatRouteEvent('stream', 'response.local_fallback', { requestId });
                const latencyMs = getElapsedMs(startedAt);
                const fallbackReason = result.local.meta?.source === 'fallback'
                    ? result.local.meta?.fallbackReason
                    : undefined;
                recordInsightChatRouteFallbackResponse('stream');
                recordInsightChatRouteResponseSource('stream', 'local');
                recordInsightChatRouteCitationQuality('stream', result.local.sources);
                const { toolTrace } = evaluateInsightChatRouteGuardrails({
                    route: 'stream',
                    requestId,
                    latencyMs,
                    fallbackReason,
                    toolTrace: [...(result.local.meta?.toolTrace ?? []), `memoryMode:${memoryMode}`],
                });
                return NextResponse.json({
                    ...result.local,
                    meta: {
                        ...(result.local.meta ?? { source: 'fallback' }),
                        latencyMs,
                        ...(memoryMode ? { memoryMode } : {}),
                        citationQuality: deriveInsightChatCitationQuality(result.local.sources),
                        ...(toolTrace.length > 0 ? { toolTrace } : {}),
                    },
                }, {
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                });
            }

            logInsightChatRouteEvent('stream', 'response.stream', { requestId });
            recordInsightChatRouteStreamResponse('stream');
            recordInsightChatRouteResponseSource('stream', 'agent');
            evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs: getElapsedMs(startedAt),
                toolTrace: buildInsightChatRouteToolTrace('stream', 'response.stream', memoryMode),
            });
            return new Response(result.stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                },
            });
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            request.signal.removeEventListener('abort', onRequestAbort);
        }
    } catch (error) {
        logInsightChatRouteEvent('stream', 'request.failed', {
            requestId,
            error: error instanceof Error ? error.message : 'unknown',
        });
        console.error('[admin/insight/chat/stream] failed:', error);
        const latencyMs = getElapsedMs(startedAt);
        const { toolTrace } = evaluateInsightChatRouteGuardrails({
            route: 'stream',
            requestId,
            latencyMs,
            fallbackReason: 'stream_error',
            toolTrace: buildInsightChatRouteToolTrace('stream', 'request.failed', memoryMode),
        });
        recordInsightChatRouteErrorResponse('stream');
        recordInsightChatRouteResponseSource('stream', 'fallback');
        recordInsightChatRouteCitationQuality('stream', []);
        return NextResponse.json(
            buildInsightChatFallbackResponse({
                requestId,
                fallbackReason: 'stream_error',
                content: INSIGHT_CHAT_FALLBACK_CONTENTS.streamError,
                responseMode,
                ...(memoryMode ? { memoryMode } : {}),
                latencyMs,
                toolTrace,
            }),
            { status: 200, headers: CHAT_ROUTE_NO_STORE_HEADERS },
        );
    }
}
