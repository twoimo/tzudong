import type {
    AdminInsightChatResponse,
    InsightChatSource,
} from '@/types/insight';

export type InsightChatCitationQuality = 'none' | 'low' | 'medium' | 'high';

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

export type InsightChatRouteName = 'chat' | 'stream';
export type InsightChatRouteEvent =
    | 'request.invalid_attachment'
    | 'request.invalid_feedback'
    | 'request.invalid_context'
    | 'request.invalid_model'
    | 'request.policy_blocked'
    | 'request.empty_input'
    | 'request.timeout'
    | 'request.failed'
    | 'response.success'
    | 'response.stream'
    | 'response.local_fallback'
    | 'response.timeout';

export function buildInsightChatRouteToolTrace(
    route: InsightChatRouteName,
    event: InsightChatRouteEvent,
    memoryMode: 'off' | 'session' | 'pinned',
): string[] {
    return [`route:${route}`, event, `memoryMode:${memoryMode}`];
}

type InsightChatProviderForMetrics = 'gemini' | 'openai' | 'anthropic' | 'other';
type InsightChatResponseSourceForMetrics = 'local' | 'agent' | 'gemini' | 'openai' | 'anthropic' | 'fallback' | 'other';
type InsightChatResponseModeForMetrics = 'fast' | 'deep' | 'structured' | 'other';
type InsightChatMemoryModeForMetrics = 'off' | 'session' | 'pinned' | 'other';
type InsightChatFeedbackRatingForMetrics = 'up' | 'down' | 'other';
type InsightChatFeedbackReasonCategoryForMetrics = 'accuracy' | 'relevance' | 'completeness' | 'tone' | 'latency' | 'other';
type InsightChatFeedbackReasonStateForMetrics = 'with_reason' | 'without_reason' | 'other';

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
    latency_budget_breached: boolean;
    reliability_fallback_streak_alerts: Record<string, number>;
    total_requests: number;
    success_responses: number;
    fallback_responses: number;
    stream_responses: number;
    error_responses: number;
    provider_request_counts: Record<string, number>;
    source_counts: Record<string, number>;
    fallback_totals: Record<string, number>;
    citation_quality_counts: Record<string, number>;
    response_mode_counts: Record<string, number>;
    memory_mode_counts: Record<string, number>;
    feedback_rating_counts: Record<string, number>;
    feedback_has_reason_counts: Record<string, number>;
    feedback_reason_category_counts: Record<string, number>;
    latency_stats?: {
        count: number;
        avg_ms: number;
        p50_ms: number;
        p95_ms: number;
        max_ms: number;
        last_ms: number;
    };
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
const MAX_LATENCY_SAMPLES_PER_ROUTE = 256;
const OUTCOME_BUCKETS = {
    total_requests: 'total_requests',
    success_responses: 'success_responses',
    fallback_responses: 'fallback_responses',
    stream_responses: 'stream_responses',
    error_responses: 'error_responses',
} as const;
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
const latestLatencyBudgetBreachedByRoute = new Map<InsightChatRouteName, boolean>();
const requestOutcomeCountsByRouteAndType = new Map<string, number>();
const fallbackStreakAlertCountsByRouteAndReason = new Map<string, number>();
const providerRequestCountsByRouteAndProvider = new Map<string, number>();
const responseSourceCountsByRouteAndSource = new Map<string, number>();
const fallbackTotalsByRouteAndReason = new Map<string, number>();
const citationQualityCountsByRouteAndQuality = new Map<string, number>();
const responseModeCountsByRouteAndMode = new Map<string, number>();
const memoryModeCountsByRouteAndMode = new Map<string, number>();
const feedbackRatingCountsByRouteAndRating = new Map<string, number>();
const feedbackHasReasonCountsByRouteAndState = new Map<string, number>();
const feedbackReasonCategoryCountsByRouteAndCategory = new Map<string, number>();
const latencySamplesByRoute = new Map<InsightChatRouteName, number[]>();
const FALLBACK_SOURCE_BUCKETS = new Set<InsightChatResponseSourceForMetrics>([
    'local',
    'agent',
    'gemini',
    'openai',
    'anthropic',
    'fallback',
]);
const FALLBACK_REASON_BUCKETS = new Set([
    'llm_unavailable',
    'request_failed',
    'route_timeout',
    'server_error',
    'stream_error',
    'stream_no_data',
    'storyboard_agent_unavailable',
    'storyboard_qna_unavailable',
    'storyboard_qna_local',
    'storyboard_internal_fallback',
    'storyboard_need_human',
    'storyboard_local_fallback',
    'storyboard_simple_chat',
    'invalid_attachment',
    'invalid_feedback',
    'invalid_context',
    'invalid_model',
    'policy_rejection',
    'empty_input',
]);
const UNKNOWN_METRIC_BUCKET = 'other';
const LOG_SENSITIVE_KEY_HINTS = new Set([
    'authorization',
    'api-key',
    'apikey',
    'api_key',
    'bearer',
    'cookie',
    'password',
    'secret',
    'session',
    'token',
    'access-token',
    'refresh-token',
    'access_token',
    'refresh_token',
    'api_token',
    'service_key',
    'private_key',
]);
const VALID_PROVIDERS = new Set<InsightChatProviderForMetrics>([
    'gemini',
    'openai',
    'anthropic',
]);
const VALID_RESPONSE_MODES = new Set<InsightChatResponseModeForMetrics>([
    'fast',
    'deep',
    'structured',
]);
const VALID_MEMORY_MODES = new Set<InsightChatMemoryModeForMetrics>([
    'off',
    'session',
    'pinned',
]);
const VALID_FEEDBACK_RATINGS = new Set<InsightChatFeedbackRatingForMetrics>([
    'up',
    'down',
]);
const VALID_FEEDBACK_REASON_STATES = new Set<InsightChatFeedbackReasonStateForMetrics>([
    'with_reason',
    'without_reason',
]);
const VALID_FEEDBACK_REASON_CATEGORIES = new Set<InsightChatFeedbackReasonCategoryForMetrics>([
    'accuracy',
    'relevance',
    'completeness',
    'tone',
    'latency',
    'other',
]);
const MAX_LOG_RECURSION_DEPTH = 6;
const PATTERN_SECRET_KEY_VALUE = /\b([a-zA-Z0-9_-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|password|bearer)[a-zA-Z0-9_-]*)\s*[:=]?\s*["']?([^\s"']+)/gi;
const PATTERN_SECRET_PLAIN = /\b(?:sk-|pk-|AIza|glc_|ghp_|xoxb-|xoxa-|gho_)[A-Za-z0-9._\/-]{16,}\b/g;

function isLogSensitiveKey(key: string): boolean {
    const normalized = key.trim().toLowerCase();
    for (const hint of LOG_SENSITIVE_KEY_HINTS) {
        if (normalized === hint || normalized.includes(hint)) {
            return true;
        }
    }
    return false;
}

function sanitizeLogString(raw: string): string {
    const withLabeledValuesRedacted = raw.replace(
        PATTERN_SECRET_KEY_VALUE,
        (_, key) => `${key}="<redacted>"`,
    );

    const withBareSecretsRedacted = withLabeledValuesRedacted.replace(
        PATTERN_SECRET_PLAIN,
        () => '<redacted>',
    );

    return withBareSecretsRedacted;
}

function sanitizeLogValue(value: unknown, depth = 0, visited = new WeakSet<object>()): unknown {
    if (depth > MAX_LOG_RECURSION_DEPTH) {
        return '<redacted-depth-limit>';
    }

    if (value == null) {
        return value;
    }

    if (typeof value === 'string') {
        return sanitizeLogString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: sanitizeLogString(value.message),
        };
    }

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeLogValue(entry, depth + 1, visited));
    }

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (visited.has(record)) {
            return '<redacted-circular>';
        }
        visited.add(record);

        const sanitized: Record<string, unknown> = {};
        for (const [key, keyValue] of Object.entries(record)) {
            sanitized[key] = isLogSensitiveKey(key)
                ? '<redacted>'
                : sanitizeLogValue(keyValue, depth + 1, visited);
        }
        return sanitized;
    }

    return typeof value === 'bigint' ? Number.MAX_SAFE_INTEGER : String(value);
}

