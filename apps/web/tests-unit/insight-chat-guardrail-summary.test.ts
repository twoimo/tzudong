import { describe, expect, test } from 'bun:test';

import {
    normalizeInsightChatGuardrailMetricsResponse,
    summarizeInsightChatGuardrailMetrics,
} from '@/components/insight/InsightChatSection';

describe('insight chat guardrail summary helpers', () => {
    test('normalizes malformed guardrail metrics payload safely', () => {
        const normalized = normalizeInsightChatGuardrailMetricsResponse({
            timestamp: '',
            routes: {
                chat: {
                    latency_budget_exceeded: '3',
                    reliability_fallback_streak_alerts: {
                        route_timeout: 2,
                        ' ': 9,
                        stream_error: '1',
                    },
                },
                stream: {
                    latency_budget_exceeded: -5,
                    reliability_fallback_streak_alerts: 'bad',
                },
            },
            guardrailConfig: {
                enabled: false,
                latencyBudgetMs: '1200',
                fallbackStreakThreshold: 0,
                fallbackWindowMs: 180000,
                fallbackAlertCooldownMs: null,
            },
        });

        expect(normalized.routes.chat.latency_budget_exceeded).toBe(3);
        expect(normalized.routes.chat.reliability_fallback_streak_alerts).toEqual({
            route_timeout: 2,
            stream_error: 1,
        });
        expect(normalized.routes.stream.latency_budget_exceeded).toBe(0);
        expect(normalized.routes.stream.reliability_fallback_streak_alerts).toEqual({});
        expect(normalized.guardrailConfig).toEqual({
            enabled: false,
            latencyBudgetMs: 1200,
            fallbackStreakThreshold: 3,
            fallbackWindowMs: 180000,
            fallbackAlertCooldownMs: 60000,
        });
    });

    test('summarizes totals and dominant fallback reason across routes', () => {
        const summary = summarizeInsightChatGuardrailMetrics({
            timestamp: '2026-02-28T00:00:00.000Z',
            routes: {
                chat: {
                    latency_budget_exceeded: 2,
                    reliability_fallback_streak_alerts: {
                        route_timeout: 2,
                    },
                },
                stream: {
                    latency_budget_exceeded: 5,
                    reliability_fallback_streak_alerts: {
                        route_timeout: 1,
                        server_error: 4,
                    },
                },
            },
            guardrailConfig: {
                enabled: true,
                latencyBudgetMs: 4500,
                fallbackStreakThreshold: 3,
                fallbackWindowMs: 90000,
                fallbackAlertCooldownMs: 60000,
            },
        });

        expect(summary).toEqual({
            totalLatencyBudgetExceeded: 7,
            totalFallbackStreakAlerts: 7,
            dominantFallbackReason: 'server_error',
            dominantFallbackCount: 4,
        });
    });

    test('returns empty summary for undefined payload', () => {
        expect(summarizeInsightChatGuardrailMetrics(undefined)).toEqual({
            totalLatencyBudgetExceeded: 0,
            totalFallbackStreakAlerts: 0,
            dominantFallbackReason: null,
            dominantFallbackCount: 0,
        });
    });
});
