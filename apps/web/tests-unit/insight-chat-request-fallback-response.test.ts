import { expect, test } from 'bun:test';

test('buildInsightChatRejectedRequestFallbackResponse handles invalid request guardrails', async () => {
    const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
    const originalLatencyBudget = process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
    process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
    process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '1';

    try {
        const {
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
        } = await import('@/lib/insight/insight-chat-route-utils');
        const { buildInsightChatRejectedRequestFallbackResponse } = await import('@/app/api/admin/insight/chat/request-fallback-response');
        __resetInsightChatRouteGuardrailsForTest();

        const response = buildInsightChatRejectedRequestFallbackResponse({
            route: 'chat',
            requestId: 'reject-1',
            responseMode: 'deep',
            memoryMode: 'session',
            latencyMs: 999,
            event: 'request.invalid_feedback',
            fallbackReason: 'invalid_feedback',
            content: '피드백 형식이 올바르지 않습니다.',
            reason: 'bad_payload',
        });
        expect(response.status).toBe(400);

        const payload = await response.json();
        expect(payload).toMatchObject({
            content: '피드백 형식이 올바르지 않습니다.',
            meta: {
                source: 'fallback',
                fallbackReason: 'invalid_feedback',
                requestId: 'reject-1',
                responseMode: 'deep',
                memoryMode: 'session',
            },
            sources: [],
        });
        expect(payload.meta.toolTrace).toEqual([
            'route:chat',
            'request.invalid_feedback',
            'memoryMode:session',
        ]);

        const snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
        expect(snapshot.routes.chat.fallback_responses).toBe(1);
        expect(snapshot.routes.chat.source_counts.fallback).toBe(1);
        expect(snapshot.routes.chat.fallback_totals.invalid_feedback).toBe(1);
        expect(snapshot.routes.chat.citation_quality_counts.none).toBe(1);
        expect(snapshot.routes.chat.latency_budget_exceeded).toBe(0);
        expect(snapshot.routes.chat.latency_budget_breached).toBe(false);
    } finally {
        if (originalGuardrailsEnabled === undefined) {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        } else {
            process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
        }
        if (originalLatencyBudget === undefined) {
            delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
        } else {
            process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = originalLatencyBudget;
        }
    }
});

test('buildInsightChatRejectedRequestFallbackResponse supports empty-input payload options', async () => {
    const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
    const originalLatencyBudget = process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
    process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
    process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '1';

    try {
        const {
            INSIGHT_CHAT_FALLBACK_CONTENTS,
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
        } = await import('@/lib/insight/insight-chat-route-utils');
        const { buildInsightChatRejectedRequestFallbackResponse } = await import('@/app/api/admin/insight/chat/request-fallback-response');
        __resetInsightChatRouteGuardrailsForTest();

        const response = buildInsightChatRejectedRequestFallbackResponse({
            route: 'stream',
            requestId: 'empty-1',
            responseMode: 'fast',
            memoryMode: 'off',
            latencyMs: 250,
            event: 'request.empty_input',
            fallbackReason: 'empty_input',
            content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
            error: 'empty_input',
            confidence: 0.85,
        });
        expect(response.status).toBe(400);

        const payload = await response.json();
        expect(payload).toMatchObject({
            content: INSIGHT_CHAT_FALLBACK_CONTENTS.emptyInput,
            error: 'empty_input',
            meta: {
                source: 'fallback',
                fallbackReason: 'empty_input',
                requestId: 'empty-1',
                responseMode: 'fast',
                memoryMode: 'off',
                confidence: 0.85,
            },
            sources: [],
        });
        expect(payload.meta.toolTrace).toEqual([
            'route:stream',
            'request.empty_input',
            'memoryMode:off',
        ]);

        const snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
        expect(snapshot.routes.stream.fallback_responses).toBe(1);
        expect(snapshot.routes.stream.source_counts.fallback).toBe(1);
        expect(snapshot.routes.stream.fallback_totals.empty_input).toBe(1);
        expect(snapshot.routes.stream.citation_quality_counts.none).toBe(1);
        expect(snapshot.routes.stream.latency_budget_exceeded).toBe(0);
        expect(snapshot.routes.stream.latency_budget_breached).toBe(false);
    } finally {
        if (originalGuardrailsEnabled === undefined) {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        } else {
            process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
        }
        if (originalLatencyBudget === undefined) {
            delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
        } else {
            process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = originalLatencyBudget;
        }
    }
});
