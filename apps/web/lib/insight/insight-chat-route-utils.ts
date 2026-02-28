import type { InsightChatSource, AdminInsightChatResponse } from '@/types/insight';

type FallbackResponseOptions = {
    requestId?: string;
    fallbackReason: string;
    content?: string;
    error?: string;
    sources?: InsightChatSource[];
    asOf?: string;
    responseMode?: 'fast' | 'deep' | 'structured';
    memoryMode?: 'off' | 'session' | 'pinned';
    confidence?: number;
    latencyMs?: number;
    toolTrace?: string[];
};

export const INSIGHT_CHAT_FALLBACK_CONTENTS = {
    emptyInput: '질문을 입력해 주세요.',
    streamError: '스트리밍 응답 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    serverError: '지금은 챗봇 응답을 즉시 반환하기 어려워요. 잠시 후 다시 시도해 주세요.',
} as const;

export const CHAT_ROUTE_NO_STORE_HEADERS = {
    'Cache-Control': 'no-store',
} as const;

type InsightChatRouteName = 'chat' | 'stream';

type InsightChatRouteGuardrailInput = {
    route: InsightChatRouteName;
    requestId?: string;
    latencyMs?: number;
    fallbackReason?: string;
    toolTrace?: string[];
    skipLatencyBudgetCheck?: boolean;
};

type InsightChatRouteGuardrailResult = {
    toolTrace: string[];
};

type FallbackStreakState = {
    timestamps: number[];
    lastAlertAt: number;
};

type InsightChatRouteGuardrailMetrics = {
    latency_budget_exceeded: number;
    reliability_fallback_streak_alerts: Record<string, number>;
};

type InsightChatRouteGuardrailConfig = {
    enabled: boolean;
    latencyBudgetMs: number;
    fallbackStreakThreshold: number;
    fallbackWindowMs: number;
    fallbackAlertCooldownMs: number;
};

export type InsightChatRouteGuardrailMetricsSnapshot = {
    timestamp: string;
    routes: Record<InsightChatRouteName, InsightChatRouteGuardrailMetrics>;
    guardrailConfig: InsightChatRouteGuardrailConfig;
};

const DEFAULT_LATENCY_BUDGET_MS = 4_500;
const DEFAULT_FALLBACK_STREAK_THRESHOLD = 3;
const DEFAULT_FALLBACK_STREAK_WINDOW_MS = 90_000;
const DEFAULT_FALLBACK_ALERT_COOLDOWN_MS = 60_000;
const INSIGHT_RELIABILITY_FALLBACK_REASONS = new Set([
    'llm_unavailable',
    'request_failed',
    'route_timeout',
    'server_error',
    'stream_error',
    'stream_no_data',
    'storyboard_agent_unavailable',
    'storyboard_qna_unavailable',
]);
const fallbackStreakStateByKey = new Map<string, FallbackStreakState>();
const latencyBudgetExceededCountsByRoute = new Map<InsightChatRouteName, number>();
const fallbackStreakAlertCountsByRouteAndReason = new Map<string, number>();

const METRIC_ROUTES: InsightChatRouteName[] = ['chat', 'stream'];

function getFallbackStreakAlertMetricKey(route: InsightChatRouteName, reason: string): string {
    return `${route}:${reason}`;
}

function getMetricsRouteTemplate(route: InsightChatRouteName): InsightChatRouteGuardrailMetrics {
    const fallbackStreakEntries = [...fallbackStreakAlertCountsByRouteAndReason]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);

    return {
        latency_budget_exceeded: latencyBudgetExceededCountsByRoute.get(route) ?? 0,
        reliability_fallback_streak_alerts: Object.fromEntries(fallbackStreakEntries),
    };
}

function incrementLatencyBudgetExceededMetric(route: InsightChatRouteName): void {
    const current = latencyBudgetExceededCountsByRoute.get(route) ?? 0;
    latencyBudgetExceededCountsByRoute.set(route, current + 1);
}