export function __sanitizeLogDetailsForEvent(details: Record<string, unknown>): Record<string, unknown> {
    return sanitizeLogValue(details) as Record<string, unknown>;
}

const METRIC_ROUTES: InsightChatRouteName[] = ['chat', 'stream'];
type InsightChatRouteOutcome = typeof OUTCOME_BUCKETS[keyof typeof OUTCOME_BUCKETS];

function normalizeMetricBucket(
    rawBucket: string | undefined,
    validBuckets: ReadonlySet<string>,
): string {
    const normalized = typeof rawBucket === 'string' ? rawBucket.trim().toLowerCase() : '';
    if (!normalized) return UNKNOWN_METRIC_BUCKET;
    return validBuckets.has(normalized) ? normalized : UNKNOWN_METRIC_BUCKET;
}

function getFallbackStreakAlertMetricKey(route: InsightChatRouteName, reason: string): string {
    return `${route}:${reason}`;
}

function calculatePercentileFromSorted(values: number[], percentile: number): number {
    if (!values.length) return 0;
    const clamped = Math.max(0, Math.min(1, percentile));
    const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * clamped) - 1));
    return values[index] ?? 0;
}

function buildLatencyStatsForRoute(
    route: InsightChatRouteName,
): InsightChatRouteGuardrailMetrics['latency_stats'] | undefined {
    const samples = latencySamplesByRoute.get(route);
    if (!samples?.length) {
        return undefined;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    return {
        count,
        avg_ms: Math.round(sum / count),
        p50_ms: calculatePercentileFromSorted(sorted, 0.5),
        p95_ms: calculatePercentileFromSorted(sorted, 0.95),
        max_ms: sorted[count - 1] ?? 0,
        last_ms: samples[samples.length - 1] ?? 0,
    };
}

function getMetricsRouteTemplate(route: InsightChatRouteName): InsightChatRouteGuardrailMetrics {
    const fallbackStreakEntries = [...fallbackStreakAlertCountsByRouteAndReason]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const providerEntries = [...providerRequestCountsByRouteAndProvider]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const responseSourceEntries = [...responseSourceCountsByRouteAndSource]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const fallbackReasonEntries = [...fallbackTotalsByRouteAndReason]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const responseModeEntries = [...responseModeCountsByRouteAndMode]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const memoryModeEntries = [...memoryModeCountsByRouteAndMode]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const feedbackRatingEntries = [...feedbackRatingCountsByRouteAndRating]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const citationQualityEntries = [...citationQualityCountsByRouteAndQuality]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const feedbackHasReasonEntries = [...feedbackHasReasonCountsByRouteAndState]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const feedbackReasonCategoryEntries = [...feedbackReasonCategoryCountsByRouteAndCategory]
        .filter(([key]) => key.startsWith(`${route}:`))
        .map(([key, count]) => [key.slice(route.length + 1), count]);
    const latencyStats = buildLatencyStatsForRoute(route);

    return {
        latency_budget_exceeded: latencyBudgetExceededCountsByRoute.get(route) ?? 0,
        latency_budget_breached: latestLatencyBudgetBreachedByRoute.get(route) ?? false,
        reliability_fallback_streak_alerts: Object.fromEntries(fallbackStreakEntries),
        total_requests: requestOutcomeCountsByRouteAndType.get(`${route}:${OUTCOME_BUCKETS.total_requests}`) ?? 0,
        success_responses: requestOutcomeCountsByRouteAndType.get(`${route}:${OUTCOME_BUCKETS.success_responses}`) ?? 0,
        fallback_responses: requestOutcomeCountsByRouteAndType.get(`${route}:${OUTCOME_BUCKETS.fallback_responses}`) ?? 0,
        stream_responses: requestOutcomeCountsByRouteAndType.get(`${route}:${OUTCOME_BUCKETS.stream_responses}`) ?? 0,
        error_responses: requestOutcomeCountsByRouteAndType.get(`${route}:${OUTCOME_BUCKETS.error_responses}`) ?? 0,
        provider_request_counts: Object.fromEntries(providerEntries),
        source_counts: Object.fromEntries(responseSourceEntries),
        fallback_totals: Object.fromEntries(fallbackReasonEntries),
        citation_quality_counts: Object.fromEntries(citationQualityEntries),
        response_mode_counts: Object.fromEntries(responseModeEntries),
        memory_mode_counts: Object.fromEntries(memoryModeEntries),
        feedback_rating_counts: Object.fromEntries(feedbackRatingEntries),
        feedback_has_reason_counts: Object.fromEntries(feedbackHasReasonEntries),
        feedback_reason_category_counts: Object.fromEntries(feedbackReasonCategoryEntries),
        ...(latencyStats ? { latency_stats: latencyStats } : {}),
    };
}

function incrementLatencyBudgetExceededMetric(route: InsightChatRouteName): void {
    const current = latencyBudgetExceededCountsByRoute.get(route) ?? 0;
    latencyBudgetExceededCountsByRoute.set(route, current + 1);
}

function setLatestLatencyBudgetBreach(route: InsightChatRouteName, breached: boolean): void {
    latestLatencyBudgetBreachedByRoute.set(route, breached);
}

function getOutcomeMetricKey(route: InsightChatRouteName, outcome: InsightChatRouteOutcome): string {
    return `${route}:${outcome}`;
}

function incrementRouteOutcomeMetric(route: InsightChatRouteName, outcome: InsightChatRouteOutcome): void {
    const key = getOutcomeMetricKey(route, outcome);
    const current = requestOutcomeCountsByRouteAndType.get(key) ?? 0;
    requestOutcomeCountsByRouteAndType.set(key, current + 1);
}

function incrementFallbackStreakAlertMetric(route: InsightChatRouteName, reason: string): void {
    const key = getFallbackStreakAlertMetricKey(route, reason);
    const current = fallbackStreakAlertCountsByRouteAndReason.get(key) ?? 0;
    fallbackStreakAlertCountsByRouteAndReason.set(key, current + 1);
}

function normalizeProviderForMetrics(rawProvider: string | undefined): InsightChatProviderForMetrics {
    return normalizeMetricBucket(rawProvider, VALID_PROVIDERS) as InsightChatProviderForMetrics;
}

function normalizeSourceForMetrics(rawSource: string | undefined): InsightChatResponseSourceForMetrics {
    return normalizeMetricBucket(rawSource, FALLBACK_SOURCE_BUCKETS) as InsightChatResponseSourceForMetrics;
}

function incrementProviderRequestMetric(route: InsightChatRouteName, provider: string): void {
    const key = `${route}:${provider}`;
    const current = providerRequestCountsByRouteAndProvider.get(key) ?? 0;
    providerRequestCountsByRouteAndProvider.set(key, current + 1);
}

function incrementResponseSourceMetric(route: InsightChatRouteName, source: string): void {
    const key = `${route}:${source}`;
    const current = responseSourceCountsByRouteAndSource.get(key) ?? 0;
    responseSourceCountsByRouteAndSource.set(key, current + 1);
}

function incrementCitationQualityMetric(route: InsightChatRouteName, quality: InsightChatCitationQuality): void {
    const key = `${route}:${quality}`;
    const current = citationQualityCountsByRouteAndQuality.get(key) ?? 0;
    citationQualityCountsByRouteAndQuality.set(key, current + 1);
}

function incrementFallbackReasonMetric(route: InsightChatRouteName, reason: string): void {
    const normalized = normalizeMetricBucket(reason, FALLBACK_REASON_BUCKETS);
    const key = `${route}:${normalized}`;
    const current = fallbackTotalsByRouteAndReason.get(key) ?? 0;
    fallbackTotalsByRouteAndReason.set(key, current + 1);
}

function normalizeResponseModeForMetrics(rawResponseMode: string | undefined): InsightChatResponseModeForMetrics | undefined {
    const normalized = typeof rawResponseMode === 'string' ? rawResponseMode.trim().toLowerCase() : '';
    if (!normalized) return undefined;
    return VALID_RESPONSE_MODES.has(normalized as InsightChatResponseModeForMetrics)
        ? normalized as InsightChatResponseModeForMetrics
        : UNKNOWN_METRIC_BUCKET;
}

function normalizeMemoryModeForMetrics(rawMemoryMode: string | undefined): InsightChatMemoryModeForMetrics | undefined {
    const normalized = typeof rawMemoryMode === 'string' ? rawMemoryMode.trim().toLowerCase() : '';
    if (!normalized) return undefined;
    return VALID_MEMORY_MODES.has(normalized as InsightChatMemoryModeForMetrics)
        ? normalized as InsightChatMemoryModeForMetrics
        : UNKNOWN_METRIC_BUCKET;
}

function normalizeFeedbackRatingForMetrics(rawRating: string | undefined): InsightChatFeedbackRatingForMetrics | undefined {
    const normalized = typeof rawRating === 'string' ? rawRating.trim().toLowerCase() : '';
    if (!normalized) return undefined;
    return VALID_FEEDBACK_RATINGS.has(normalized as InsightChatFeedbackRatingForMetrics)
        ? normalized as InsightChatFeedbackRatingForMetrics
        : UNKNOWN_METRIC_BUCKET;
}

function normalizeFeedbackReasonStateForMetrics(hasReason: boolean | undefined): InsightChatFeedbackReasonStateForMetrics | undefined {
    if (typeof hasReason !== 'boolean') return undefined;
    const value = hasReason ? 'with_reason' : 'without_reason';
    return VALID_FEEDBACK_REASON_STATES.has(value as InsightChatFeedbackReasonStateForMetrics)
        ? value as InsightChatFeedbackReasonStateForMetrics
        : UNKNOWN_METRIC_BUCKET;
}

function normalizeFeedbackReasonCategoryForMetrics(
    rawCategory: string | undefined,
): InsightChatFeedbackReasonCategoryForMetrics {
    return normalizeMetricBucket(rawCategory, VALID_FEEDBACK_REASON_CATEGORIES) as InsightChatFeedbackReasonCategoryForMetrics;
}

function inferFeedbackReasonCategoryFromText(reason: string | undefined): InsightChatFeedbackReasonCategoryForMetrics {
    const normalized = typeof reason === 'string' ? reason.toLowerCase() : '';
    if (!normalized.trim()) return 'other';

    const reasonText = normalized.trim();
    const categoryPatterns: Array<[RegExp, InsightChatFeedbackReasonCategoryForMetrics]> = [
        [/\b(accuracy|accurate|correct|incorrect|wrong|오류|오답|잘못|부정확|정확|정확성|사실|팩트)\b/, 'accuracy'],
        [/\b(relevance|irrelevant|related|unrelated|관련|주제|맥락|연관|적절|부적절|무관|관계없|관련성)\b/, 'relevance'],
        [/\b(completeness|complete|incomplete|inadequate|missing|부족|누락|덜|불완전|완전|완성|상세|자세히|빠짐|포함되지)\b/, 'completeness'],
        [/\b(tone|wording|style|어투|톤|표현|문체|말투|매너|무례|욕설|비난|불쾌|친절|공손|문장)\b/, 'tone'],
        [/\b(latency|slow|slowness|timeout|time[- ]?out|느리|지연|속도|대기|지체|반응\s*시간|응답\s*시간|로딩)\b/, 'latency'],
    ];

    for (const [pattern, bucket] of categoryPatterns) {
        if (pattern.test(reasonText)) {
            return bucket;
        }
    }
    return 'other';
}

function incrementResponseModeMetric(route: InsightChatRouteName, mode: InsightChatResponseModeForMetrics): void {
    const key = `${route}:${mode}`;
    const current = responseModeCountsByRouteAndMode.get(key) ?? 0;
    responseModeCountsByRouteAndMode.set(key, current + 1);
}

function incrementMemoryModeMetric(route: InsightChatRouteName, mode: InsightChatMemoryModeForMetrics): void {
    const key = `${route}:${mode}`;
    const current = memoryModeCountsByRouteAndMode.get(key) ?? 0;
    memoryModeCountsByRouteAndMode.set(key, current + 1);
}

function incrementFeedbackRatingMetric(route: InsightChatRouteName, rating: InsightChatFeedbackRatingForMetrics): void {
    const key = `${route}:${rating}`;
    const current = feedbackRatingCountsByRouteAndRating.get(key) ?? 0;
    feedbackRatingCountsByRouteAndRating.set(key, current + 1);
}

function incrementFeedbackHasReasonMetric(route: InsightChatRouteName, state: InsightChatFeedbackReasonStateForMetrics): void {
    const key = `${route}:${state}`;
    const current = feedbackHasReasonCountsByRouteAndState.get(key) ?? 0;
    feedbackHasReasonCountsByRouteAndState.set(key, current + 1);
}

function incrementFeedbackReasonCategoryMetric(
    route: InsightChatRouteName,
    category: InsightChatFeedbackReasonCategoryForMetrics,
): void {
    const normalized = normalizeFeedbackReasonCategoryForMetrics(category);
    const key = `${route}:${normalized}`;
    const current = feedbackReasonCategoryCountsByRouteAndCategory.get(key) ?? 0;
    feedbackReasonCategoryCountsByRouteAndCategory.set(key, current + 1);
}

export function recordInsightChatRouteProviderRequest(
    route: InsightChatRouteName,
    provider: string | undefined,
): void {
    incrementProviderRequestMetric(route, normalizeProviderForMetrics(provider));
}

export function recordInsightChatRouteRequest(route: InsightChatRouteName): void {
    incrementRouteOutcomeMetric(route, OUTCOME_BUCKETS.total_requests);
}

export function recordInsightChatRouteSuccessResponse(route: InsightChatRouteName): void {
    incrementRouteOutcomeMetric(route, OUTCOME_BUCKETS.success_responses);
}

export function recordInsightChatRouteFallbackResponse(route: InsightChatRouteName): void {
    incrementRouteOutcomeMetric(route, OUTCOME_BUCKETS.fallback_responses);
}

export function recordInsightChatRouteStreamResponse(route: InsightChatRouteName): void {
    incrementRouteOutcomeMetric(route, OUTCOME_BUCKETS.stream_responses);
}

export function recordInsightChatRouteErrorResponse(route: InsightChatRouteName): void {
    incrementRouteOutcomeMetric(route, OUTCOME_BUCKETS.error_responses);
}

export function recordInsightChatRouteResponseSource(
    route: InsightChatRouteName,
    source: string | undefined,
): void {
    incrementResponseSourceMetric(route, normalizeSourceForMetrics(source));
}

export function recordInsightChatRouteFallbackReason(
    route: InsightChatRouteName,
    fallbackReason: string | undefined,
): void {
    if (typeof fallbackReason !== 'string') return;
    const normalized = fallbackReason.trim().toLowerCase();
    if (!normalized) return;
    incrementFallbackReasonMetric(route, normalized);
}

export function recordInsightChatRouteLatency(
    route: InsightChatRouteName,
    latencyMs: number | undefined,
): void {
    if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs)) return;
    const safeLatency = Math.max(0, Math.round(latencyMs));
    const samples = latencySamplesByRoute.get(route) ?? [];
    if (samples.length >= MAX_LATENCY_SAMPLES_PER_ROUTE) {
        samples.shift();
    }
    samples.push(safeLatency);
    latencySamplesByRoute.set(route, samples);
}

