import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { answerAdminInsightChat } from '@/lib/insight/chat';
import {
    CHAT_ROUTE_NO_STORE_HEADERS,
    INSIGHT_CHAT_FALLBACK_CONTENTS,
    buildInsightChatRouteToolTrace,
    buildInsightChatFallbackResponse,
    deriveInsightChatCitationQuality,
    recordInsightChatRouteProviderRequest,
    recordInsightChatRouteRequest,
    recordInsightChatRouteResponseMode,
    recordInsightChatRouteMemoryMode,
    recordInsightChatRouteFeedback,
    recordInsightChatRouteCitationQuality,
    recordInsightChatRouteResponseSource,
    recordInsightChatRouteSuccessResponse,
    recordInsightChatRouteFallbackResponse,
    recordInsightChatRouteErrorResponse,
    evaluateInsightChatRouteGuardrails,
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
        } = parseInsightChatRequestBody(await request.json().catch(() => null));
        responseMode = parsedResponseMode;
        memoryMode = parsedMemoryMode ?? 'off';
        requestId = parsedRequestId;
        recordInsightChatRouteRequest('chat');
        recordInsightChatRouteResponseMode('chat', responseMode);
        recordInsightChatRouteMemoryMode('chat', memoryMode);
        recordInsightChatRouteFeedback('chat', feedbackContext);
        const provider = llmConfig?.provider;
        recordInsightChatRouteProviderRequest('chat', provider);
        logInsightChatRouteEvent('chat', 'request.parsed', {
            requestId,
            hasLlmConfig: !!llmConfig,
        });

        if (invalidAttachmentReason) {
            logInsightChatRouteEvent('chat', 'request.invalid_attachment', {
                requestId,
                reason: invalidAttachmentReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_attachment',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.invalid_attachment', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
            recordInsightChatRouteFallbackResponse('chat');

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
            logInsightChatRouteEvent('chat', 'request.invalid_feedback', {
                requestId,
                reason: invalidFeedbackReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_feedback',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.invalid_feedback', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
            recordInsightChatRouteFallbackResponse('chat');

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
            logInsightChatRouteEvent('chat', 'request.invalid_context', {
                requestId,
                reason: invalidContextReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'invalid_context',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.invalid_context', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
            recordInsightChatRouteFallbackResponse('chat');

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

        if (inputPolicyViolationReason) {
            logInsightChatRouteEvent('chat', 'request.policy_blocked', {
                requestId,
                reason: inputPolicyViolationReason,
            });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'policy_rejection',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.policy_blocked', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
            recordInsightChatRouteFallbackResponse('chat');

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
            logInsightChatRouteEvent('chat', 'request.empty_input', { requestId });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'empty_input',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.empty_input', memoryMode),
                skipLatencyBudgetCheck: true,
            });
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
            recordInsightChatRouteFallbackResponse('chat');
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'empty_input',
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

        const timeoutMs = getChatRouteTimeoutMs();
        const timedOut = Symbol('insight-chat-route-timeout');
            const data = await Promise.race([
            answerAdminInsightChat(
                message,
                llmConfig,
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

        if (data === timedOut) {
            logInsightChatRouteEvent('chat', 'response.route_timeout', { requestId, timeoutMs });
            const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'route_timeout',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.timeout', memoryMode),
            });
            recordInsightChatRouteErrorResponse('chat');
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
            return NextResponse.json(
                buildInsightChatFallbackResponse({
                    requestId,
                    fallbackReason: 'route_timeout',
                    content: INSIGHT_CHAT_FALLBACK_CONTENTS.serverError,
                    responseMode,
                    ...(memoryMode ? { memoryMode } : {}),
                    latencyMs,
                    toolTrace,
                }),
                {
                    status: 200,
                    headers: CHAT_ROUTE_NO_STORE_HEADERS,
                },
            );
        }

        logInsightChatRouteEvent('chat', 'response.success', { requestId });
        const latencyMs = getElapsedMs(startedAt);
        const fallbackReason = data.meta?.source === 'fallback' ? data.meta?.fallbackReason : undefined;
            const responseSource = data.meta?.source ?? 'fallback';
            recordInsightChatRouteResponseSource('chat', responseSource);
            recordInsightChatRouteCitationQuality('chat', data.sources);
            if (responseSource === 'fallback') {
                recordInsightChatRouteFallbackResponse('chat');
            } else {
                recordInsightChatRouteSuccessResponse('chat');
            }
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
            fallbackReason,
            toolTrace: [...(data.meta?.toolTrace ?? []), `memoryMode:${memoryMode}`],
        });
        return NextResponse.json({
            ...data,
            meta: {
                ...(data.meta ?? { source: 'fallback' }),
                latencyMs,
                ...(memoryMode ? { memoryMode } : {}),
                citationQuality: deriveInsightChatCitationQuality(data.sources),
                ...(toolTrace.length > 0 ? { toolTrace } : {}),
            },
        }, {
            headers: CHAT_ROUTE_NO_STORE_HEADERS,
        });
    } catch (error) {
        logInsightChatRouteEvent('chat', 'request.failed', {
            requestId,
                error: error instanceof Error ? error.message : 'unknown',
            });
            recordInsightChatRouteErrorResponse('chat');
            console.error('[admin/insight/chat] failed:', error);
        const latencyMs = getElapsedMs(startedAt);
            const { toolTrace } = evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId,
                latencyMs,
                fallbackReason: 'server_error',
                toolTrace: buildInsightChatRouteToolTrace('chat', 'request.failed', memoryMode),
            });
            recordInsightChatRouteResponseSource('chat', 'fallback');
            recordInsightChatRouteCitationQuality('chat', []);
        return NextResponse.json(
            buildInsightChatFallbackResponse({
                requestId,
                fallbackReason: 'server_error',
                content: INSIGHT_CHAT_FALLBACK_CONTENTS.serverError,
                responseMode,
                latencyMs,
                toolTrace,
            }),
            {
                status: 200,
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    }
}