function incrementFallbackStreakAlertMetric(route: InsightChatRouteName, reason: string): void {
    const key = getFallbackStreakAlertMetricKey(route, reason);
    const current = fallbackStreakAlertCountsByRouteAndReason.get(key) ?? 0;
    fallbackStreakAlertCountsByRouteAndReason.set(key, current + 1);
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildGuardrailConfig() {
    return {
        enabled: parseBooleanEnv('INSIGHT_CHAT_GUARDRAILS_ENABLED', true),
        latencyBudgetMs: parsePositiveIntegerEnv('INSIGHT_CHAT_LATENCY_BUDGET_MS', DEFAULT_LATENCY_BUDGET_MS),
        fallbackStreakThreshold: parsePositiveIntegerEnv('INSIGHT_CHAT_FALLBACK_STREAK_THRESHOLD', DEFAULT_FALLBACK_STREAK_THRESHOLD),
        fallbackWindowMs: parsePositiveIntegerEnv('INSIGHT_CHAT_FALLBACK_STREAK_WINDOW_MS', DEFAULT_FALLBACK_STREAK_WINDOW_MS),
        fallbackAlertCooldownMs: parsePositiveIntegerEnv('INSIGHT_CHAT_FALLBACK_ALERT_COOLDOWN_MS', DEFAULT_FALLBACK_ALERT_COOLDOWN_MS),
    };
}

function normalizeToolTrace(entries: string[] | undefined): string[] {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const deduped: string[] = [];
    for (const entry of entries) {
        if (typeof entry !== 'string') continue;
        const normalized = entry.trim();
        if (!normalized || deduped.includes(normalized)) continue;
        deduped.push(normalized.slice(0, 120));
    }
    return deduped;
}

function trackFallbackStreak(input: {
    route: InsightChatRouteName;
    reason: string;
    now: number;
    threshold: number;
    windowMs: number;
    cooldownMs: number;
}): { shouldAlert: boolean; streakCount: number } {
    const key = `${input.route}:${input.reason}`;
    const previous = fallbackStreakStateByKey.get(key) ?? { timestamps: [], lastAlertAt: 0 };
    const cutoff = input.now - input.windowMs;
    const timestamps = previous.timestamps.filter((value) => value >= cutoff);
    timestamps.push(input.now);

    const canAlertByCount = timestamps.length >= input.threshold;
    const canAlertByCooldown = input.now - previous.lastAlertAt >= input.cooldownMs;
    const shouldAlert = canAlertByCount && canAlertByCooldown;

    fallbackStreakStateByKey.set(key, {
        timestamps,
        lastAlertAt: shouldAlert ? input.now : previous.lastAlertAt,
    });

    return {
        shouldAlert,
        streakCount: timestamps.length,
    };
}

export function buildInsightChatFallbackResponse(options: FallbackResponseOptions): AdminInsightChatResponse & { error?: string } {
    return {
        asOf: options.asOf || new Date().toISOString(),
        content: options.content || '',
        meta: {
            source: 'fallback',
            fallbackReason: options.fallbackReason,
            responseMode: options.responseMode,
            confidence: options.confidence,
            latencyMs: options.latencyMs,
            toolTrace: options.toolTrace,
            ...(options.requestId ? { requestId: options.requestId } : {}),
            ...(options.memoryMode ? { memoryMode: options.memoryMode } : {}),
        },
        sources: options.sources || [],
        ...(options.error ? { error: options.error } : {}),
    };
}

export function logInsightChatRouteEvent(
    route: 'chat' | 'stream',
    event: string,
    details: Record<string, unknown> = {},
): void {
    console.info(`[admin/insight/${route}] ${event}`, {
        ts: new Date().toISOString(),
        ...details,
    });
}

export function evaluateInsightChatRouteGuardrails(input: InsightChatRouteGuardrailInput): InsightChatRouteGuardrailResult {
    const baseToolTrace = normalizeToolTrace(input.toolTrace);
    const config = buildGuardrailConfig();
    if (!config.enabled) {
        return { toolTrace: baseToolTrace };
    }

    const toolTrace = [...baseToolTrace];
    const maybeAppendTrace = (entry: string) => {
        if (!toolTrace.includes(entry)) {
            toolTrace.push(entry);
        }
    };

    const latencyMs = typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)
        ? Math.max(0, Math.round(input.latencyMs))
        : undefined;

    if (!input.skipLatencyBudgetCheck && typeof latencyMs === 'number' && latencyMs > config.latencyBudgetMs) {
        maybeAppendTrace('guardrail:latency_budget_exceeded');
        incrementLatencyBudgetExceededMetric(input.route);
        logInsightChatRouteEvent(input.route, 'guardrail.latency_budget_exceeded', {
            requestId: input.requestId,
            latencyMs,
            budgetMs: config.latencyBudgetMs,
        });
    }

    const fallbackReason = typeof input.fallbackReason === 'string' ? input.fallbackReason.trim() : '';
    if (fallbackReason && INSIGHT_RELIABILITY_FALLBACK_REASONS.has(fallbackReason)) {
        const streak = trackFallbackStreak({
            route: input.route,
            reason: fallbackReason,
            now: Date.now(),
            threshold: config.fallbackStreakThreshold,
            windowMs: config.fallbackWindowMs,
            cooldownMs: config.fallbackAlertCooldownMs,
        });

        if (streak.shouldAlert) {
            maybeAppendTrace('guardrail:fallback_streak_alert');
            incrementFallbackStreakAlertMetric(input.route, fallbackReason);
            logInsightChatRouteEvent(input.route, 'guardrail.fallback_streak_alert', {
                requestId: input.requestId,
                fallbackReason,
                streakCount: streak.streakCount,
                threshold: config.fallbackStreakThreshold,
                windowMs: config.fallbackWindowMs,
            });
        }
    }

    return { toolTrace };
}

export function getInsightChatRouteGuardrailMetricsSnapshot(): InsightChatRouteGuardrailMetricsSnapshot {
    const routeEntries = Object.fromEntries(
        METRIC_ROUTES.map((route) => [route, getMetricsRouteTemplate(route)]),
    ) as Record<InsightChatRouteName, InsightChatRouteGuardrailMetrics>;

    return {
        timestamp: new Date().toISOString(),
        routes: routeEntries,
        guardrailConfig: buildGuardrailConfig(),
    };
}

export function resetInsightChatRouteGuardrails(): void {
    fallbackStreakStateByKey.clear();
    latencyBudgetExceededCountsByRoute.clear();
    fallbackStreakAlertCountsByRouteAndReason.clear();
}

export function __resetInsightChatRouteGuardrailsForTest(): void {
    resetInsightChatRouteGuardrails();
}