export function recordInsightChatRouteResponseMode(
    route: InsightChatRouteName,
    responseMode: string | undefined,
): void {
    const normalized = normalizeResponseModeForMetrics(responseMode);
    if (!normalized) return;
    incrementResponseModeMetric(route, normalized);
}

export function recordInsightChatRouteMemoryMode(
    route: InsightChatRouteName,
    memoryMode: string | undefined,
): void {
    const normalized = normalizeMemoryModeForMetrics(memoryMode);
    if (!normalized) return;
    incrementMemoryModeMetric(route, normalized);
}

export function recordInsightChatRouteFeedback(
    route: InsightChatRouteName,
    feedbackContext: { rating?: string; reason?: string } | undefined,
): void {
    const normalizedRating = normalizeFeedbackRatingForMetrics(feedbackContext?.rating);
    if (!normalizedRating) return;

    incrementFeedbackRatingMetric(route, normalizedRating);

    const hasReason = normalizeFeedbackReasonStateForMetrics(
        typeof feedbackContext?.reason === 'string' && feedbackContext.reason.trim().length > 0,
    );
    if (hasReason) {
        incrementFeedbackHasReasonMetric(route, hasReason);
        incrementFeedbackReasonCategoryMetric(route, inferFeedbackReasonCategoryFromText(feedbackContext?.reason));
    }
}

