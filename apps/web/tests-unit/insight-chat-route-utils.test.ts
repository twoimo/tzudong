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
});
