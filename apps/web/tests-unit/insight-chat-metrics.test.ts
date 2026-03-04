import { describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

type AuthState = 'ok' | 'unauthorized' | 'forbidden';

function setAuthMock(state: AuthState) {
    mock.module('@/lib/auth/require-admin', () => ({
        requireAdmin: async () => {
            if (state === 'ok') {
                return { ok: true, userId: 'admin-user' };
            }

            return {
                ok: false,
                response:
                    state === 'unauthorized'
                        ? new Response(JSON.stringify({ error: 'Unauthorized' }), {
                              status: 401,
                              headers: { 'Content-Type': 'application/json' },
                          })
                        : new Response(JSON.stringify({ error: 'Forbidden' }), {
                              status: 403,
                              headers: { 'Content-Type': 'application/json' },
                          }),
            };
        },
    }));
}

describe('insight chat metrics endpoint', () => {
    function createMetricsRequest(method: 'GET' | 'POST' = 'GET', suffix: '' | '/reset' = '') {
        return new NextRequest(`http://localhost:8080/api/admin/insight/chat/metrics${suffix}`, {
            method,
            ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' } } : {}),
        });
    }

    test('GET /api/admin/insight/chat/metrics returns authenticated snapshot and no-store headers', async () => {
        const originalEnv = {
            guardrailsEnabled: process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED,
            latencyBudgetMs: process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS,
            streakThreshold: process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD,
            streakWindow: process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS,
            streakCooldown: process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS,
        };

        mock.restore();
        setAuthMock('ok');
        process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
        process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '5';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD = '1';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS = '120000';
        process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS = '1';

        const { resetInsightChatRouteGuardrails, evaluateInsightChatRouteGuardrails, getInsightChatRouteGuardrailMetricsSnapshot } = await import(
            '@/lib/insight/insight-chat-route-utils',
        );
        const { GET } = await import('@/app/api/admin/insight/chat/metrics/route');

        try {
            resetInsightChatRouteGuardrails();

            evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId: 'chat-timeout',
                latencyMs: 20,
                fallbackReason: 'route_timeout',
                toolTrace: ['route:chat', 'request.timeout'],
            });
            evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId: 'stream-error',
                latencyMs: 20,
                fallbackReason: 'server_error',
                toolTrace: ['route:stream', 'request.failed'],
            });

            const response = await GET(createMetricsRequest());
            expect(response.status).toBe(200);
            expect(response.headers.get('Cache-Control')).toBe('no-store');

            const payload = await response.json();
            expect(typeof payload.timestamp).toBe('string');
            expect(payload.guardrailConfig).toEqual({
                enabled: true,
                latencyBudgetMs: 5,
                fallbackStreakThreshold: 1,
                fallbackWindowMs: 120000,
                fallbackAlertCooldownMs: 1,
            });
            expect(payload.routes).toEqual({
                chat: {
                    latency_budget_exceeded: 1,
                    latency_budget_breached: true,
                    reliability_fallback_streak_alerts: {
                        route_timeout: 1,
                    },
                    latency_stats: {
                        count: 1,
                        avg_ms: 20,
                        p50_ms: 20,
                        p95_ms: 20,
                        max_ms: 20,
                        last_ms: 20,
                    },
                    total_requests: 0,
                    success_responses: 0,
                    fallback_responses: 0,
                    stream_responses: 0,
                    error_responses: 0,
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {
                        route_timeout: 1,
                    },
                    citation_quality_counts: {},
                    feedback_reason_category_counts: {},
                    response_mode_counts: {},
                    memory_mode_counts: {},
                    feedback_rating_counts: {},
                    feedback_has_reason_counts: {},
                },
                stream: {
                    latency_budget_exceeded: 1,
                    latency_budget_breached: true,
                    reliability_fallback_streak_alerts: {
                        server_error: 1,
                    },
                    latency_stats: {
                        count: 1,
                        avg_ms: 20,
                        p50_ms: 20,
                        p95_ms: 20,
                        max_ms: 20,
                        last_ms: 20,
                    },
                    total_requests: 0,
                    success_responses: 0,
                    fallback_responses: 0,
                    stream_responses: 0,
                    error_responses: 0,
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {
                        server_error: 1,
                    },
                    citation_quality_counts: {},
                    feedback_reason_category_counts: {},
                    response_mode_counts: {},
                    memory_mode_counts: {},
                    feedback_rating_counts: {},
                    feedback_has_reason_counts: {},
                },
            });

            const snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.chat.latency_budget_breached).toBe(true);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts.route_timeout).toBe(1);
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.stream.latency_budget_breached).toBe(true);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts.server_error).toBe(1);
            expect(snapshot.routes.chat.total_requests).toBe(0);
            expect(snapshot.routes.chat.success_responses).toBe(0);
            expect(snapshot.routes.chat.fallback_responses).toBe(0);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(0);
            expect(snapshot.routes.stream.total_requests).toBe(0);
            expect(snapshot.routes.stream.success_responses).toBe(0);
            expect(snapshot.routes.stream.fallback_responses).toBe(0);
            expect(snapshot.routes.stream.stream_responses).toBe(0);
            expect(snapshot.routes.stream.error_responses).toBe(0);
            expect(snapshot.routes.chat.provider_request_counts).toEqual({});
            expect(snapshot.routes.chat.source_counts).toEqual({});
            expect(snapshot.routes.chat.fallback_totals).toEqual({ route_timeout: 1 });
            expect(snapshot.routes.chat.citation_quality_counts).toEqual({});
            expect(snapshot.routes.chat.response_mode_counts).toEqual({});
            expect(snapshot.routes.chat.memory_mode_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_has_reason_counts).toEqual({});
            expect(snapshot.routes.chat.latency_stats).toEqual({
                count: 1,
                avg_ms: 20,
                p50_ms: 20,
                p95_ms: 20,
                max_ms: 20,
                last_ms: 20,
            });
            expect(snapshot.routes.stream.provider_request_counts).toEqual({});
            expect(snapshot.routes.stream.source_counts).toEqual({});
            expect(snapshot.routes.stream.fallback_totals).toEqual({ server_error: 1 });
            expect(snapshot.routes.stream.citation_quality_counts).toEqual({});
            expect(snapshot.routes.stream.response_mode_counts).toEqual({});
            expect(snapshot.routes.stream.memory_mode_counts).toEqual({});
            expect(snapshot.routes.stream.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.stream.feedback_has_reason_counts).toEqual({});
            expect(snapshot.routes.stream.latency_stats).toEqual({
                count: 1,
                avg_ms: 20,
                p50_ms: 20,
                p95_ms: 20,
                max_ms: 20,
                last_ms: 20,
            });
        } finally {
            if (typeof originalEnv.guardrailsEnabled === 'undefined') {
                delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
            } else {
                process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalEnv.guardrailsEnabled;
            }
            if (typeof originalEnv.latencyBudgetMs === 'undefined') {
                delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
            } else {
                process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = originalEnv.latencyBudgetMs;
            }
            if (typeof originalEnv.streakThreshold === 'undefined') {
                delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD;
            } else {
                process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD = originalEnv.streakThreshold;
            }
            if (typeof originalEnv.streakWindow === 'undefined') {
                delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS;
            } else {
                process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS = originalEnv.streakWindow;
            }
            if (typeof originalEnv.streakCooldown === 'undefined') {
                delete process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS;
            } else {
                process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS = originalEnv.streakCooldown;
            }
            mock.restore();
        }
    });

    test('metrics endpoint enforces admin auth', async () => {
        mock.restore();
        setAuthMock('unauthorized');
        const { GET: getUnauthorized } = await import('@/app/api/admin/insight/chat/metrics/route?unauthorized');
        const { POST: postResetUnauthorized } = await import('@/app/api/admin/insight/chat/metrics/reset/route?unauthorized-reset');
        let response = await getUnauthorized(createMetricsRequest());
        let payload = await response.json();
        expect(response.status).toBe(401);
        expect(payload).toEqual({ error: 'Unauthorized' });

        response = await postResetUnauthorized(createMetricsRequest('POST', '/reset'));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized' });

        mock.restore();
        setAuthMock('forbidden');
        const { GET: getForbidden } = await import('@/app/api/admin/insight/chat/metrics/route?forbidden');
        const { POST: postResetForbidden } = await import('@/app/api/admin/insight/chat/metrics/reset/route?forbidden-reset');
        response = await getForbidden(new NextRequest('http://localhost:8080/api/admin/insight/chat/metrics'));
        payload = await response.json();
        expect(response.status).toBe(403);
        expect(payload).toEqual({ error: 'Forbidden' });

        response = await postResetForbidden(createMetricsRequest('POST', '/reset'));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });

        mock.restore();
    });

    test('guardrail metrics reset helper clears all counters', async () => {
        mock.restore();
        setAuthMock('ok');
        process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
        process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '5';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD = '1';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS = '120000';
        process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS = '1';

        const { evaluateInsightChatRouteGuardrails, resetInsightChatRouteGuardrails, getInsightChatRouteGuardrailMetricsSnapshot } = await import(
            '@/lib/insight/insight-chat-route-utils',
        );

        try {
            resetInsightChatRouteGuardrails();
            evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId: 'chat-timeout',
                latencyMs: 20,
                fallbackReason: 'route_timeout',
                toolTrace: ['route:chat'],
            });

            let snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts.route_timeout).toBe(1);
            expect(snapshot.routes.chat.total_requests).toBe(0);
            expect(snapshot.routes.chat.success_responses).toBe(0);
            expect(snapshot.routes.chat.fallback_responses).toBe(0);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(0);
            expect(snapshot.routes.chat.provider_request_counts).toEqual({});
            expect(snapshot.routes.chat.source_counts).toEqual({});
            expect(snapshot.routes.chat.fallback_totals).toEqual({ route_timeout: 1 });
            expect(snapshot.routes.chat.citation_quality_counts).toEqual({});
            expect(snapshot.routes.chat.response_mode_counts).toEqual({});
            expect(snapshot.routes.chat.memory_mode_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_has_reason_counts).toEqual({});

            resetInsightChatRouteGuardrails();
            snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.chat.latency_budget_breached).toBe(false);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts).toEqual({});
            expect(snapshot.routes.chat.total_requests).toBe(0);
            expect(snapshot.routes.chat.success_responses).toBe(0);
            expect(snapshot.routes.chat.fallback_responses).toBe(0);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(0);
            expect(snapshot.routes.chat.provider_request_counts).toEqual({});
            expect(snapshot.routes.chat.source_counts).toEqual({});
            expect(snapshot.routes.chat.fallback_totals).toEqual({});
            expect(snapshot.routes.chat.citation_quality_counts).toEqual({});
            expect(snapshot.routes.chat.response_mode_counts).toEqual({});
            expect(snapshot.routes.chat.memory_mode_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_has_reason_counts).toEqual({});
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.stream.latency_budget_breached).toBe(false);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts).toEqual({});
            expect(snapshot.routes.stream.total_requests).toBe(0);
            expect(snapshot.routes.stream.success_responses).toBe(0);
            expect(snapshot.routes.stream.fallback_responses).toBe(0);
            expect(snapshot.routes.stream.stream_responses).toBe(0);
            expect(snapshot.routes.stream.error_responses).toBe(0);
            expect(snapshot.routes.stream.provider_request_counts).toEqual({});
            expect(snapshot.routes.stream.source_counts).toEqual({});
            expect(snapshot.routes.stream.fallback_totals).toEqual({});
            expect(snapshot.routes.stream.citation_quality_counts).toEqual({});
            expect(snapshot.routes.stream.response_mode_counts).toEqual({});
            expect(snapshot.routes.stream.memory_mode_counts).toEqual({});
            expect(snapshot.routes.stream.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.stream.feedback_has_reason_counts).toEqual({});
        } finally {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
            delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
            delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD;
            delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS;
            delete process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS;
            mock.restore();
        }
    });

    test('POST /api/admin/insight/chat/metrics clears in-memory metrics via route handler', async () => {
        mock.restore();
        setAuthMock('ok');
        process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
        process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '5';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD = '1';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS = '120000';
        process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS = '1';

        const {
            evaluateInsightChatRouteGuardrails,
            resetInsightChatRouteGuardrails,
            getInsightChatRouteGuardrailMetricsSnapshot,
        } = await import('@/lib/insight/insight-chat-route-utils');
        const { POST: postMetricsReset } = await import('@/app/api/admin/insight/chat/metrics/reset/route');
        const { GET: getMetrics } = await import('@/app/api/admin/insight/chat/metrics/route');

        try {
            resetInsightChatRouteGuardrails();
            evaluateInsightChatRouteGuardrails({
                route: 'chat',
                requestId: 'chat-timeout',
                latencyMs: 20,
                fallbackReason: 'route_timeout',
                toolTrace: ['route:chat'],
            });
            evaluateInsightChatRouteGuardrails({
                route: 'stream',
                requestId: 'stream-error',
                latencyMs: 20,
                fallbackReason: 'server_error',
                toolTrace: ['route:stream'],
            });

            let snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts.route_timeout).toBe(1);
            expect(snapshot.routes.chat.total_requests).toBe(0);
            expect(snapshot.routes.chat.success_responses).toBe(0);
            expect(snapshot.routes.chat.fallback_responses).toBe(0);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(0);
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts.server_error).toBe(1);
            expect(snapshot.routes.stream.total_requests).toBe(0);
            expect(snapshot.routes.stream.success_responses).toBe(0);
            expect(snapshot.routes.stream.fallback_responses).toBe(0);
            expect(snapshot.routes.stream.stream_responses).toBe(0);
            expect(snapshot.routes.stream.error_responses).toBe(0);

            const response = await postMetricsReset(createMetricsRequest('POST', '/reset'));
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                success: true,
                message: 'Insight chat guardrail metrics reset.',
            });

            snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts).toEqual({});
            expect(snapshot.routes.chat.total_requests).toBe(0);
            expect(snapshot.routes.chat.success_responses).toBe(0);
            expect(snapshot.routes.chat.fallback_responses).toBe(0);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(0);
            expect(snapshot.routes.chat.provider_request_counts).toEqual({});
            expect(snapshot.routes.chat.source_counts).toEqual({});
            expect(snapshot.routes.chat.fallback_totals).toEqual({});
            expect(snapshot.routes.chat.citation_quality_counts).toEqual({});
            expect(snapshot.routes.chat.response_mode_counts).toEqual({});
            expect(snapshot.routes.chat.memory_mode_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.chat.feedback_has_reason_counts).toEqual({});
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts).toEqual({});
            expect(snapshot.routes.stream.total_requests).toBe(0);
            expect(snapshot.routes.stream.success_responses).toBe(0);
            expect(snapshot.routes.stream.fallback_responses).toBe(0);
            expect(snapshot.routes.stream.stream_responses).toBe(0);
            expect(snapshot.routes.stream.error_responses).toBe(0);
            expect(snapshot.routes.stream.provider_request_counts).toEqual({});
            expect(snapshot.routes.stream.source_counts).toEqual({});
            expect(snapshot.routes.stream.fallback_totals).toEqual({});
            expect(snapshot.routes.stream.citation_quality_counts).toEqual({});
            expect(snapshot.routes.stream.response_mode_counts).toEqual({});
            expect(snapshot.routes.stream.memory_mode_counts).toEqual({});
            expect(snapshot.routes.stream.feedback_rating_counts).toEqual({});
            expect(snapshot.routes.stream.feedback_has_reason_counts).toEqual({});

            const metricsResponse = await getMetrics(createMetricsRequest());
            expect(metricsResponse.status).toBe(200);
            const payload = await metricsResponse.json();
            expect(payload.routes.chat.latency_budget_exceeded).toBe(0);
            expect(payload.routes.stream.latency_budget_exceeded).toBe(0);
            expect(payload.routes.chat.total_requests).toBe(0);
            expect(payload.routes.chat.success_responses).toBe(0);
            expect(payload.routes.chat.fallback_responses).toBe(0);
            expect(payload.routes.chat.stream_responses).toBe(0);
            expect(payload.routes.chat.error_responses).toBe(0);
            expect(payload.routes.chat.latency_budget_breached).toBe(false);
            expect(payload.routes.stream.total_requests).toBe(0);
            expect(payload.routes.stream.success_responses).toBe(0);
            expect(payload.routes.stream.fallback_responses).toBe(0);
            expect(payload.routes.stream.stream_responses).toBe(0);
            expect(payload.routes.stream.error_responses).toBe(0);
            expect(payload.routes.stream.latency_budget_breached).toBe(false);
            expect(payload.routes.chat.provider_request_counts).toEqual({});
            expect(payload.routes.chat.source_counts).toEqual({});
            expect(payload.routes.chat.fallback_totals).toEqual({});
            expect(payload.routes.chat.citation_quality_counts).toEqual({});
            expect(payload.routes.chat.response_mode_counts).toEqual({});
            expect(payload.routes.chat.memory_mode_counts).toEqual({});
            expect(payload.routes.chat.feedback_rating_counts).toEqual({});
            expect(payload.routes.chat.feedback_has_reason_counts).toEqual({});
            expect(payload.routes.stream.provider_request_counts).toEqual({});
            expect(payload.routes.stream.source_counts).toEqual({});
            expect(payload.routes.stream.fallback_totals).toEqual({});
            expect(payload.routes.stream.citation_quality_counts).toEqual({});
            expect(payload.routes.stream.response_mode_counts).toEqual({});
            expect(payload.routes.stream.memory_mode_counts).toEqual({});
            expect(payload.routes.stream.feedback_rating_counts).toEqual({});
            expect(payload.routes.stream.feedback_has_reason_counts).toEqual({});
            expect(payload.guardrailConfig).toEqual({
                enabled: true,
                latencyBudgetMs: 5,
                fallbackStreakThreshold: 1,
                fallbackWindowMs: 120000,
                fallbackAlertCooldownMs: 1,
            });
        } finally {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
            delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
            delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD;
            delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS;
            delete process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS;
            mock.restore();
        }
    });

    test('chat and stream routes increment provider/source/fallback metrics independently', async () => {
        const originalChatRouteTimeout = process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS;
        const originalStreamRouteTimeout = process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS;
        const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        const originalLatencyBudget = process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
        const originalFallbackThreshold = process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD;
        const originalFallbackWindow = process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS;
        const originalFallbackCooldown = process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS;

        mock.restore();
        setAuthMock('ok');
        process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD = '5';
        process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS = '120000';
        process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS = '1';
        process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = '10000';
        process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS = '10';
        process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS = '10';

        mock.module('@/lib/insight/chat', () => ({
            answerAdminInsightChat: async (
                message: string,
                _llmConfig: unknown,
                requestId: string | undefined,
            ) => {
                if (message === 'chat-timeout') {
                    await new Promise((resolve) => setTimeout(resolve, 40));
                }
                const source = message === 'chat-success-openai' ? 'openai' : 'gemini';
                const fallbackReason = message === 'chat-fallback' ? 'llm_unavailable' : undefined;
                const sources = message === 'chat-success-gemini'
                    ? [
                        { sourceName: 'manual', text: 'A', videoTitle: 'video-a', youtubeLink: 'https://a', timestamp: '00:00' },
                        { sourceName: 'manual', text: 'B', videoTitle: 'video-b', youtubeLink: 'https://b', timestamp: '00:01' },
                        { sourceName: 'manual', text: 'C', videoTitle: 'video-c', youtubeLink: 'https://c', timestamp: '00:02' },
                        { sourceName: 'manual', text: 'D', videoTitle: 'video-d', youtubeLink: 'https://d', timestamp: '00:03' },
                        { sourceName: 'manual', text: 'E', videoTitle: 'video-e', youtubeLink: 'https://e', timestamp: '00:04' },
                    ]
                    : [];
                return {
                    asOf: '2026-02-27T00:00:00.000Z',
                    content: `chat-response:${message}`,
                    sources: [],
                    ...(sources.length > 0 ? { sources } : {}),
                    meta: {
                        source: message === 'chat-fallback' ? 'fallback' : source,
                        requestId,
                        ...(fallbackReason ? { fallbackReason } : {}),
                    },
                };
            },
            streamAdminInsightChat: async (
                message: string,
                _llmConfig: unknown,
                _signal: AbortSignal | undefined,
                requestId: string | undefined,
            ) => {
                if (message === 'stream-timeout') {
                    await new Promise((resolve) => setTimeout(resolve, 40));
                }
                if (message === 'stream-local') {
                    return {
                        local: {
                            asOf: '2026-02-27T00:00:00.000Z',
                            content: 'stream-local',
                            sources: [
                                {
                                    sourceName: 'manual',
                                    text: 'stream source 1',
                                    videoTitle: 'video-x',
                                    youtubeLink: 'https://x',
                                    timestamp: '00:01',
                                },
                                {
                                    sourceName: 'manual',
                                    text: 'stream source 2',
                                    videoTitle: 'video-y',
                                    youtubeLink: 'https://y',
                                    timestamp: '00:02',
                                },
                            ],
                            meta: {
                                source: 'fallback',
                                requestId,
                                fallbackReason: 'llm_unavailable',
                            },
                        },
                    };
                }

                const encoder = new TextEncoder();
                return {
                    stream: new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
                            controller.close();
                        },
                    }),
                };
            },
            getAdminInsightChatBootstrap: async () => ({
                asOf: '2026-02-27T00:00:00.000Z',
                message: {
                    content: 'mock bootstrap',
                    sources: [],
                },
            }),
        }));

        const {
            resetInsightChatRouteGuardrails,
            getInsightChatRouteGuardrailMetricsSnapshot,
        } = await import('@/lib/insight/insight-chat-route-utils');
        const { POST: chatPOST } = await import('@/app/api/admin/insight/chat/route');
        const { POST: streamPOST } = await import('@/app/api/admin/insight/chat/stream/route');

        const createRequest = (path: string, body?: Record<string, unknown>) => new NextRequest(
            `http://localhost:8080${path}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            },
        );

        try {
            resetInsightChatRouteGuardrails();

            await chatPOST(createRequest('/api/admin/insight/chat', {
                message: 'chat-success-gemini',
                requestId: 'chat-success-gemini',
                provider: 'gemini',
                model: 'gemini-pro',
                responseMode: 'fast',
                memoryMode: 'session',
                feedbackContext: {
                    rating: 'up',
                    reason: 'concise',
                },
            }));
            await chatPOST(createRequest('/api/admin/insight/chat', {
                message: '   ',
                requestId: 'chat-invalid-input',
                provider: 'openai',
                model: 'gpt-4',
                responseMode: 'deep',
                memoryMode: 'pinned',
                feedbackContext: {
                    rating: 'down',
                },
            }));
            await chatPOST(createRequest('/api/admin/insight/chat', {
                message: 'chat-timeout',
                requestId: 'chat-timeout',
                provider: 'gemini',
                model: 'gemini-pro',
                responseMode: 'structured',
                memoryMode: 'off',
            }));
            await streamPOST(createRequest('/api/admin/insight/chat/stream', {
                message: 'stream-local',
                requestId: 'stream-local',
                provider: 'anthropic',
                model: 'claude-3',
                responseMode: 'fast',
                memoryMode: 'session',
                feedbackContext: {
                    rating: 'up',
                    reason: 'local-fallback',
                },
            }));
            await streamPOST(createRequest('/api/admin/insight/chat/stream', {
                message: 'stream-timeout',
                requestId: 'stream-timeout',
                provider: 'openai',
                model: 'gpt-4',
                responseMode: 'deep',
                memoryMode: 'pinned',
                feedbackContext: {
                    rating: 'down',
                },
            }));
            const streamSuccess = await streamPOST(createRequest('/api/admin/insight/chat/stream', {
                message: 'stream-success',
                requestId: 'stream-success',
                provider: 'openai',
                model: 'gpt-4',
                responseMode: 'structured',
                memoryMode: 'off',
                feedbackContext: {
                    rating: 'up',
                },
            }));
            expect(streamSuccess.status).toBe(200);

            const snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.provider_request_counts).toEqual({
                gemini: 2,
                openai: 1,
            });
            expect(snapshot.routes.chat.total_requests).toBe(3);
            expect(snapshot.routes.chat.success_responses).toBe(1);
            expect(snapshot.routes.chat.fallback_responses).toBe(1);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(1);
            expect(snapshot.routes.chat.source_counts).toEqual({
                gemini: 1,
                fallback: 2,
            });
            expect(snapshot.routes.chat.response_mode_counts).toEqual({
                fast: 1,
                deep: 1,
                structured: 1,
            });
            expect(snapshot.routes.chat.memory_mode_counts).toEqual({
                session: 1,
                pinned: 1,
                off: 1,
            });
            expect(snapshot.routes.chat.feedback_rating_counts).toEqual({
                up: 1,
                down: 1,
            });
            expect(snapshot.routes.chat.feedback_has_reason_counts).toEqual({
                with_reason: 1,
                without_reason: 1,
            });
            expect(snapshot.routes.chat.fallback_totals).toEqual({
                empty_input: 1,
                route_timeout: 1,
            });
            expect(snapshot.routes.chat.citation_quality_counts).toEqual({
                high: 1,
                none: 2,
            });
            expect(snapshot.routes.stream.provider_request_counts).toEqual({
                anthropic: 1,
                openai: 2,
            });
            expect(snapshot.routes.stream.total_requests).toBe(3);
            expect(snapshot.routes.stream.success_responses).toBe(0);
            expect(snapshot.routes.stream.fallback_responses).toBe(1);
            expect(snapshot.routes.stream.stream_responses).toBe(1);
            expect(snapshot.routes.stream.error_responses).toBe(1);
            expect(snapshot.routes.stream.source_counts).toEqual({
                local: 1,
                fallback: 1,
                agent: 1,
            });
            expect(snapshot.routes.stream.response_mode_counts).toEqual({
                fast: 1,
                deep: 1,
                structured: 1,
            });
            expect(snapshot.routes.stream.memory_mode_counts).toEqual({
                session: 1,
                pinned: 1,
                off: 1,
            });
            expect(snapshot.routes.stream.feedback_rating_counts).toEqual({
                up: 2,
                down: 1,
            });
            expect(snapshot.routes.stream.feedback_has_reason_counts).toEqual({
                with_reason: 1,
                without_reason: 2,
            });
            expect(snapshot.routes.stream.fallback_totals).toEqual({
                llm_unavailable: 1,
                route_timeout: 1,
            });
            expect(snapshot.routes.stream.citation_quality_counts).toEqual({
                low: 1,
                none: 1,
            });
        } finally {
            if (typeof originalChatRouteTimeout === 'undefined') {
                delete process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS;
            } else {
                process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS = originalChatRouteTimeout;
            }
            if (typeof originalStreamRouteTimeout === 'undefined') {
                delete process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS;
            } else {
                process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS = originalStreamRouteTimeout;
            }
            if (typeof originalGuardrailsEnabled === 'undefined') {
                delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
            } else {
                process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
            }
            if (typeof originalLatencyBudget === 'undefined') {
                delete process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS;
            } else {
                process.env.INSIGHT_CHAT_LATENCY_BUDGET_MS = originalLatencyBudget;
            }
            if (typeof originalFallbackThreshold === 'undefined') {
                delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD;
            } else {
                process.env.INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD = originalFallbackThreshold;
            }
            if (typeof originalFallbackWindow === 'undefined') {
                delete process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS;
            } else {
                process.env.INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS = originalFallbackWindow;
            }
            if (typeof originalFallbackCooldown === 'undefined') {
                delete process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS;
            } else {
                process.env.INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS = originalFallbackCooldown;
            }
            mock.restore();
        }
    });

    test('collapses unknown metric values into bounded "other" buckets', async () => {
        const originalChatRouteTimeout = process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS;
        const originalStreamRouteTimeout = process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS;
        const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;

        mock.restore();
        setAuthMock('ok');
        process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'true';
        process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS = '10';
        process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS = '10';

        mock.module('@/lib/insight/chat', () => ({
            answerAdminInsightChat: async (_message: string, _llmConfig: unknown, requestId: string | undefined) => ({
                asOf: '2026-02-27T00:00:00.000Z',
                content: `chat-response:${requestId}`,
                sources: [],
                meta: {
                    source: 'fallback',
                    requestId,
                    fallbackReason: 'mystery_fallback',
                },
            }),
            streamAdminInsightChat: async (message: string, _llmConfig: unknown, _signal: AbortSignal | undefined, requestId: string | undefined) => {
                if (message === 'stream-local-unknown') {
                    return {
                        local: {
                            asOf: '2026-02-27T00:00:00.000Z',
                            content: 'stream-local',
                            sources: [],
                            meta: {
                                source: 'fallback',
                                requestId,
                                fallbackReason: 'mystery-stream-fallback',
                            },
                        },
                    };
                }

                const encoder = new TextEncoder();
                return {
                    stream: new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
                            controller.close();
                        },
                    }),
                };
            },
            getAdminInsightChatBootstrap: async () => ({
                asOf: '2026-02-27T00:00:00.000Z',
                message: {
                    content: 'mock bootstrap',
                    sources: [],
                },
            }),
        }));

        const {
            resetInsightChatRouteGuardrails,
            getInsightChatRouteGuardrailMetricsSnapshot,
            recordInsightChatRouteResponseSource,
            recordInsightChatRouteResponseMode,
            recordInsightChatRouteMemoryMode,
            recordInsightChatRouteFeedback,
        } = await import('@/lib/insight/insight-chat-route-utils');
        const { POST: chatPOST } = await import('@/app/api/admin/insight/chat/route');
        const { POST: streamPOST } = await import('@/app/api/admin/insight/chat/stream/route');

        const createRequest = (path: string, body: Record<string, unknown>) => new NextRequest(
            `http://localhost:8080${path}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            },
        );

        try {
            resetInsightChatRouteGuardrails();
            await chatPOST(createRequest('/api/admin/insight/chat', {
                message: 'chat-unknown-provider',
                requestId: 'chat-unknown-provider',
                provider: 'unbounded-provider',
                model: 'mystery-model',
                responseMode: 'fast',
                memoryMode: 'off',
                feedbackContext: {
                    rating: 'up',
                },
            }));

            await streamPOST(createRequest('/api/admin/insight/chat/stream', {
                message: 'stream-local-unknown',
                requestId: 'stream-local-unknown',
                provider: 'unbounded-provider',
                model: 'mystery-model',
                responseMode: 'structured',
                memoryMode: 'off',
                feedbackContext: {
                    rating: 'down',
                    reason: 'something',
                },
            }));

            recordInsightChatRouteResponseMode('chat', 'unbounded-mode');
            recordInsightChatRouteResponseSource('chat', 'mystery-provider');
            recordInsightChatRouteMemoryMode('stream', 'weird-memory');
            recordInsightChatRouteFeedback('chat', {
                rating: 'surprising',
                reason: 'unexpected',
            });
            recordInsightChatRouteFeedback('stream', {
                rating: 'surprising',
            });

            const snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.provider_request_counts).toEqual({ other: 1 });
            expect(snapshot.routes.chat.total_requests).toBe(1);
            expect(snapshot.routes.chat.success_responses).toBe(0);
            expect(snapshot.routes.chat.fallback_responses).toBe(1);
            expect(snapshot.routes.chat.stream_responses).toBe(0);
            expect(snapshot.routes.chat.error_responses).toBe(0);
            expect(snapshot.routes.chat.source_counts).toEqual({
                fallback: 1,
                other: 1,
            });
            expect(snapshot.routes.chat.fallback_totals).toEqual({ other: 1 });
            expect(snapshot.routes.chat.response_mode_counts).toEqual({ other: 1, fast: 1 });
            expect(snapshot.routes.stream.provider_request_counts).toEqual({ other: 1 });
            expect(snapshot.routes.stream.total_requests).toBe(1);
            expect(snapshot.routes.stream.success_responses).toBe(0);
            expect(snapshot.routes.stream.fallback_responses).toBe(1);
            expect(snapshot.routes.stream.stream_responses).toBe(0);
            expect(snapshot.routes.stream.error_responses).toBe(0);
            expect(snapshot.routes.stream.source_counts).toEqual({ local: 1 });
            expect(snapshot.routes.stream.response_mode_counts).toEqual({ structured: 1 });
            expect(snapshot.routes.stream.memory_mode_counts).toEqual({ off: 1, other: 1 });
            expect(snapshot.routes.chat.feedback_rating_counts).toEqual({ up: 1, other: 1 });
            expect(snapshot.routes.chat.feedback_has_reason_counts).toEqual({ without_reason: 1, with_reason: 1 });
            expect(snapshot.routes.stream.feedback_rating_counts).toEqual({ down: 1, other: 1 });
            expect(snapshot.routes.stream.feedback_has_reason_counts).toEqual({ with_reason: 1, without_reason: 1 });
            expect(snapshot.routes.stream.fallback_totals).toEqual({ other: 1 });
        } finally {
            if (typeof originalChatRouteTimeout === 'undefined') {
                delete process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS;
            } else {
                process.env.INSIGHT_CHAT_ROUTE_TIMEOUT_MS = originalChatRouteTimeout;
            }
            if (typeof originalStreamRouteTimeout === 'undefined') {
                delete process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS;
            } else {
                process.env.INSIGHT_CHAT_STREAM_ROUTE_TIMEOUT_MS = originalStreamRouteTimeout;
            }
            if (typeof originalGuardrailsEnabled === 'undefined') {
                delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
            } else {
                process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
            }
            mock.restore();
        }
    });
});