export function recordInsightChatRouteCitationQuality(
    route: InsightChatRouteName,
    sources: InsightChatSource[] | undefined,
): void {
    incrementCitationQualityMetric(route, deriveInsightChatCitationQuality(sources));
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

export function deriveInsightChatCitationQuality(sources: InsightChatSource[] | undefined): InsightChatCitationQuality {
    const uniqueSourceKeys = new Set<string>();
    for (const source of sources ?? []) {
        if (!source || typeof source !== 'object') {
            continue;
        }

        const key = `${source.videoTitle || 'unknown'}|${source.youtubeLink || 'unknown'}|${source.timestamp || 'unknown'}`
            .toLowerCase()
            .trim();
        if (source.text?.trim()) {
            uniqueSourceKeys.add(key);
        }
    }

    if (uniqueSourceKeys.size <= 0) return 'none';
    if (uniqueSourceKeys.size <= 2) return 'low';
    if (uniqueSourceKeys.size <= 4) return 'medium';
    return 'high';
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
            citationQuality: deriveInsightChatCitationQuality(options.sources),
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
        ...__sanitizeLogDetailsForEvent(details),
    });
}

export function evaluateInsightChatRouteGuardrails(input: InsightChatRouteGuardrailInput): InsightChatRouteGuardrailResult {
    const baseToolTrace = normalizeToolTrace(input.toolTrace);
    const fallbackReason = typeof input.fallbackReason === 'string' ? input.fallbackReason.trim() : '';
    if (fallbackReason) {
        recordInsightChatRouteFallbackReason(input.route, fallbackReason);
    }
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
    recordInsightChatRouteLatency(input.route, latencyMs);

    if (!input.skipLatencyBudgetCheck && typeof latencyMs === 'number') {
        const breachedLatencyBudget = latencyMs > config.latencyBudgetMs;
        setLatestLatencyBudgetBreach(input.route, breachedLatencyBudget);
        if (breachedLatencyBudget) {
            maybeAppendTrace('guardrail:latency_budget_exceeded');
            incrementLatencyBudgetExceededMetric(input.route);
            logInsightChatRouteEvent(input.route, 'guardrail.latency_budget_exceeded', {
                requestId: input.requestId,
                latencyMs,
                budgetMs: config.latencyBudgetMs,
            });
        }
    } else {
        setLatestLatencyBudgetBreach(input.route, false);
    }

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
    latestLatencyBudgetBreachedByRoute.clear();
    requestOutcomeCountsByRouteAndType.clear();
    fallbackStreakAlertCountsByRouteAndReason.clear();
    providerRequestCountsByRouteAndProvider.clear();
    responseSourceCountsByRouteAndSource.clear();
    citationQualityCountsByRouteAndQuality.clear();
    fallbackTotalsByRouteAndReason.clear();
    responseModeCountsByRouteAndMode.clear();
    memoryModeCountsByRouteAndMode.clear();
    feedbackRatingCountsByRouteAndRating.clear();
    feedbackHasReasonCountsByRouteAndState.clear();
    feedbackReasonCategoryCountsByRouteAndCategory.clear();
    latencySamplesByRoute.clear();
}

export function __resetInsightChatRouteGuardrailsForTest(): void {
    resetInsightChatRouteGuardrails();
}
