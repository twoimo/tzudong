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
                    reliability_fallback_streak_alerts: {
                        route_timeout: 1,
                    },
                },
                stream: {
                    latency_budget_exceeded: 1,
                    reliability_fallback_streak_alerts: {
                        server_error: 1,
                    },
                },
            });

            const snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts.route_timeout).toBe(1);
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts.server_error).toBe(1);
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

            resetInsightChatRouteGuardrails();
            snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts).toEqual({});
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts).toEqual({});
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
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(1);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts.server_error).toBe(1);

            const response = await postMetricsReset(createMetricsRequest('POST', '/reset'));
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                success: true,
                message: 'Insight chat guardrail metrics reset.',
            });

            snapshot = getInsightChatRouteGuardrailMetricsSnapshot();
            expect(snapshot.routes.chat.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.chat.reliability_fallback_streak_alerts).toEqual({});
            expect(snapshot.routes.stream.latency_budget_exceeded).toBe(0);
            expect(snapshot.routes.stream.reliability_fallback_streak_alerts).toEqual({});

            const metricsResponse = await getMetrics(createMetricsRequest());
            expect(metricsResponse.status).toBe(200);
            const payload = await metricsResponse.json();
            expect(payload.routes.chat.latency_budget_exceeded).toBe(0);
            expect(payload.routes.stream.latency_budget_exceeded).toBe(0);
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
});
