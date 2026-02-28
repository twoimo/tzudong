import { describe, expect, test } from 'bun:test';

import {
    getCitationQualityMetricBadgeStyle,
    getCitationQualityMetricLabel,
    getFeedbackReasonCategoryMetricLabel,
    getFeedbackRatingMetricLabel,
    getFeedbackHasReasonMetricLabel,
    getFallbackReasonLabel,
    getGuardrailMetricLabel,
    getMemoryModeMetricLabel,
    getResponseModeMetricLabel,
    summarizeInsightChatGuardrailRouteOutcomeRates,
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

    test('normalizes outcome totals defensively for each route', () => {
        const normalized = normalizeInsightChatGuardrailMetricsResponse({
            routes: {
                chat: {
                    total_requests: 10,
                    success_responses: 5,
                    fallback_responses: '2',
                    stream_responses: '1',
                    error_responses: -3,
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                },
                stream: {
                    success_responses: 4,
                    fallback_responses: 1,
                    stream_responses: 'x',
                    error_responses: 2,
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                },
            },
            guardrailConfig: {
                enabled: true,
                latencyBudgetMs: 4500,
                fallbackStreakThreshold: 3,
                fallbackWindowMs: 90000,
                fallbackAlertCooldownMs: 60000,
            },
            timestamp: '2026-02-28T00:00:00.000Z',
        });

        expect(normalized.routes.chat.total_requests).toBe(10);
        expect(normalized.routes.chat.success_responses).toBe(5);
        expect(normalized.routes.chat.fallback_responses).toBe(2);
        expect(normalized.routes.chat.stream_responses).toBe(1);
        expect(normalized.routes.chat.error_responses).toBe(0);
        expect(normalized.routes.stream.total_requests).toBe(7);
        expect(normalized.routes.stream.success_responses).toBe(4);
        expect(normalized.routes.stream.fallback_responses).toBe(1);
        expect(normalized.routes.stream.stream_responses).toBe(0);
        expect(normalized.routes.stream.error_responses).toBe(2);
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
                    provider_request_counts: {
                        gemini: 3,
                        fallback: 1,
                    },
                    source_counts: {
                        local: 1,
                        gemini: 2,
                    },
                    fallback_totals: {
                        route_timeout: 4,
                    },
                },
                stream: {
                    latency_budget_exceeded: 5,
                    reliability_fallback_streak_alerts: {
                        route_timeout: 1,
                        server_error: 4,
                    },
                    provider_request_counts: {
                        openai: 6,
                    },
                    source_counts: {
                        openai: 5,
                    },
                    fallback_totals: {
                        server_error: 4,
                        route_timeout: 1,
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
            totalFallbackStreakAlerts: 9,
            dominantFallbackReason: 'route_timeout',
            dominantFallbackCount: 5,
        });
    });

    test('computes compact outcome rates safely', () => {
        expect(summarizeInsightChatGuardrailRouteOutcomeRates({
            total_requests: 10,
            success_responses: 7,
            fallback_responses: 2,
            stream_responses: 1,
            error_responses: 0,
            latency_budget_exceeded: 0,
            reliability_fallback_streak_alerts: {},
        })).toEqual({
            totalRequests: 10,
            successRate: 70,
            fallbackRate: 20,
            errorRate: 0,
        });
    });

    test('normalizes missing provider/source/fallback totals defensively', () => {
        const normalized = normalizeInsightChatGuardrailMetricsResponse({
            timestamp: '2026-02-28T00:00:00.000Z',
            routes: {
                chat: {
                    latency_budget_exceeded: 1,
                    reliability_fallback_streak_alerts: {
                        route_timeout: 1,
                    },
                    provider_request_counts: {
                        gemini: 2,
                        fallback: '3',
                    },
                    source_counts: ['bad'],
                },
                stream: {
                    latency_budget_exceeded: 2,
                    reliability_fallback_streak_alerts: {
                        server_error: 4,
                    },
                    fallback_totals: {
                        route_timeout: 5,
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

        expect(normalized.routes.chat.provider_request_counts).toEqual({ gemini: 2, fallback: 3 });
        expect(normalized.routes.chat.source_counts).toEqual({});
        expect(normalized.routes.stream.fallback_totals).toEqual({ route_timeout: 5 });
    });

    test('normalizes response/memory/feedback distributions defensively', () => {
        const normalized = normalizeInsightChatGuardrailMetricsResponse({
            timestamp: '2026-02-28T00:00:00.000Z',
            routes: {
                chat: {
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                    response_mode_counts: {
                        fast: 4,
                        deep: '2',
                    },
                    memory_mode_counts: {
                        off: 5,
                        session: 0,
                    },
                    feedback_rating_counts: {
                        up: 3,
                        down: '1',
                    },
                    feedback_has_reason_counts: {
                        with_reason: 2,
                        without_reason: 4,
                    },
                },
                stream: {
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                    response_mode_counts: {
                        structured: 1,
                    },
                    memory_mode_counts: {
                        pinned: 2,
                    },
                    feedback_rating_counts: {
                        up: 1,
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

        expect(normalized.routes.chat.response_mode_counts).toEqual({ fast: 4, deep: 2 });
        expect(normalized.routes.chat.memory_mode_counts).toEqual({ off: 5 });
        expect(normalized.routes.chat.feedback_rating_counts).toEqual({ up: 3, down: 1 });
        expect(normalized.routes.chat.feedback_has_reason_counts).toEqual({ with_reason: 2, without_reason: 4 });
        expect(normalized.routes.stream.response_mode_counts).toEqual({ structured: 1 });
        expect(normalized.routes.stream.memory_mode_counts).toEqual({ pinned: 2 });
        expect(normalized.routes.stream.feedback_rating_counts).toEqual({ up: 1 });
    });

    test('normalizes feedback reason category buckets defensively', () => {
        const normalized = normalizeInsightChatGuardrailMetricsResponse({
            timestamp: '2026-02-28T00:00:00.000Z',
            routes: {
                chat: {
                    latency_budget_exceeded: 1,
                    reliability_fallback_streak_alerts: {},
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                    response_mode_counts: {},
                    memory_mode_counts: {},
                    feedback_rating_counts: {},
                    feedback_has_reason_counts: {},
                    feedback_reason_category_counts: {
                        accuracy: 2,
                        relevance: '3',
                        unknown_category: 5,
                        '': 4,
                    },
                },
                stream: {
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                    response_mode_counts: {},
                    memory_mode_counts: {},
                    feedback_rating_counts: {},
                    feedback_has_reason_counts: {},
                    feedbackReasonCategoryCounts: {
                        tone: 1,
                        latency: '2',
                        Unknown: 3,
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

        expect(normalized.routes.chat.feedback_reason_category_counts).toEqual({
            accuracy: 2,
            relevance: 3,
            other: 5,
        });
        expect(normalized.routes.stream.feedback_reason_category_counts).toEqual({
            tone: 1,
            latency: 2,
            other: 3,
        });
    });

    test('normalizes citation quality counts defensively', () => {
        const normalized = normalizeInsightChatGuardrailMetricsResponse({
            timestamp: '2026-02-28T00:00:00.000Z',
            routes: {
                chat: {
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    citation_quality_counts: {
                        medium: '7',
                        low: 3,
                        high: -2,
                        weird: 4,
                        '': 5,
                        '  low  ': 1,
                    },
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                    response_mode_counts: {},
                    memory_mode_counts: {},
                    feedback_rating_counts: {},
                    feedback_has_reason_counts: {},
                },
                stream: {
                    latency_budget_exceeded: 0,
                    reliability_fallback_streak_alerts: {},
                    citationQualityCounts: {
                        none: 1,
                        high: 0,
                    },
                    provider_request_counts: {},
                    source_counts: {},
                    fallback_totals: {},
                    response_mode_counts: {},
                    memory_mode_counts: {},
                    feedback_rating_counts: {},
                    feedback_has_reason_counts: {},
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

        expect(normalized.routes.chat.citation_quality_counts).toEqual({
            medium: 7,
            low: 4,
            other: 4,
        });
        expect(normalized.routes.stream.citation_quality_counts).toEqual({
            none: 1,
        });
    });

    test('normalizes unknown guardrail metric buckets to 기타 labels for compact rendering', () => {
        expect(getGuardrailMetricLabel('legacy-provider')).toBe('기타');
        expect(getResponseModeMetricLabel('unknown-mode')).toBe('기타');
        expect(getMemoryModeMetricLabel('legacy-memory-mode')).toBe('기타');
        expect(getFeedbackRatingMetricLabel('weird-rating')).toBe('기타');
        expect(getFeedbackHasReasonMetricLabel('unmapped_reason')).toBe('기타');
        expect(getFeedbackReasonCategoryMetricLabel('weird-category')).toBe('기타');
        expect(getCitationQualityMetricLabel('unexpected')).toBe('기타');
        expect(getFallbackReasonLabel('unexpected_reason')).toBe('기타');
    });

    test('returns empty summary for undefined payload', () => {
        expect(summarizeInsightChatGuardrailMetrics(undefined)).toEqual({
            totalLatencyBudgetExceeded: 0,
            totalFallbackStreakAlerts: 0,
            dominantFallbackReason: null,
            dominantFallbackCount: 0,
        });
    });

    test('maps guardrail metric buckets like "other" to compact fallback labels', () => {
        expect(getFallbackReasonLabel('other')).toBe('기타');
        expect(getGuardrailMetricLabel('other')).toBe('기타');
        expect(getResponseModeMetricLabel('other')).toBe('기타');
        expect(getMemoryModeMetricLabel('other')).toBe('기타');
        expect(getFeedbackHasReasonMetricLabel('other')).toBe('기타');
        expect(getFeedbackReasonCategoryMetricLabel('other')).toBe('기타');
        expect(getCitationQualityMetricLabel('other')).toBe('기타');
    });

    test('assigns neutral badge style for unknown metric buckets', () => {
        expect(getCitationQualityMetricBadgeStyle('other')).toBe('bg-[#f3f4f6] text-[#4b5563]');
    });
});
