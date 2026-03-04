import { describe, expect, test } from 'bun:test';

describe('insight chat route metric key normalization', () => {
    test('tracks request outcome totals per route', async () => {
        const {
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
            recordInsightChatRouteRequest,
            recordInsightChatRouteSuccessResponse,
            recordInsightChatRouteFallbackResponse,
            recordInsightChatRouteStreamResponse,
            recordInsightChatRouteErrorResponse,
        } = await import('@/lib/insight/insight-chat-route-utils');

        __resetInsightChatRouteGuardrailsForTest();

        recordInsightChatRouteRequest('chat');
        recordInsightChatRouteSuccessResponse('chat');
        recordInsightChatRouteFallbackResponse('chat');
        recordInsightChatRouteErrorResponse('chat');

        recordInsightChatRouteRequest('stream');
        recordInsightChatRouteStreamResponse('stream');
        recordInsightChatRouteStreamResponse('stream');
        recordInsightChatRouteFallbackResponse('stream');
        recordInsightChatRouteErrorResponse('stream');

        const chatSnapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.chat;
        const streamSnapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.stream;

        expect(chatSnapshot.total_requests).toBe(1);
        expect(chatSnapshot.success_responses).toBe(1);
        expect(chatSnapshot.fallback_responses).toBe(1);
        expect(chatSnapshot.stream_responses).toBe(0);
        expect(chatSnapshot.error_responses).toBe(1);

        expect(streamSnapshot.total_requests).toBe(1);
        expect(streamSnapshot.success_responses).toBe(0);
        expect(streamSnapshot.stream_responses).toBe(2);
        expect(streamSnapshot.fallback_responses).toBe(1);
        expect(streamSnapshot.error_responses).toBe(1);
    });

    test('collapses unknown provider/source/fallback values into other buckets', async () => {
        const {
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
            recordInsightChatRouteProviderRequest,
            recordInsightChatRouteResponseSource,
            recordInsightChatRouteFallbackReason,
        } = await import('@/lib/insight/insight-chat-route-utils');

        __resetInsightChatRouteGuardrailsForTest();

        recordInsightChatRouteProviderRequest('chat', 'gemini');
        recordInsightChatRouteProviderRequest('chat', 'openai');
        recordInsightChatRouteProviderRequest('chat', 'invalid-provider-name');
        recordInsightChatRouteProviderRequest('chat', '  Gemini  ');
        recordInsightChatRouteProviderRequest('chat', '');

        recordInsightChatRouteResponseSource('chat', 'local');
        recordInsightChatRouteResponseSource('chat', 'agent');
        recordInsightChatRouteResponseSource('chat', 'not-a-source');
        recordInsightChatRouteResponseSource('chat', '__MYSTERY__');
        recordInsightChatRouteResponseSource('chat', 'local');

        recordInsightChatRouteFallbackReason('chat', 'route_timeout');
        recordInsightChatRouteFallbackReason('chat', 'custom-fallback-1');
        recordInsightChatRouteFallbackReason('chat', 'custom-fallback-2');
        recordInsightChatRouteFallbackReason('chat', 'custom-fallback-2');

        const snapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.chat;

        expect(snapshot.provider_request_counts).toEqual({
            gemini: 2,
            openai: 1,
            other: 2,
        });
        expect(snapshot.source_counts).toEqual({
            local: 2,
            agent: 1,
            other: 2,
        });
        expect(snapshot.fallback_totals).toEqual({
            route_timeout: 1,
            other: 3,
        });
    });

    test('aggregates all unknown fallback reasons into a single bounded bucket', async () => {
        const {
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
            recordInsightChatRouteFallbackReason,
        } = await import('@/lib/insight/insight-chat-route-utils');

        __resetInsightChatRouteGuardrailsForTest();

        for (let index = 0; index < 25; index += 1) {
            recordInsightChatRouteFallbackReason('stream', `unknown-fallback-${index}`);
        }

        const snapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.stream;

        expect(snapshot.fallback_totals).toEqual({ other: 25 });
        expect(Object.keys(snapshot.fallback_totals)).toHaveLength(1);
    });

    test('keeps invalid_model fallback reason in first-class metric bucket', async () => {
        const {
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
            recordInsightChatRouteFallbackReason,
        } = await import('@/lib/insight/insight-chat-route-utils');

        __resetInsightChatRouteGuardrailsForTest();

        recordInsightChatRouteFallbackReason('chat', 'invalid_model');
        recordInsightChatRouteFallbackReason('chat', 'invalid_model');
        recordInsightChatRouteFallbackReason('chat', 'custom-unknown-fallback');

        const snapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.chat;

        expect(snapshot.fallback_totals).toEqual({
            invalid_model: 2,
            other: 1,
        });
    });

    test('records rolling latency stats and computes p50/p95', async () => {
        const {
            __resetInsightChatRouteGuardrailsForTest,
            getInsightChatRouteGuardrailMetricsSnapshot,
            evaluateInsightChatRouteGuardrails,
        } = await import('@/lib/insight/insight-chat-route-utils');

        const originalEnv = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        const originalLatencyBudget = process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
        process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
        process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '30';

        __resetInsightChatRouteGuardrailsForTest();

        try {
            [8, 12, 20, 35, 50].forEach((latencyMs) => {
                evaluateInsightChatRouteGuardrails({
                    route: 'chat',
                    requestId: `latency-${latencyMs}`,
                    latencyMs,
                    toolTrace: ['route:chat'],
                });
            });
            evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId: 'stream-latency',
                latencyMs: 12,
                toolTrace: ['route:stream'],
            });

            const snapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.chat;
            const streamSnapshot = getInsightChatRouteGuardrailMetricsSnapshot().routes.stream;

            expect(snapshot.latency_stats).toEqual({
                count: 5,
                avg_ms: 25,
                p50_ms: 20,
                p95_ms: 50,
                max_ms: 50,
                last_ms: 50,
            });
            expect(snapshot.latency_budget_breached).toBe(true);
            expect(streamSnapshot.latency_budget_breached).toBe(false);
            expect(streamSnapshot.latency_stats).toEqual({
                count: 1,
                avg_ms: 12,
                p50_ms: 12,
                p95_ms: 12,
                max_ms: 12,
                last_ms: 12,
            });
        } finally {
            if (typeof originalEnv === 'undefined') {
                delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
            } else {
                process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalEnv;
            }
            if (typeof originalLatencyBudget === 'undefined') {
                delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
            } else {
                process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = originalLatencyBudget;
            }
            __resetInsightChatRouteGuardrailsForTest();
        }
    });

    test('sanitizes sensitive data in route log details', async () => {
        const { __sanitizeLogDetailsForEvent } = await import('@/lib/insight/insight-chat-route-utils');

        const safe = __sanitizeLogDetailsForEvent({
            apiKey: 'sk-live-01234567890123456789',
            secret: 'should-hide',
            model: {
                provider: 'openai',
                apiKey: 'ak-secret',
            },
            message: 'Bearer token=abc123',
            nested: {
                authorization: 'Bearer sk-test',
            },
        });

        expect(safe).toMatchObject({
            apiKey: '<redacted>',
            secret: '<redacted>',
            nested: {
                authorization: '<redacted>',
            },
            model: {
                provider: 'openai',
            },
        });
        expect((safe as { message?: string }).message).not.toContain('sk-live');
        expect((safe as { nested: { authorization: string } }).nested.authorization).toBe('<redacted>');
        expect((safe as { model: { apiKey: string } }).model.apiKey).toBe('<redacted>');
    });
});
