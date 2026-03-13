import { NextResponse } from 'next/server';
import {
    CHAT_ROUTE_NO_STORE_HEADERS,
    buildInsightChatRouteToolTrace,
    buildInsightChatFallbackResponse,
    evaluateInsightChatRouteGuardrails,
    logInsightChatRouteEvent,
    recordInsightChatRouteCitationQuality,
    recordInsightChatRouteResponseSource,
    recordInsightChatRouteFallbackResponse,
    type InsightChatRouteEvent,
    type InsightChatRouteName,
} from '@/lib/insight/insight-chat-route-utils';

type InsightChatResponseMode = 'fast' | 'deep' | 'structured';
type InsightChatMemoryMode = 'off' | 'session' | 'pinned';
type InsightChatRejectedRequestEvent = Extract<
    InsightChatRouteEvent,
    | 'request.invalid_attachment'
    | 'request.invalid_feedback'
    | 'request.invalid_context'
    | 'request.invalid_model'
    | 'request.policy_blocked'
    | 'request.empty_input'
>;
type InsightChatRejectedRequestFallbackReason =
    | 'invalid_attachment'
    | 'invalid_feedback'
    | 'invalid_context'
    | 'invalid_model'
    | 'policy_rejection'
    | 'empty_input';

type BuildRejectedRequestFallbackResponseInput = {
    route: InsightChatRouteName;
    requestId?: string;
    responseMode?: InsightChatResponseMode;
    memoryMode: InsightChatMemoryMode;
    latencyMs: number;
    event: InsightChatRejectedRequestEvent;
    fallbackReason: InsightChatRejectedRequestFallbackReason;
    content: string;
    reason?: string;
    error?: string;
    confidence?: number;
};

export function buildInsightChatRejectedRequestFallbackResponse(
    input: BuildRejectedRequestFallbackResponseInput,
) {
    const {
        route,
        requestId,
        responseMode,
        memoryMode,
        latencyMs,
        event,
        fallbackReason,
        content,
        reason,
        error,
        confidence,
    } = input;
    logInsightChatRouteEvent(route, event, {
        requestId,
        ...(reason ? { reason } : {}),
    });
    const { toolTrace } = evaluateInsightChatRouteGuardrails({
        route,
        requestId,
        latencyMs,
        fallbackReason,
        toolTrace: buildInsightChatRouteToolTrace(route, event, memoryMode),
        skipLatencyBudgetCheck: true,
    });
    recordInsightChatRouteResponseSource(route, 'fallback');
    recordInsightChatRouteCitationQuality(route, []);
    recordInsightChatRouteFallbackResponse(route);

    return NextResponse.json(
        buildInsightChatFallbackResponse({
            requestId,
            fallbackReason,
            ...(error ? { error } : {}),
            content,
            responseMode,
            ...(memoryMode ? { memoryMode } : {}),
            ...(typeof confidence === 'number' ? { confidence } : {}),
            latencyMs,
            toolTrace,
        }),
        {
            status: 400,
            headers: CHAT_ROUTE_NO_STORE_HEADERS,
        },
    );
}
