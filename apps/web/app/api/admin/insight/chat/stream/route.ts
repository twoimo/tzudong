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
        } = parseInsightChatRequestBody(await request.json().catch(() => null));
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
            logInsightChatRouteEvent('stream', 'request.invalid_attachment', {
                requestId,
                reason: invalidAttachmentReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_attachment',
                toolTrace: buildInsightChatRouteToolTrace('stream', 'request.invalid_attachment', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('stream', 'fallback');
            recordInsightChatRouteCitationQuality('stream', []);
            recordInsightChatRouteFallbackResponse('stream');

            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'invalid_attachment',
                    content: '첨부 파일 형식이 유효하지 않습니다. txt/csv 파일만 업로드해 주세요.',
                    responseMode,
                    ...(memoryMode ? { memoryMode } : {}),
                    latencyMs,
                    toolTrace,
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (invalidFeedbackReason) {
            logInsightChatRouteEvent('stream', 'request.invalid_feedback', {
                requestId,
                reason: invalidFeedbackReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_feedback',
                toolTrace: buildInsightChatRouteToolTrace('stream', 'request.invalid_feedback', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('stream', 'fallback');
            recordInsightChatRouteCitationQuality('stream', []);
            recordInsightChatRouteFallbackResponse('stream');

            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'invalid_feedback',
                    content: '피드백 형식이 올바르지 않습니다.',
                    responseMode,
                    ...(memoryMode ? { memoryMode } : {}),
                    latencyMs,
                    toolTrace,
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (invalidContextReason) {
            logInsightChatRouteEvent('stream', 'request.invalid_context', {
                requestId,
                reason: invalidContextReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_context',
                toolTrace: buildInsightChatRouteToolTrace('stream', 'request.invalid_context', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('stream', 'fallback');
            recordInsightChatRouteCitationQuality('stream', []);
            recordInsightChatRouteFallbackResponse('stream');

            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'invalid_context',
                    content: '대화 기억 컨텍스트 형식이 올바르지 않습니다.',
                    responseMode,
                    ...(memoryMode ? { memoryMode } : {}),
                    latencyMs,
                    toolTrace,
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (invalidModelReason) {
            logInsightChatRouteEvent('stream', 'request.invalid_model', {
                requestId,
                reason: invalidModelReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_model',
                toolTrace: buildInsightChatRouteToolTrace('stream', 'request.invalid_model', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('stream', 'fallback');
            recordInsightChatRouteCitationQuality('stream', []);
            recordInsightChatRouteFallbackResponse('stream');

        return NextResponse.json(
            buildInsightChatFallbackResponse({
                requestId,
                fallbackReason: 'invalid_model',
                content: 'LLM 설정값이 올바르지 않습니다.',
                responseMode,
                ...(memoryMode ? { memoryMode } : {}),
                latencyMs,
                    toolTrace,
                }),
                { status: 400, headers: CHAT_ROUTE_NO_STORE_HEADERS },
            );
        }

        if (inputPolicyViolationReason) {
            logInsightChatRouteEvent('stream', 'request.policy_blocked', {
                requestId,
                reason: inputPolicyViolationReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs,
                fallbackReason: 'policy_rejection',
                toolTrace: buildInsightChatRouteToolTrace('stream', 'request.policy_blocked', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('stream', 'fallback');
            recordInsightChatRouteCitationQuality('stream', []);
            recordInsightChatRouteFallbackResponse('stream');

            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'policy_rejection',
                    content: '해당 메시지는 보안 정책상 처리할 수 없습니다.',
                    responseMode,
                    ...(memoryMode ? { memoryMode } : {}),
                    latencyMs,
                    toolTrace,
                }),
                {
                    status: 400,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        if (!message.trim()) {
            logInsightChatRouteEvent('stream', 'request.empty_input', { requestId });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId,
                latencyMs,
                fallbackReason: 'empty_input',
                toolTrace: buildInsightChatRouteToolTrace('stream', 'request.empty_input', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('stream', 'fallback');
            recordInsightChatRouteCitationQuality('stream', []);
            recordInsightChatRouteFallbackResponse('stream');
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'empty_input',
                    error: 'empty_input',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
                    responseMode,
                    confidence: 0.85,
                    ...(memoryMode ? { memoryMode } : {}),
                    latencyMs,
                    toolTrace,
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
            streamAdminInsightChat(
                message,
                llmConfig,
                request.signal,
                requestId,
                responseMode,
                memoryMode,
                feedbackContext,
                attachments,
                contextMessages,
                memoryProfileNote,
            ),
            new Promise<typeof timedOut>((resolve) => {
                setTimeout(() => resolve(timedOut), timeoutMs);
            }),
        ]);

        if (result === timedOut) {
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
