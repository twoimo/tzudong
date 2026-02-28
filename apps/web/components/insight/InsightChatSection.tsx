'use client';

import {
    type ChangeEvent,
    type ComponentPropsWithoutRef,
    type KeyboardEvent,
    type PointerEvent,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    AlertCircle,
    Bot,
    Check,
    Download,
    Upload,
    Pencil,
    Pin,
    PinOff,
    RefreshCw,
    Square,
    Paperclip,
    Copy,
    Send,
    User,
    PlusCircle,
    Settings,
    Eye,
    EyeOff,
    ChevronDown,
    Trash2,
    ThumbsUp,
    ThumbsDown,
    X,
} from 'lucide-react';
import { hierarchy, treemap, treemapResquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { parseInsightChatStreamLine, type InsightChatStreamState } from '@/lib/insight/insight-chat-stream';
import type {
    AdminInsightChatBootstrapResponse,
    AdminInsightChatGuardrailMetricsResetResponse,
    AdminInsightChatGuardrailMetricsResponse,
    AdminInsightChatResponse,
    InsightChatFollowUpPrompt,
    AdminInsightChatMeta,
    InsightChatGuardrailConfig,
    InsightChatGuardrailRouteMetrics,
    InsightChatSource,
    InsightChatResponseMode,
    InsightChatMemoryMode,
    LlmProvider,
    LlmModelOption,
    InsightChatFeedbackContext,
    InsightChatFeedbackRating,
    InsightChatAttachmentInput,
    InsightChatContextMessage,
    StoryboardModelProfile,
} from '@/types/insight';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: InsightChatSource[];
    createdAt: Date;
    followUpPrompts?: InsightChatFollowUpPrompt[];
    meta?: AdminInsightChatResponse['meta'];
    visualComponent?: AdminInsightChatResponse['visualComponent'];
};

type ChatConversation = {
    id: string;
    title: string;
    messages: ChatMessage[];
    tags: string[];
    createdAt: number;
    updatedAt: number;
    isBooting: boolean;
    bootstrapFailed: boolean;
    pinned?: boolean;
    contextWindowSize?: number;
    responseMode?: InsightChatResponseMode;
    memoryMode?: InsightChatMemoryMode;
    memoryProfileNote?: string;
};

const EMPTY_TITLE = '새로운 대화';
const CHAT_BOOTSTRAP_TTL_MS = 4 * 60 * 1000;
const CHAT_RESPONSE_TTL_MS = 3 * 60 * 1000;
const CHAT_REQUEST_TIMEOUT_MS = 18_000;
const CHAT_REQUEST_RETRY_ATTEMPTS = 1;
const CHAT_REQUEST_RETRY_BASE_DELAY_MS = 250;
const CHAT_REQUEST_CACHE_LIMIT = 64;
const CHAT_GUARDRAIL_METRICS_STALE_MS = 15_000;
const CHAT_GUARDRAIL_METRICS_REFRESH_MS = 60_000;
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 220;
const MAX_FOLLOW_UP_PROMPT_LENGTH = 120;
const MAX_EXPORT_FILE_NAME_PART_LENGTH = 80;
const CHAT_DELETE_UNDO_TIMEOUT_MS = 8000;
const CHAT_DELETE_CONFIRM_LABEL = '삭제할 대화를 정말 삭제할까요?\n삭제하면 8초 안에 복구할 수 있습니다.';
const DEFAULT_RESPONSE_MODE: InsightChatResponseMode = 'fast';
const DEFAULT_MEMORY_MODE: InsightChatMemoryMode = 'off';
const CHAT_RESPONSE_MODES: { value: InsightChatResponseMode; label: string; description: string }[] = [
    { value: 'fast', label: '빠른 응답', description: '짧고 실행 중심 요약' },
    { value: 'deep', label: '깊은 분석', description: '맥락과 근거 중심 심층 분석' },
    { value: 'structured', label: '구조화', description: '항목별 정형형 답변' },
];
const CHAT_MEMORY_MODES: { value: InsightChatMemoryMode; label: string; description: string }[] = [
    { value: 'off', label: '기억 안함', description: '이전 대화 맥락을 사용하지 않습니다.' },
    { value: 'session', label: '세션 기억', description: '현재 대화 기록을 참고해 답변합니다.' },
    { value: 'pinned', label: '핀 고정', description: '중요 메시지를 우선 반영합니다.' },
];
const RESPONSE_MODE_CONFIDENCE_SCORE: Record<InsightChatResponseMode, number> = {
    fast: 0.78,
    deep: 0.86,
    structured: 0.83,
};
const RESPONSE_MODE_BADGE_STYLES: Record<InsightChatResponseMode, string> = {
    fast: 'bg-[#ecfeff] text-[#155e75]',
    deep: 'bg-[#eef2ff] text-[#3730a3]',
    structured: 'bg-[#fef3c7] text-[#92400e]',
};
const MEMORY_MODE_BADGE_STYLES: Record<InsightChatMemoryMode, string> = {
    off: 'bg-[#f3f4f6] text-[#374151]',
    session: 'bg-[#f0f9ff] text-[#0c4a6e]',
    pinned: 'bg-[#fff7ed] text-[#9a3412]',
};
const META_CITATION_QUALITY_LABELS: Record<NonNullable<AdminInsightChatMeta['citationQuality']>, string> = {
    none: '없음',
    low: '낮음',
    medium: '보통',
    high: '높음',
};
const META_CITATION_QUALITY_BADGE_STYLES: Record<NonNullable<AdminInsightChatMeta['citationQuality']>, string> = {
    none: 'bg-[#f3f4f6] text-[#4b5563]',
    low: 'bg-[#fff7ed] text-[#9a3412]',
    medium: 'bg-[#fef3c7] text-[#92400e]',
    high: 'bg-[#dcfce7] text-[#166534]',
};
const VALID_CITATION_QUALITY_BUCKETS = new Set<NonNullable<AdminInsightChatMeta['citationQuality']>>([
    'none',
    'low',
    'medium',
    'high',
]);
const CHAT_RESPONSE_MODE_PANEL_LABELS: Record<InsightChatResponseMode, string> = {
    fast: '빠른 응답',
    deep: '깊은 분석',
    structured: '구조화',
};
const CHAT_MEMORY_MODE_PANEL_LABELS: Record<InsightChatMemoryMode, string> = {
    off: '기억 안함',
    session: '세션 기억',
    pinned: '핀 고정',
};
const FEEDBACK_RATING_PANEL_LABELS: Record<InsightChatFeedbackRating, string> = {
    up: '좋아요',
    down: '싫어요',
};
const FEEDBACK_HAS_REASON_PANEL_LABELS: Record<'with_reason' | 'without_reason', string> = {
    with_reason: '사유 있음',
    without_reason: '사유 없음',
};
const FEEDBACK_REASON_CATEGORY_PANEL_LABELS: Record<
    'accuracy' | 'relevance' | 'completeness' | 'tone' | 'latency' | 'other',
    string
> = {
    accuracy: '정확성',
    relevance: '관련성',
    completeness: '완전성',
    tone: '톤',
    latency: '지연',
    other: '기타',
};
const MESSAGE_WINDOW_INITIAL = 80;
const MESSAGE_WINDOW_BATCH = 80;
const CHAT_STORAGE_KEY = 'tzudong-admin-insight-conversations-v1';
const CHAT_STORAGE_SCHEMA_VERSION = 6;
const CHAT_PERSIST_DEBOUNCE_MS = 350;
const LLM_KEYS_STORAGE_KEY = 'tzudong-admin-llm-keys';
const LLM_MODEL_STORAGE_KEY = 'tzudong-admin-llm-active-model';
const LLM_ENABLED_MODELS_KEY = 'tzudong-admin-llm-enabled-models';
const STORYBOARD_PROFILE_STORAGE_KEY = 'tzudong-admin-storyboard-profile';
const STREAM_STOP_MESSAGE = '답변 생성을 중단했습니다. 재생성 버튼으로 다시 요청해 주세요.';
const COPY_SUCCESS_MESSAGE = '복사했습니다';
const CONTEXT_WINDOW_CHOICES = [20, 40, 80, 120];
const META_SOURCE_PANEL_LABELS: Record<NonNullable<AdminInsightChatMeta['source']> & string, string> = {
    local: '로컬 분석',
    agent: '에이전트',
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    fallback: '폴백 응답',
};

const META_FALLBACK_REASON_LABELS: Record<string, string> = {
    empty_input: '입력 없음',
    llm_unavailable: 'LLM 응답 불가',
    invalid_feedback: '잘못된 피드백 형식',
    invalid_context: '잘못된 기억 컨텍스트',
    invalid_model: '잘못된 모델 설정',
    invalid_attachment: '잘못된 첨부 파일',
    request_cancelled: '요청 중단',
    request_failed: '요청 실패',
    policy_rejection: '정책 위반',
    stream_error: '스트리밍 오류',
    stream_no_data: '스트리밍 응답 없음',
    route_timeout: '요청 시간 초과',
    bootstrap_failed: '초기화 실패',
    server_error: '서버 오류',
    storyboard_agent_unavailable: '스토리보드 에이전트 응답 없음',
    storyboard_qna_local: '스토리보드 로컬 폴백',
    storyboard_internal_fallback: '스토리보드 내부 폴백',
    storyboard_need_human: '수동 검토 필요',
    storyboard_local_fallback: '스토리보드 로컬 폴백',
    storyboard_simple_chat: '스토리보드 단순 채팅',
    storyboard_qna_unavailable: '스토리보드 Q&A 불가',
};
const GUARDRAIL_METRIC_OTHER_LABEL = '기타';
const GUARDRAIL_METRIC_BADGE_MAX_LABEL_CHARS = 16;
const VALID_GUARDRAIL_FEEDBACK_REASON_CATEGORIES = new Set(
    ['accuracy', 'relevance', 'completeness', 'tone', 'latency', 'other'] as const,
);

function isFeedbackReasonCategoryBucket(
    value: string,
): value is keyof typeof FEEDBACK_REASON_CATEGORY_PANEL_LABELS {
    return VALID_GUARDRAIL_FEEDBACK_REASON_CATEGORIES.has(value as keyof typeof FEEDBACK_REASON_CATEGORY_PANEL_LABELS);
}

function sanitizeMetaValue(value: string | undefined): string {
    if (!value) return '';
    return value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
}

function getSourceLabel(source: AdminInsightChatMeta['source'] | undefined): string {
    if (!source) return '출처 미정';
    return META_SOURCE_PANEL_LABELS[source] ?? source;
}

export function getFallbackReasonLabel(reason: string | undefined): string | null {
    if (!reason) return null;
    const sanitized = sanitizeMetaValue(reason);
    if (!sanitized) return null;
    const normalized = sanitized.toLowerCase();
    if (normalized === 'other') {
        return GUARDRAIL_METRIC_OTHER_LABEL;
    }
    return META_FALLBACK_REASON_LABELS[normalized as keyof typeof META_FALLBACK_REASON_LABELS] ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

function getModelLabel(model: string | undefined): string | null {
    const sanitized = sanitizeMetaValue(model);
    if (!sanitized) return null;
    return sanitized;
}

function getRequestIdLabel(requestId: string | undefined): string | null {
    const sanitized = sanitizeMetaValue(requestId);
    if (!sanitized) return null;
    return sanitized;
}

function getCitationQualityLabel(quality: AdminInsightChatMeta['citationQuality']): string | null {
    if (!quality) return null;
    return META_CITATION_QUALITY_LABELS[quality] ?? quality;
}

export function getCitationQualityMetricLabel(quality: string): string {
    const normalized = sanitizeMetaValue(quality).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'other') return GUARDRAIL_METRIC_OTHER_LABEL;
    return META_CITATION_QUALITY_LABELS[normalized as NonNullable<AdminInsightChatMeta['citationQuality']>] ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

export function getCitationQualityMetricBadgeStyle(quality: string): string {
    const normalized = sanitizeMetaValue(quality).toLowerCase();
    if (!normalized) return 'bg-[#f3f4f6] text-[#4b5563]';
    if (normalized === 'other') return 'bg-[#f3f4f6] text-[#4b5563]';
    return META_CITATION_QUALITY_BADGE_STYLES[normalized as NonNullable<AdminInsightChatMeta['citationQuality']>] ?? 'bg-[#f3f4f6] text-[#4b5563]';
}

function getCitationQualityFromSources(
    sources: InsightChatSource[] | undefined,
): NonNullable<AdminInsightChatMeta['citationQuality']> {
    const uniqueSourceKeys = new Set<string>();

    for (const source of sources ?? []) {
        if (!source || typeof source !== 'object') continue;
        const text = sanitizeMetaValue(source.text);
        if (!text) continue;

        const key = `${sanitizeMetaValue(source.videoTitle) || 'unknown'}|${sanitizeMetaValue(source.youtubeLink) || 'unknown'}|${sanitizeMetaValue(source.timestamp) || 'unknown'}`
            .toLowerCase();
        uniqueSourceKeys.add(key);
    }

    if (uniqueSourceKeys.size <= 0) return 'none';
    if (uniqueSourceKeys.size <= 2) return 'low';
    if (uniqueSourceKeys.size <= 4) return 'medium';
    return 'high';
}

function isInsightChatResponseMode(raw: unknown): raw is InsightChatResponseMode {
    return raw === 'fast' || raw === 'deep' || raw === 'structured';
}

function normalizeResponseMode(raw: unknown): InsightChatResponseMode {
    return isInsightChatResponseMode(raw) ? raw : DEFAULT_RESPONSE_MODE;
}

function isInsightChatMemoryMode(raw: unknown): raw is InsightChatMemoryMode {
    return raw === 'off' || raw === 'session' || raw === 'pinned';
}

function normalizeMemoryMode(raw: unknown): InsightChatMemoryMode {
    return isInsightChatMemoryMode(raw) ? raw : DEFAULT_MEMORY_MODE;
}

type InsightChatGuardrailSummary = {
    totalLatencyBudgetExceeded: number;
    totalFallbackStreakAlerts: number;
    dominantFallbackReason: string | null;
    dominantFallbackCount: number;
};

type InsightChatGuardrailRouteOutcomeTotals = {
    totalRequests: number;
    successResponses: number;
    fallbackResponses: number;
    streamResponses: number;
    errorResponses: number;
};

type InsightChatGuardrailRouteOutcomeRateSummary = {
    totalRequests: number;
    successRate: number;
    fallbackRate: number;
    errorRate: number;
};
type InsightChatGuardrailRouteMetricEntries = Array<[string, number]>;

const DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG: InsightChatGuardrailConfig = {
    enabled: true,
    latencyBudgetMs: 4_500,
    fallbackStreakThreshold: 3,
    fallbackWindowMs: 90_000,
    fallbackAlertCooldownMs: 60_000,
};

function toNonNegativeInteger(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMetricCount(raw: unknown): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
}

function normalizeMetricCounts(raw: unknown): Record<string, number> {
    if (!isRecord(raw)) return {};
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        const sanitizedKey = sanitizeMetaValue(key).toLowerCase();
        const count = normalizeMetricCount(value);
        if (!sanitizedKey || count <= 0) continue;
        counts[sanitizedKey] = (counts[sanitizedKey] ?? 0) + count;
    }
    return counts;
}

function getTopMetricEntries(
    raw: unknown,
    limit = 3,
): InsightChatGuardrailRouteMetricEntries {
    const counts = normalizeMetricCounts(raw);
    return Object.entries(counts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit);
}

export function getGuardrailMetricLabel(value: string): string {
    const normalized = sanitizeMetaValue(value);
    if (!normalized) return '';
    const lower = normalized.toLowerCase();
    if (lower === 'other') {
        return GUARDRAIL_METRIC_OTHER_LABEL;
    }

    return META_SOURCE_PANEL_LABELS[lower as keyof typeof META_SOURCE_PANEL_LABELS]
        ?? LLM_PROVIDER_LABELS[normalized as LlmProvider]
        ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

export function getResponseModeMetricLabel(value: string): string {
    const normalized = sanitizeMetaValue(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'other') return GUARDRAIL_METRIC_OTHER_LABEL;
    return CHAT_RESPONSE_MODE_PANEL_LABELS[normalized as InsightChatResponseMode] ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

export function getMemoryModeMetricLabel(value: string): string {
    const normalized = sanitizeMetaValue(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'other') return GUARDRAIL_METRIC_OTHER_LABEL;
    return CHAT_MEMORY_MODE_PANEL_LABELS[normalized as InsightChatMemoryMode] ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

export function getFeedbackRatingMetricLabel(value: string): string {
    const normalized = sanitizeMetaValue(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'other') return GUARDRAIL_METRIC_OTHER_LABEL;
    return FEEDBACK_RATING_PANEL_LABELS[normalized as InsightChatFeedbackRating] ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

export function getFeedbackHasReasonMetricLabel(value: string): string {
    const normalized = sanitizeMetaValue(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'other') return GUARDRAIL_METRIC_OTHER_LABEL;
    return FEEDBACK_HAS_REASON_PANEL_LABELS[normalized as 'with_reason' | 'without_reason'] ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

export function getFeedbackReasonCategoryMetricLabel(value: string): string {
    const normalized = sanitizeMetaValue(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'other') return GUARDRAIL_METRIC_OTHER_LABEL;
    return FEEDBACK_REASON_CATEGORY_PANEL_LABELS[normalized as keyof typeof FEEDBACK_REASON_CATEGORY_PANEL_LABELS]
        ?? GUARDRAIL_METRIC_OTHER_LABEL;
}

function getCompactGuardrailMetricLabel(label: string): string {
    return label.length <= GUARDRAIL_METRIC_BADGE_MAX_LABEL_CHARS ? label : `${label.slice(0, GUARDRAIL_METRIC_BADGE_MAX_LABEL_CHARS - 1)}…`;
}

function renderGuardrailMetricBadge(
    label: string,
    count: number,
    className: string,
    suffix = '',
){
    const compactLabel = getCompactGuardrailMetricLabel(label);
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${className}`}>
            <span className="max-w-[8.5rem] min-w-0 truncate" title={label}>
                {compactLabel}
            </span>
            <span className="ml-1">: {count}{suffix}</span>
        </span>
    );
}

function toNonNegativeRate(value: number, denominator: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(denominator) || denominator <= 0) return 0;
    return Math.max(0, Math.round((value / denominator) * 1000) / 10);
}

function normalizeGuardrailRouteOutcomeTotals(raw: unknown): InsightChatGuardrailRouteOutcomeTotals {
    const totals = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

    const totalRequests = normalizeMetricCount(
        totals.total_requests ?? totals.totalRequests,
    );
    const successResponses = normalizeMetricCount(
        totals.success_responses ?? totals.successResponses,
    );
    const fallbackResponses = normalizeMetricCount(
        totals.fallback_responses ?? totals.fallbackResponses,
    );
    const streamResponses = normalizeMetricCount(
        totals.stream_responses ?? totals.streamResponses,
    );
    const errorResponses = normalizeMetricCount(
        totals.error_responses ?? totals.errorResponses,
    );
    const derivedTotal = successResponses + fallbackResponses + streamResponses + errorResponses;

    return {
        totalRequests: totalRequests > 0 ? totalRequests : derivedTotal,
        successResponses,
        fallbackResponses,
        streamResponses,
        errorResponses,
    };
}

export function summarizeInsightChatGuardrailRouteOutcomeRates(
    metrics: InsightChatGuardrailRouteMetrics | unknown,
): InsightChatGuardrailRouteOutcomeRateSummary {
    const totals = normalizeGuardrailRouteOutcomeTotals(
        metrics instanceof Object ? metrics : null,
    );

    return {
        totalRequests: totals.totalRequests,
        successRate: toNonNegativeRate(totals.successResponses, totals.totalRequests),
        fallbackRate: toNonNegativeRate(totals.fallbackResponses, totals.totalRequests),
        errorRate: toNonNegativeRate(totals.errorResponses, totals.totalRequests),
    };
}

function normalizeGuardrailRouteMetrics(raw: unknown): InsightChatGuardrailRouteMetrics {
    if (!isRecord(raw)) {
        return {
            latency_budget_exceeded: 0,
            reliability_fallback_streak_alerts: {},
            total_requests: 0,
            success_responses: 0,
            fallback_responses: 0,
            stream_responses: 0,
            error_responses: 0,
            citation_quality_counts: {},
            provider_request_counts: {},
            source_counts: {},
            fallback_totals: {},
            response_mode_counts: {},
            memory_mode_counts: {},
            feedback_rating_counts: {},
            feedback_has_reason_counts: {},
        };
    }

    const providerCounts = normalizeMetricCounts(
        raw.provider_request_counts ?? raw.providerRequestCounts ?? raw.provider_counts ?? raw.providers,
    );
    const citationQualityCounts = (() => {
        const rawCitationCounts = normalizeMetricCounts(
            raw.citation_quality_counts ?? raw.citationQualityCounts ?? raw.citation_quality_distributions,
        );

        const validEntries: Record<string, number> = {};
        for (const [quality, count] of Object.entries(rawCitationCounts)) {
            const normalizedQuality = sanitizeMetaValue(quality).toLowerCase();
            if (!normalizedQuality || count <= 0) {
                continue;
            }
            const bucket = VALID_CITATION_QUALITY_BUCKETS.has(
                normalizedQuality as NonNullable<AdminInsightChatMeta['citationQuality']>,
            )
                ? normalizedQuality
                : 'other';

            validEntries[bucket] = (validEntries[bucket] ?? 0) + count;
        }

        return validEntries;
    })();
    const sourceCounts = normalizeMetricCounts(
        raw.source_counts ?? raw.sourceCounts ?? raw.response_source_counts ?? raw.responseSourceCounts ?? raw.sources,
    );
    const fallbackTotals = normalizeMetricCounts(
        raw.fallback_totals ?? raw.fallbackTotals ?? raw.fallback_reason_totals ?? raw.fallbackReasonTotals ?? raw.reliability_fallback_streak_alerts,
    );
    const responseModeCounts = normalizeMetricCounts(
        raw.response_mode_counts ?? raw.responseModeCounts ?? raw.response_modes ?? raw.responseModes,
    );
    const memoryModeCounts = normalizeMetricCounts(
        raw.memory_mode_counts ?? raw.memoryModeCounts ?? raw.memory_modes ?? raw.memoryModes,
    );
    const feedbackRatingCounts = normalizeMetricCounts(
        raw.feedback_rating_counts ?? raw.feedbackRatingCounts ?? raw.feedback_ratings ?? raw.feedbackRatings ?? raw.feedback_counts ?? raw.feedbackCounts,
    );
    const feedbackHasReasonCounts = normalizeMetricCounts(
        raw.feedback_has_reason_counts
            ?? raw.feedbackHasReasonCounts
            ?? raw.feedback_has_reasons
            ?? raw.feedback_hasReasonCounts
            ?? raw.feedback_reason_counts
            ?? raw.feedbackReasonCounts,
    );
    const feedbackReasonCategoryCounts = (() => {
        const rawReasonCategoryCounts = normalizeMetricCounts(
            raw.feedback_reason_category_counts
                ?? raw.feedbackReasonCategoryCounts
                ?? raw.feedback_reason_categories
                ?? raw.feedbackReasonCategories,
        );

        const validEntries: Record<string, number> = {};
        for (const [bucket, count] of Object.entries(rawReasonCategoryCounts)) {
            const normalizedBucket = sanitizeMetaValue(bucket).toLowerCase();
            if (!normalizedBucket || count <= 0) continue;

            const effectiveBucket = isFeedbackReasonCategoryBucket(normalizedBucket)
                ? normalizedBucket
                : 'other';
            validEntries[effectiveBucket] = (validEntries[effectiveBucket] ?? 0) + count;
        }

        return validEntries;
    })();
    const outcomeTotals = normalizeGuardrailRouteOutcomeTotals(raw);

    const fallbackRaw = raw.reliability_fallback_streak_alerts;
    const fallbackCounts: Record<string, number> = {};
    if (isRecord(fallbackRaw)) {
        for (const [reason, value] of Object.entries(fallbackRaw)) {
            const normalizedReason = sanitizeMetaValue(reason).toLowerCase();
            const count = toNonNegativeInteger(value);
            if (!normalizedReason || count <= 0) continue;
            fallbackCounts[normalizedReason] = (fallbackCounts[normalizedReason] ?? 0) + count;
        }
    }

    return {
        latency_budget_exceeded: toNonNegativeInteger(raw.latency_budget_exceeded),
        reliability_fallback_streak_alerts: fallbackCounts,
        total_requests: outcomeTotals.totalRequests,
        success_responses: outcomeTotals.successResponses,
        fallback_responses: outcomeTotals.fallbackResponses,
        stream_responses: outcomeTotals.streamResponses,
        error_responses: outcomeTotals.errorResponses,
        citation_quality_counts: citationQualityCounts,
        provider_request_counts: providerCounts,
        source_counts: sourceCounts,
        fallback_totals: fallbackTotals,
        response_mode_counts: responseModeCounts,
            memory_mode_counts: memoryModeCounts,
            feedback_rating_counts: feedbackRatingCounts,
            feedback_has_reason_counts: feedbackHasReasonCounts,
            ...(Object.keys(feedbackReasonCategoryCounts).length > 0
                ? { feedback_reason_category_counts: feedbackReasonCategoryCounts }
                : {}),
        };
}

function normalizeGuardrailConfig(raw: unknown): InsightChatGuardrailConfig {
    if (!isRecord(raw)) {
        return { ...DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG };
    }

    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG.enabled,
        latencyBudgetMs: toNonNegativeInteger(raw.latencyBudgetMs) || DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG.latencyBudgetMs,
        fallbackStreakThreshold: toNonNegativeInteger(raw.fallbackStreakThreshold) || DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG.fallbackStreakThreshold,
        fallbackWindowMs: toNonNegativeInteger(raw.fallbackWindowMs) || DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG.fallbackWindowMs,
        fallbackAlertCooldownMs: toNonNegativeInteger(raw.fallbackAlertCooldownMs) || DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG.fallbackAlertCooldownMs,
    };
}

function createEmptyGuardrailRouteMetrics(): InsightChatGuardrailRouteMetrics {
    return {
        latency_budget_exceeded: 0,
        reliability_fallback_streak_alerts: {},
        total_requests: 0,
        success_responses: 0,
        fallback_responses: 0,
        stream_responses: 0,
        error_responses: 0,
        citation_quality_counts: {},
        provider_request_counts: {},
        source_counts: {},
        fallback_totals: {},
        response_mode_counts: {},
        memory_mode_counts: {},
        feedback_rating_counts: {},
        feedback_has_reason_counts: {},
    };
}

export function createEmptyInsightChatGuardrailMetricsResponse(): AdminInsightChatGuardrailMetricsResponse {
    return {
        timestamp: new Date(0).toISOString(),
        routes: {
            chat: createEmptyGuardrailRouteMetrics(),
            stream: createEmptyGuardrailRouteMetrics(),
        },
        guardrailConfig: { ...DEFAULT_INSIGHT_CHAT_GUARDRAIL_CONFIG },
    };
}

export function normalizeInsightChatGuardrailMetricsResponse(raw: unknown): AdminInsightChatGuardrailMetricsResponse {
    const fallback = createEmptyInsightChatGuardrailMetricsResponse();
    if (!isRecord(raw)) {
        return fallback;
    }

    const routes = isRecord(raw.routes) ? raw.routes : {};
    const timestamp = typeof raw.timestamp === 'string' && raw.timestamp.trim()
        ? raw.timestamp
        : fallback.timestamp;

    return {
        timestamp,
        routes: {
            chat: normalizeGuardrailRouteMetrics(routes.chat),
            stream: normalizeGuardrailRouteMetrics(routes.stream),
        },
        guardrailConfig: normalizeGuardrailConfig(raw.guardrailConfig),
    };
}

export function summarizeInsightChatGuardrailMetrics(
    payload: AdminInsightChatGuardrailMetricsResponse | null | undefined,
): InsightChatGuardrailSummary {
    const normalized = payload ? normalizeInsightChatGuardrailMetricsResponse(payload) : createEmptyInsightChatGuardrailMetricsResponse();
    const reasons = new Map<string, number>();
    let totalLatencyBudgetExceeded = 0;

    for (const routeMetrics of Object.values(normalized.routes)) {
        totalLatencyBudgetExceeded += toNonNegativeInteger(routeMetrics.latency_budget_exceeded);
        const fallbackTotals = routeMetrics.fallback_totals ?? routeMetrics.reliability_fallback_streak_alerts;
        for (const [reason, count] of Object.entries(fallbackTotals)) {
            const normalizedReason = sanitizeMetaValue(reason).toLowerCase();
            const safeCount = toNonNegativeInteger(count);
            if (!normalizedReason || safeCount <= 0) continue;
            const effectiveReason = META_FALLBACK_REASON_LABELS[
                normalizedReason as keyof typeof META_FALLBACK_REASON_LABELS
            ]
                ? normalizedReason
                : 'other';

            reasons.set(effectiveReason, (reasons.get(effectiveReason) ?? 0) + safeCount);
        }
    }

    const sortedReasons = [...reasons.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    return {
        totalLatencyBudgetExceeded,
        totalFallbackStreakAlerts: [...reasons.values()].reduce((sum, value) => sum + value, 0),
        dominantFallbackReason: sortedReasons[0]?.[0] ?? null,
        dominantFallbackCount: sortedReasons[0]?.[1] ?? 0,
    };
}

function sanitizeConversationTag(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_CONVERSATION_TAG_LENGTH);
}

export function normalizeConversationTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const value of raw) {
        const normalized = sanitizeConversationTag(value);
        if (!normalized || out.includes(normalized)) continue;
        out.push(normalized);
        if (out.length >= MAX_CONVERSATION_TAGS) break;
    }
    return out;
}

export type InsightConversationFilter = typeof CONVERSATION_FILTER_ALL | typeof CONVERSATION_FILTER_PINNED | `tag:${string}`;

export type ParsedConversationImport = {
    conversations: ChatConversation[];
    activeConversationId: string;
};

function normalizeImportedConversationId(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim().replace(/\s+/g, '').slice(0, 120) : '';
}

function sanitizeImportedConversationText(raw: unknown, preserveLineBreaks = false): string {
    if (typeof raw !== 'string') return '';
    const controlPattern = preserveLineBreaks ? /[\u0000-\b\f\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]+/g;
    const normalized = raw
        .replace(controlPattern, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized;
}

function normalizeImportedMessageId(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim().slice(0, 120) : '';
}

function normalizeImportedDate(raw: unknown): Date {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const fromTimestamp = new Date(raw);
        return Number.isNaN(fromTimestamp.getTime()) ? new Date() : fromTimestamp;
    }

    const fromString = raw instanceof Date
        ? raw
        : typeof raw === 'string'
            ? new Date(raw)
            : null;
    if (!fromString || Number.isNaN(fromString.getTime())) {
        return new Date();
    }
    return fromString;
}

function normalizeImportedNumber(raw: unknown, defaultValue: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return defaultValue;
    return Math.floor(parsed);
}

function normalizePersistedConversation(raw: unknown, schemaVersion: number): ChatConversation | null {
    if (!isRecord(raw)) return null;

    const rawConversation = raw as Partial<PersistedConversation>;
    const id = normalizeImportedConversationId(rawConversation.id);
    const title = sanitizeImportedConversationText(rawConversation.title, true);
    if (!id || !title) {
        return null;
    }

    if (!Array.isArray(rawConversation.messages)) {
        return null;
    }

    const messages = rawConversation.messages
        .filter((message): message is PersistedChatMessage => {
            if (!isRecord(message)) return false;
            const candidate = message as PersistedChatMessage;
            const role = candidate.role;
            if (role !== 'user' && role !== 'assistant') return false;
            const content = sanitizeImportedConversationText(candidate.content, true);
            return Boolean(content) || !!candidate.sources || !!candidate.followUpPrompts || !!candidate.meta || !!candidate.visualComponent;
        })
        .map((message) => {
            const candidate = message as PersistedChatMessage;
            return {
                id: normalizeImportedMessageId(candidate.id) || makeId(candidate.role === 'assistant' ? 'assistant' : 'user'),
                role: candidate.role,
                content: sanitizeImportedConversationText(candidate.content, true),
                sources: mapSources(candidate.sources as InsightChatSource[] | undefined),
                followUpPrompts: normalizeFollowUpPrompts(candidate.followUpPrompts as unknown),
                createdAt: normalizeImportedDate(candidate.createdAt),
                meta: candidate.meta,
                visualComponent: candidate.visualComponent,
            };
        })
        .slice(-MAX_MESSAGES_PER_CONVERSATION);

    const createdAt = normalizeImportedNumber(rawConversation.createdAt, Date.now());
    const updatedAt = normalizeImportedNumber(rawConversation.updatedAt, createdAt);

    return {
        id,
        title,
        messages,
        tags: normalizeConversationTags(rawConversation.tags),
        createdAt,
        updatedAt,
        isBooting: false,
        bootstrapFailed: Boolean(rawConversation.bootstrapFailed),
        pinned: schemaVersion >= 2 ? Boolean(rawConversation.pinned) : false,
        contextWindowSize: typeof rawConversation.contextWindowSize === 'number' && Number.isFinite(rawConversation.contextWindowSize)
            ? Math.max(1, Math.floor(rawConversation.contextWindowSize))
            : MESSAGE_WINDOW_INITIAL,
        responseMode: normalizeResponseMode(rawConversation.responseMode),
        memoryMode: schemaVersion >= 5
            ? normalizeMemoryMode(rawConversation.memoryMode)
            : DEFAULT_MEMORY_MODE,
        memoryProfileNote: schemaVersion >= 6
            ? sanitizeMemoryProfileNote(rawConversation.memoryProfileNote)
            : undefined,
    };
}

export function parseConversationImportPayload(raw: unknown): ParsedConversationImport | null {
    if (!isRecord(raw)) return null;

    const schemaVersionRaw = raw.schemaVersion ?? raw.version;
    const schemaVersionCandidate = Number(schemaVersionRaw);
    const schemaVersion = Number.isInteger(schemaVersionCandidate) && schemaVersionCandidate >= 1 && schemaVersionCandidate <= CHAT_STORAGE_SCHEMA_VERSION
        ? schemaVersionCandidate
        : CHAT_STORAGE_SCHEMA_VERSION;

    if (raw.conversation !== undefined) {
        const single = normalizePersistedConversation(raw.conversation as unknown, schemaVersion);
        if (!single) return null;
        return {
            conversations: [single],
            activeConversationId: single.id,
        };
    }

    if (!Array.isArray(raw.conversations)) {
        return null;
    }

    const conversations = raw.conversations
        .map((item) => normalizePersistedConversation(item, schemaVersion))
        .filter((conversation): conversation is ChatConversation => conversation !== null)
        .slice(0, MAX_CONVERSATIONS);

    if (conversations.length === 0) {
        return null;
    }

    const activeConversationId = typeof raw.activeConversationId === 'string'
        ? normalizeImportedConversationId(raw.activeConversationId)
        : conversations[0].id;

    return {
        conversations,
        activeConversationId: conversations.some((conversation) => conversation.id === activeConversationId)
            ? activeConversationId
            : conversations[0].id,
    };
}

export function mergeImportedConversations(
    existingConversations: readonly ChatConversation[],
    importedConversations: readonly ChatConversation[],
): ChatConversation[] {
    const reservedConversationIds = new Set(existingConversations.map((conversation) => conversation.id));
    const reservedMessageIds = new Set(
        existingConversations.flatMap((conversation) => conversation.messages.map((message) => message.id)),
    );

    const normalizedImported = importedConversations
        .map((conversation): ChatConversation | null => {
            const conversationId = reservedConversationIds.has(conversation.id)
                ? makeConversationId()
                : conversation.id;

            reservedConversationIds.add(conversationId);

            const dedupedMessages = conversation.messages
                .filter((message): message is ChatMessage => Boolean(message.role) && Boolean(message.id))
                .map((message) => {
                    const nextMessageId = reservedMessageIds.has(message.id) ? makeId(message.role === 'assistant' ? 'assistant' : 'user') : message.id;
                    reservedMessageIds.add(nextMessageId);
                    return {
                        ...message,
                        id: nextMessageId,
                    };
                });

            return {
                ...conversation,
                id: conversationId,
                messages: dedupedMessages,
                title: sanitizeImportedConversationText(conversation.title),
                isBooting: false,
            };
        })
        .filter((conversation): conversation is ChatConversation => Boolean(conversation));

    const merged = [...normalizedImported, ...existingConversations].slice(0, MAX_CONVERSATIONS);
    return merged;
}

export function matchesInsightConversationFilter(
    conversation: Pick<ChatConversation, 'title' | 'messages' | 'pinned' | 'tags'>,
    query: string,
    filter: InsightConversationFilter = CONVERSATION_FILTER_ALL,
): boolean {
    const tags = normalizeConversationTags(conversation.tags);
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedFilter = filter.trim().toLowerCase();
    const isPinnedFilter = normalizedFilter === CONVERSATION_FILTER_PINNED;
    const filterTag = normalizedFilter.startsWith('tag:')
        ? sanitizeConversationTag(normalizedFilter.slice(4))
        : '';

    if (isPinnedFilter && !conversation.pinned) {
        return false;
    }
    if (filterTag && !tags.includes(filterTag)) {
        return false;
    }

    if (!normalizedQuery) {
        return true;
    }

    const title = (conversation.title || '').toLowerCase();
    const preview = conversation.messages
        .map((message) => message.content)
        .join('\n')
        .toLowerCase();
    const pinKeywords = conversation.pinned ? 'pin 고정 pinned' : '';
    const tagText = tags.join(' ');

    return (
        title.includes(normalizedQuery)
        || preview.includes(normalizedQuery)
        || pinKeywords.includes(normalizedQuery)
        || tagText.includes(normalizedQuery)
    );
}

function getConfidenceLabel(confidence: number | undefined): string | null {
    if (!Number.isFinite(confidence as number)) return null;
    const normalized = Math.min(1, Math.max(0, confidence as number));
    const asPercent = Math.round(normalized * 100);
    return `${asPercent}%`;
}

function getLatencyLabel(latencyMs: number | undefined): string | null {
    if (!Number.isFinite(latencyMs as number)) return null;
    const normalized = Math.max(0, Math.round(latencyMs as number));
    return `${normalized}ms`;
}

const MAX_FOLLOW_UP_PROMPTS = 4;
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_ATTACHMENT_BYTES = 200_000;
const MAX_CHAT_ATTACHMENT_CONTENT_LENGTH = 12_000;
const MAX_REQUEST_CONTEXT_MESSAGES = 12;
const MAX_REQUEST_CONTEXT_MESSAGE_CONTENT_LENGTH = 700;
const MAX_MEMORY_PROFILE_NOTE_LENGTH = 120;
const MAX_CONVERSATION_TAGS = 5;
const MAX_CONVERSATION_TAG_LENGTH = 20;
const CONVERSATION_FILTER_ALL = 'all';
const CONVERSATION_FILTER_PINNED = 'pinned';

type DraftChatAttachment = InsightChatAttachmentInput & { id: string };

function sanitizeFollowUpPromptText(value: string | undefined | null): string {
    if (!value) return '';
    return value
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_FOLLOW_UP_PROMPT_LENGTH);
}

export function sanitizeMemoryProfileNote(value: string | undefined | null): string {
    if (!value) return '';
    return value
        .trim()
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_MEMORY_PROFILE_NOTE_LENGTH);
}

function normalizeFeedbackInput(raw: InsightChatFeedbackContext | undefined): InsightChatFeedbackContext | undefined {
    if (!raw) return undefined;
    const rating = raw.rating === 'up' || raw.rating === 'down' ? raw.rating : undefined;
    if (!rating) return undefined;

    const reason = typeof raw.reason === 'string'
        ? raw.reason.trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 280)
        : undefined;
    const targetAssistantMessageId = typeof raw.targetAssistantMessageId === 'string'
        ? raw.targetAssistantMessageId.trim()
        : undefined;

    return {
        rating,
        ...(reason ? { reason } : {}),
        ...(targetAssistantMessageId ? { targetAssistantMessageId } : {}),
    };
}

function sanitizeContextMessageContent(raw: string): string {
    return raw
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_REQUEST_CONTEXT_MESSAGE_CONTENT_LENGTH);
}

type ContextSeedMessage = Pick<ChatMessage, 'role' | 'content' | 'id'>;
type ContextMessageWithWindow = InsightChatContextMessage & { id: string };

export function buildInsightChatContextMessages(
    messages: ContextSeedMessage[],
    memoryMode: InsightChatMemoryMode,
    targetAssistantMessageId?: string,
): InsightChatContextMessage[] {
    if (memoryMode === 'off' || !messages.length) {
        return [];
    }

    const normalizedMessages = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
            role: message.role,
            content: sanitizeContextMessageContent(message.content),
            id: message.id,
        }))
        .filter((message) => message.content.length > 0);

    const normalized = typeof targetAssistantMessageId === 'string'
        ? (() => {
            const targetIndex = normalizedMessages.findIndex(
                (message) => message.role === 'assistant' && message.id === targetAssistantMessageId,
            );
            return targetIndex >= 0 ? normalizedMessages.slice(0, targetIndex + 1) : normalizedMessages;
        })()
        : normalizedMessages;

    const asContextMessages = (messages: ContextMessageWithWindow[]): InsightChatContextMessage[] =>
        messages.map(({ role, content }) => ({ role, content }));

    if (!normalized.length) {
        return [];
    }

    if (memoryMode === 'session') {
        return asContextMessages(normalized.slice(-MAX_REQUEST_CONTEXT_MESSAGES));
    }

    const firstUser = normalized.find((message) => message.role === 'user');
    const latestAssistant = [...normalized].reverse().find((message) => message.role === 'assistant');
    const recent = normalized.slice(-MAX_REQUEST_CONTEXT_MESSAGES);
    const combined = [firstUser, ...recent, latestAssistant].filter(Boolean) as ContextMessageWithWindow[];
    const deduped: ContextMessageWithWindow[] = [];

    for (const message of combined) {
        if (deduped.some((item) => item.role === message.role && item.content === message.content)) {
            continue;
        }
        deduped.push(message);
        if (deduped.length >= MAX_REQUEST_CONTEXT_MESSAGES) {
            break;
        }
    }

    return asContextMessages(deduped);
}

function sanitizeAttachmentName(raw: string): string {
    return raw
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .slice(0, 120);
}

function sanitizeAttachmentContent(raw: string): string {
    return raw
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '')
        .slice(0, MAX_CHAT_ATTACHMENT_CONTENT_LENGTH);
}

function normalizeAttachmentPayload(attachments: InsightChatAttachmentInput[] | undefined): InsightChatAttachmentInput[] {
    if (!attachments?.length) return [];

    return attachments
        .slice(0, MAX_CHAT_ATTACHMENTS)
        .map((attachment) => ({
            name: sanitizeAttachmentName(attachment.name),
            mimeType: (attachment.mimeType || 'text/plain').trim().toLowerCase().slice(0, 80),
            content: sanitizeAttachmentContent(attachment.content),
            sizeBytes: Math.min(
                MAX_CHAT_ATTACHMENT_BYTES,
                Math.max(0, Math.floor(attachment.sizeBytes ?? attachment.content.length)),
            ),
        }))
        .filter((attachment) => !!attachment.name && !!attachment.content.trim());
}

function sanitizeSourceValue(value: string | undefined | null): string {
    if (!value) return '';
    return value
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 260);
}

function normalizeSourceLink(value: string | undefined | null): string {
    const sanitized = sanitizeSourceValue(value);
    if (!sanitized) return '';
    if (!/^https?:\/\//i.test(sanitized)) return '';
    return sanitized;
}

function normalizeFollowUpPromptItem(raw: unknown): InsightChatFollowUpPrompt | null {
    if (!raw) return null;

    if (typeof raw === 'string') {
        const prompt = sanitizeFollowUpPromptText(raw);
        if (!prompt) return null;
        return { prompt };
    }

    if (typeof raw !== 'object') return null;

    const candidate = raw as Partial<InsightChatFollowUpPrompt>;
    const prompt = sanitizeFollowUpPromptText(candidate.prompt);
    if (!prompt) return null;

    const label = sanitizeFollowUpPromptText(candidate.label);
    return {
        prompt,
        ...(label ? { label } : {}),
    };
}

function normalizeFollowUpPrompts(raw: unknown): InsightChatFollowUpPrompt[] {
    if (!Array.isArray(raw)) return [];
    const out: InsightChatFollowUpPrompt[] = [];
    const seen = new Set<string>();

    for (const item of raw) {
        const normalized = normalizeFollowUpPromptItem(item);
        if (!normalized) continue;
        if (seen.has(normalized.prompt)) continue;
        seen.add(normalized.prompt);
        out.push(normalized);
        if (out.length >= MAX_FOLLOW_UP_PROMPTS) break;
    }

    return out;
}

const LLM_MODELS: LlmModelOption[] = [
    // Google Gemini
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'gemini' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'gemini' },
    // OpenAI
    { id: 'gpt-5.3', name: 'GPT-5.3', provider: 'openai' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    // Anthropic
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
];

const LLM_DEFAULT_ENABLED = new Set([
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gpt-5.3',
    'gpt-4o',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
]);

const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
};

type ImageModelSelection = StoryboardModelProfile | 'none';

const IMAGE_MODEL_PROFILES: Array<{ id: ImageModelSelection; name: string }> = [
    { id: 'none', name: '선택 안 함' },
    { id: 'nanobanana', name: '나노 바나나' },
    { id: 'nanobanana_pro', name: '나노 바나나 프로' },
];

type StoredLlmKeys = Partial<Record<LlmProvider, string>>;
type CachedEntry<T> = {
    data: T;
    expiresAt: number;
};

type PersistedChatMessage = Omit<ChatMessage, 'createdAt' | 'meta'> & {
    createdAt: string;
    meta?: AdminInsightChatResponse['meta'];
};

type PersistedChatState = {
    version: 1 | 2 | 3 | 4 | 5 | 6;
    conversations: PersistedConversation[];
    activeConversationId: string;
};
type InsightConversationExportPayload = PersistedChatState & {
    schemaVersion: number;
    exportedAt: string;
};

type PersistedConversation = {
    id: string;
    title: string;
    messages: PersistedChatMessage[];
    createdAt: number;
    updatedAt: number;
    isBooting?: boolean;
    bootstrapFailed?: boolean;
    pinned?: boolean;
    tags?: string[];
    contextWindowSize?: number;
    responseMode?: InsightChatResponseMode;
    memoryMode?: InsightChatMemoryMode;
    memoryProfileNote?: string;
};

const chatBootstrapCache = new Map<string, CachedEntry<AdminInsightChatBootstrapResponse>>();
const chatResponseCache = new Map<string, CachedEntry<AdminInsightChatResponse>>();
const inFlightBootstrapRequest = new Map<string, Promise<AdminInsightChatBootstrapResponse>>();
const inFlightChatRequest = new Map<string, Promise<AdminInsightChatResponse>>();

function sanitizeExportFileNamePart(value: string): string {
    const normalized = value
        .replace(/[\\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '_')
        .trim()
        .slice(0, MAX_EXPORT_FILE_NAME_PART_LENGTH);

    return normalized || 'conversation';
}

function buildExportFileName(base: string): string {
    return `${sanitizeExportFileNamePart(base)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

function triggerJsonDownload(content: string, fileName: string): void {
    if (typeof document === 'undefined') return;

    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const anchor = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
}

export function buildConversationBackupExportPayload(
    conversations: ChatConversation[],
    activeConversationId: string,
    options?: { exportedAt?: string },
): InsightConversationExportPayload | null {
    if (conversations.length === 0) {
        return null;
    }

    const resolvedActiveConversationId = conversations.some((conversation) => conversation.id === activeConversationId)
        ? activeConversationId
        : conversations[0]?.id;

    if (!resolvedActiveConversationId) {
        return null;
    }

    const serialized = serializeConversationList(conversations, resolvedActiveConversationId);
    const exportedAt = options?.exportedAt ?? new Date().toISOString();

    return {
        ...serialized,
        schemaVersion: serialized.version,
        exportedAt,
    };
}

type InsightPromptCommand = {
    id: string;
    command: string;
    label: string;
    prompt: string;
    description: string;
    groupId: string;
    version: number;
    deprecated?: {
        replacedBy?: string;
        migrationHint?: string;
    };
};

type InsightPromptCommandGroup = {
    id: string;
    title: string;
    description: string;
    prompts: InsightPromptCommand[];
};

type ParsedPromptInput = {
    command: string;
    tail: string;
};

type PromptInputResolution = {
    content: string;
    migrationHint: string | null;
};

const INSIGHT_PROMPT_LIBRARY: InsightPromptCommandGroup[] = [
    {
        id: 'analysis',
        title: '분석',
        description: '핵심 지표와 흐름을 빠르게 파악',
        prompts: [
            {
                id: 'summary',
                command: '/summary',
                label: '요약',
                prompt: '최근 7일 성과를 핵심 지표 중심으로 간단하고 실행 가능한 형식으로 요약해줘.',
                description: '요약형 리포트, 핵심 인사이트, 다음 액션 포함',
                groupId: 'analysis',
                version: 1,
            },
            {
                id: 'trend',
                command: '/trend',
                label: '추세',
                prompt: '최근 30일 주요 지표(매출·조회수·전환율)의 추세를 비교하고 상승/하락 요인을 정리해줘.',
                description: '기간별 추세 변화와 임팩트 높은 지표 강조',
                groupId: 'analysis',
                version: 1,
            },
            {
                id: 'snapshot',
                command: '/snapshot',
                label: '현황 스냅샷',
                prompt: '전체 현황을 한 번에 보여줘. 주요 성과 지표, 변동성, 리스크 항목, 권장 액션을 항목별로 정리해줘.',
                description: '운영자 브리핑에 바로 쓸 수 있는 1페이지 요약',
                groupId: 'analysis',
                version: 1,
            },
        ],
    },
    {
        id: 'compare',
        title: '비교',
        description: '군집, 기간, 채널 기준 비교 분석',
        prompts: [
            {
                id: 'compare',
                command: '/compare',
                label: '비교',
                prompt: '최근 구간과 이전 구간(예: 전주/전월)을 캠페인·카테고리별로 비교해 성과 차이를 정리해줘.',
                description: '시차/기간 비교를 통한 개선 지점 추출',
                groupId: 'compare',
                version: 1,
            },
            {
                id: 'segment',
                command: '/segment',
                label: '세그먼트',
                prompt: '고객 세그먼트별 전환 패턴을 비교하고 세그먼트별로 이탈 원인과 리텐션 개선 포인트를 제안해줘.',
                description: '세그먼트별 약점·강점 파악',
                groupId: 'compare',
                version: 1,
            },
            {
                id: 'kpi',
                command: '/kpi',
                label: '지표 교차',
                prompt: '조회수·좋아요·댓글·전환율 지표를 교차해서 핵심 상관 신호를 찾아줘.',
                description: '상관 신호로 우선순위 개선 포인트 제안',
                groupId: 'compare',
                version: 1,
                deprecated: {
                    replacedBy: '/segment',
                    migrationHint: '기존 /kpi 명령어는 유지되지만 곧 제거될 예정입니다. 앞으로는 /segment를 사용해 주세요.',
                },
            },
        ],
    },
    {
        id: 'ops',
        title: '운영 액션',
        description: '즉시 실행 가능한 행동 제안',
        prompts: [
            {
                id: 'anomaly',
                command: '/anomaly',
                label: '이상 탐지',
                prompt: '성과가 비정상적으로 변한 항목을 찾아 원인 가설을 3개 이상 제시해줘.',
                description: '이탈 징후를 빠르게 식별하고 대응책 제안',
                groupId: 'ops',
                version: 1,
            },
            {
                id: 'improve',
                command: '/improve',
                label: '개선 계획',
                prompt: '다음 30일 액션 플랜으로 실행 우선순위를 나눠 제안해줘. (오늘, 7일, 30일 단위)',
                description: '바로 실행 가능한 일정 기반 제안',
                groupId: 'ops',
                version: 1,
            },
            {
                id: 'topbottom',
                command: '/topbottom',
                label: '상·하위 분석',
                prompt: '성과 상위/하위 항목 3개씩을 뽑아 공통 요소를 비교하고, 하위권 회복 전략을 제안해줘.',
                description: '성과 편차 요인 분석 및 운영 가이드',
                groupId: 'ops',
                version: 1,
            },
        ],
    },
];

const CONTEXT_PROMPT_LIBRARY: InsightPromptCommandGroup[] = [
    {
        id: 'context-sales',
        title: '매출 맥락',
        description: '매출·수익성 관련 대화 후 우선 추천',
        prompts: [
            {
                id: 'sales-cause',
                command: '/revenue-cause',
                label: '매출 원인',
                prompt: '현재 매출 하락의 주요 원인을 지표별로 분해해서 원인 가설과 우선 점검 항목을 제시해줘.',
                description: '매출 하락 대응용 분석',
                groupId: 'context-sales',
                version: 1,
            },
            {
                id: 'sales-action',
                command: '/revenue-action',
                label: '매출 액션',
                prompt: '매출 회복을 위한 14일 액션 플랜을 제안해줘. 운영 우선순위와 실패 지표도 함께.',
                description: '단기 매출 반등 중심 제안',
                groupId: 'context-sales',
                version: 1,
            },
        ],
    },
    {
        id: 'context-campaign',
        title: '캠페인 맥락',
        description: '캠페인 질문 후 우선 추천',
        prompts: [
            {
                id: 'campaign-rework',
                command: '/campaign-rework',
                label: '캠페인 재배치',
                prompt: '캠페인 성과 하락 구간을 골라 리배치/최적화 제안을 1차안으로 정리해줘.',
                description: '캠페인별 문제구간 집중 대응',
                groupId: 'context-campaign',
                version: 1,
            },
            {
                id: 'campaign-compare',
                command: '/campaign-compare',
                label: '고성능 대조군',
                prompt: '현재 캠페인 중 고성능 상위 3개와 저성과 3개를 비교해 최적화 기준을 정리해줘.',
                description: '성공 패턴의 운영 반영 포인트 제시',
                groupId: 'context-campaign',
                version: 1,
            },
        ],
    },
];

function getPromptLibraryText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

const QUICK_PROMPT_COMMAND_MAP = new Map<string, InsightPromptCommand>();
for (const group of INSIGHT_PROMPT_LIBRARY) {
    for (const command of group.prompts) {
        QUICK_PROMPT_COMMAND_MAP.set(normalizePromptCommand(command.command), command);
    }
}
for (const group of CONTEXT_PROMPT_LIBRARY) {
    for (const command of group.prompts) {
        QUICK_PROMPT_COMMAND_MAP.set(normalizePromptCommand(command.command), command);
    }
}

function normalizePromptCommand(value: string): string {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function splitPromptInput(input: string): ParsedPromptInput | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const payload = trimmed.slice(1).trim();
    if (!payload) return null;

    const [rawCommand, ...rest] = payload.split(/\s+/);
    if (!rawCommand) return null;

    return {
        command: normalizePromptCommand(rawCommand),
        tail: rest.join(' ').trim(),
    };
}

export function resolvePromptInput(input: string): string {
    return resolvePromptInputWithGovernance(input).content;
}

function buildPromptMigrationHint(command: InsightPromptCommand): string | null {
    if (!command.deprecated) return null;
    if (command.deprecated.migrationHint?.trim()) {
        return command.deprecated.migrationHint.trim();
    }

    if (command.deprecated.replacedBy?.trim()) {
        return `${command.command} 명령어는 곧 제거될 예정입니다. ${command.deprecated.replacedBy.trim()} 명령어를 사용해 주세요.`;
    }

    return `${command.command} 명령어는 곧 제거될 예정입니다.`;
}

export function resolvePromptInputWithGovernance(input: string): PromptInputResolution {
    const parsed = splitPromptInput(input);
    if (!parsed) {
        return {
            content: input.trim(),
            migrationHint: null,
        };
    }

    const template = QUICK_PROMPT_COMMAND_MAP.get(parsed.command);
    if (!template) {
        return {
            content: input.trim(),
            migrationHint: null,
        };
    }

    return {
        content: parsed.tail ? `${template.prompt} ${parsed.tail}` : template.prompt,
        migrationHint: buildPromptMigrationHint(template),
    };
}

function buildResolvedPromptValue(input: string, prompt: InsightPromptCommand): string {
    const parsed = splitPromptInput(input);
    const suffix = parsed?.tail;
    return suffix ? `${prompt.prompt} ${suffix}` : prompt.prompt;
}

function flattenPromptCommands(groups: InsightPromptCommandGroup[]): InsightPromptCommand[] {
    const prompts: InsightPromptCommand[] = [];
    for (const group of groups) {
        prompts.push(...group.prompts);
    }
    return dedupePromptCommands(prompts);
}

function filterPromptCommandGroups(groups: InsightPromptCommandGroup[], query: string): InsightPromptCommandGroup[] {
    const normalized = getPromptLibraryText(query);
    if (!normalized) return groups;

    return groups
        .map((group) => {
            const prompts = group.prompts.filter((prompt) => {
                const haystack = getPromptLibraryText(`${prompt.command} ${prompt.label} ${prompt.prompt} ${prompt.description}`);
                return haystack.includes(normalized);
            });
            return {
                ...group,
                prompts,
            };
        })
            .filter((group) => group.prompts.length > 0);
}

function deriveFollowUpPromptSuggestions(
    prompts: InsightChatFollowUpPrompt[] | undefined,
    contextMessage: string,
    groups: InsightPromptCommandGroup[],
): InsightChatFollowUpPrompt[] {
    if (prompts?.length) {
        return prompts.slice(0, MAX_FOLLOW_UP_PROMPTS);
    }

    const normalizedContext = contextMessage.trim().toLowerCase();
    const baseGroups = groups.filter((group) => group.prompts.length > 0);
    const candidates = flattenPromptCommands(baseGroups);

    if (!normalizedContext) {
        return candidates
            .slice(0, MAX_FOLLOW_UP_PROMPTS)
            .map((prompt) => ({ label: prompt.label, prompt: prompt.prompt }));
    }

    const matched = filterPromptCommandGroups(baseGroups, normalizedContext)
        .flatMap((group) => group.prompts)
        .map((prompt) => ({ label: prompt.label, prompt: prompt.prompt }));

    if (matched.length) {
        return matched.slice(0, MAX_FOLLOW_UP_PROMPTS);
    }

    return candidates
        .slice(0, MAX_FOLLOW_UP_PROMPTS)
        .map((prompt) => ({ label: prompt.label, prompt: prompt.prompt }));
}

function dedupePromptCommands(prompts: InsightPromptCommand[]): InsightPromptCommand[] {
    const seen = new Set<string>();
    const result: InsightPromptCommand[] = [];

    for (const prompt of prompts) {
        const normalized = normalizePromptCommand(prompt.command);
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(prompt);
    }

    return result;
}

function cloneDeep<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function makeSafeUniqueId(prefix: string, reserved: Set<string>): string {
    let id = makeId(prefix);
    while (reserved.has(id)) {
        id = makeId(prefix);
    }
    return id;
}

export function duplicateConversationForSidebar(
    sourceConversation: ChatConversation,
    existingConversations: readonly ChatConversation[],
): ChatConversation {
    const reservedConversationIds = new Set(existingConversations.map((conversation) => conversation.id));
    const reservedMessageIds = new Set(existingConversations.flatMap((conversation) => conversation.messages.map((message) => message.id)));

    const conversationClone = cloneDeep(sourceConversation);
    const source = conversationClone;
    const nextConversationId = makeSafeUniqueId('conversation', reservedConversationIds);

    const nextMessages = source.messages.map((message) => ({
        ...cloneDeep(message),
        id: makeSafeUniqueId(message.role === 'assistant' ? 'assistant' : 'user', reservedMessageIds),
        createdAt: cloneDeep(message.createdAt),
    }));

    return {
        ...source,
        id: nextConversationId,
        title: `${source.title} 복사본`,
        messages: nextMessages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isBooting: false,
    };
}

export type ConversationDeleteSnapshot = {
    conversation: ChatConversation;
    removedAtIndex: number;
    wasActive: boolean;
};

export type ConversationDeleteResult = {
    conversations: ChatConversation[];
    activeConversationId: string;
    deleted: ConversationDeleteSnapshot | null;
};

export function normalizeActiveConversationId(
    conversations: readonly ChatConversation[],
    activeConversationId: string,
): string {
    if (!activeConversationId) return '';
    const hasMatch = conversations.some((conversation) => conversation.id === activeConversationId);
    return hasMatch ? activeConversationId : conversations[0]?.id ?? '';
}

export function deleteConversationFromList(
    conversations: readonly ChatConversation[],
    activeConversationId: string,
    conversationId: string,
): ConversationDeleteResult {
    const removedAtIndex = conversations.findIndex((conversation) => conversation.id === conversationId);
    if (removedAtIndex < 0) {
        return {
            conversations: [...conversations],
            activeConversationId: normalizeActiveConversationId(conversations, activeConversationId),
            deleted: null,
        };
    }

    const deletedConversation = conversations[removedAtIndex] ?? null;
    const nextConversations = conversations.filter((conversation) => conversation.id !== conversationId);
    const isActiveDeleted = activeConversationId === conversationId;
    const fallbackActiveId = isActiveDeleted
        ? nextConversations[removedAtIndex]?.id
            ?? nextConversations[removedAtIndex - 1]?.id
            ?? ''
        : activeConversationId;

    return {
        conversations: nextConversations,
        activeConversationId: normalizeActiveConversationId(nextConversations, fallbackActiveId),
        deleted: deletedConversation ? {
            conversation: deletedConversation,
            removedAtIndex,
            wasActive: isActiveDeleted,
        } : null,
    };
}

export function restoreConversationFromList(
    conversations: readonly ChatConversation[],
    activeConversationId: string,
    deletedConversation: ConversationDeleteSnapshot,
): {
    conversations: ChatConversation[];
    activeConversationId: string;
} {
    if (!deletedConversation) {
        return {
            conversations: [...conversations],
            activeConversationId: normalizeActiveConversationId(conversations, activeConversationId),
        };
    }

    const alreadyRestored = conversations.some((conversation) => conversation.id === deletedConversation.conversation.id);
    if (alreadyRestored) {
        return {
            conversations: [...conversations],
            activeConversationId: normalizeActiveConversationId(conversations, activeConversationId),
        };
    }

    const nextConversations = [...conversations];
    const insertAtIndex = Math.max(0, Math.min(deletedConversation.removedAtIndex, nextConversations.length));

    nextConversations.splice(insertAtIndex, 0, deletedConversation.conversation);
    if (nextConversations.length > MAX_CONVERSATIONS) {
        nextConversations.length = MAX_CONVERSATIONS;
    }

    return {
        conversations: nextConversations,
        activeConversationId: deletedConversation.wasActive
            ? deletedConversation.conversation.id
            : normalizeActiveConversationId(nextConversations, activeConversationId),
    };
}

function makeId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeConversationId(): string {
    return makeId('conversation');
}

function makeRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function shortText(input: string, max: number): string {
    const normalized = input.trim().replace(/\s+/g, ' ');
    if (!normalized) return '';
    return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function makeConversationTitle(content: string): string {
    const shortened = shortText(content, 40);
    return shortened || '새로운 대화';
}

function normalizeCacheKey(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function trimCacheSize<T>(cache: Map<string, CachedEntry<T>>, maxEntries: number) {
    if (cache.size <= maxEntries) return;

    const overflow = cache.size - maxEntries;
    let removed = 0;
    for (const key of cache.keys()) {
        cache.delete(key);
        removed += 1;
        if (removed >= overflow) return;
    }
}

function buildConversationScopedCacheKey(
    conversationId: string,
    message: string,
    llmConfig?: {
        provider: LlmProvider;
        model: string;
        apiKey?: string;
        useServerKey?: boolean;
        storyboardModelProfile?: StoryboardModelProfile;
        imageModelProfile?: StoryboardModelProfile;
    },
    imageModelProfile?: StoryboardModelProfile,
    responseMode: InsightChatResponseMode = DEFAULT_RESPONSE_MODE,
    memoryMode: InsightChatMemoryMode = DEFAULT_MEMORY_MODE,
    memoryProfileNote?: string,
    feedbackContext?: InsightChatFeedbackContext,
    attachments?: InsightChatAttachmentInput[],
    contextMessages?: InsightChatContextMessage[],
): string {
    const normalizedMessage = normalizeCacheKey(message);
    const inferenceMode = llmConfig ? 'model' : 'local';
    const provider = llmConfig?.provider ?? 'none';
    const model = llmConfig?.model ?? 'none';
    const keyMode = llmConfig?.apiKey
        ? 'client-key'
        : llmConfig?.useServerKey || provider === 'gemini'
            ? 'server-key'
            : 'none';
    const normalizedProfile = llmConfig?.imageModelProfile
        || llmConfig?.storyboardModelProfile
        || imageModelProfile
        || 'none';
    const normalizedMode = normalizeResponseMode(responseMode);
    const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
    const normalizedMemoryProfileNote = normalizedMemoryMode === 'off'
        ? ''
        : sanitizeMemoryProfileNote(memoryProfileNote);
    const memoryProfileSignature = normalizedMemoryProfileNote
        ? `memory-profile:${normalizedMemoryProfileNote}`
        : 'memory-profile:none';
    const feedbackSignature = feedbackContext?.rating
        ? `feedback:${feedbackContext.rating}:${(feedbackContext.reason ?? '').replace(/\s+/g, ' ').slice(0, 120)}`
        : 'feedback:none';
    const attachmentSignature = attachments?.length
        ? attachments
            .slice(0, MAX_CHAT_ATTACHMENTS)
            .map((attachment) => `${attachment.name}:${attachment.content.slice(0, 80)}`)
            .join('|')
        : 'attachments:none';
    const contextSignature = contextMessages?.length
        ? contextMessages
            .slice(-MAX_REQUEST_CONTEXT_MESSAGES)
            .map((contextMessage) => `${contextMessage.role}:${contextMessage.content.slice(0, 80)}`)
            .join('|')
        : 'context:none';

    return `${conversationId}|${inferenceMode}|${provider}|${model}|${keyMode}|${normalizedProfile}|${normalizedMode}|${normalizedMemoryMode}|${memoryProfileSignature}|${feedbackSignature}|${attachmentSignature}|${contextSignature}|${normalizedMessage}`;
}

async function fetchJsonWithTimeout<T>(url: string, options: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        if (!response.ok) {
            const fallback = await response.json().catch(() => null);
            if (fallback && typeof (fallback as { content?: unknown })?.content === 'string') {
                return fallback as T;
            }
            throw new Error('요청이 실패했습니다');
        }

        return response.json() as Promise<T>;
    } finally {
        clearTimeout(timer);
    }
}

function isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    if (error.name === 'AbortError') {
        return true;
    }

    if (error.name === 'TypeError') {
        return true;
    }

    return /network|failed|fetch/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function fetchChatBootstrap(conversationId: string): Promise<AdminInsightChatBootstrapResponse> {
    const cacheKey = `admin-insight-bootstrap|${conversationId}`;
    const now = Date.now();
    const cached = chatBootstrapCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    const inFlight = inFlightBootstrapRequest.get(cacheKey);
    if (inFlight) return inFlight;

    const request = fetchJsonWithTimeout<AdminInsightChatBootstrapResponse>('/api/admin/insight/chat/bootstrap', {
        method: 'GET',
        cache: 'no-store',
    }, CHAT_REQUEST_TIMEOUT_MS).catch((error) => {
        if (error instanceof Error) {
            throw new Error('인사이트 채팅 초기 데이터를 가져오지 못했습니다');
        }
        throw error;
    });

    inFlightBootstrapRequest.set(cacheKey, request);

    try {
        const bootstrap = await request;
        chatBootstrapCache.set(cacheKey, {
            data: bootstrap,
            expiresAt: now + CHAT_BOOTSTRAP_TTL_MS,
        });
        trimCacheSize(chatBootstrapCache, 1);
        return bootstrap;
    } finally {
        inFlightBootstrapRequest.delete(cacheKey);
    }
}

async function fetchChatGuardrailMetrics(): Promise<AdminInsightChatGuardrailMetricsResponse> {
    const payload = await fetchJsonWithTimeout<unknown>('/api/admin/insight/chat/metrics', {
        method: 'GET',
        cache: 'no-store',
    }, CHAT_REQUEST_TIMEOUT_MS);
    return normalizeInsightChatGuardrailMetricsResponse(payload);
}

async function postResetChatGuardrailMetrics(): Promise<AdminInsightChatGuardrailMetricsResetResponse> {
    const payload = await fetchJsonWithTimeout<unknown>('/api/admin/insight/chat/metrics/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
    }, CHAT_REQUEST_TIMEOUT_MS);

    if (!isRecord(payload) || payload.success !== true) {
        throw new Error('가드레일 지표 초기화에 실패했습니다.');
    }

    return {
        success: true,
        message: typeof payload.message === 'string' && payload.message.trim()
            ? payload.message
            : '가드레일 지표를 초기화했습니다.',
    };
}

async function postChatMessage(
    message: string,
    requestId: string,
    conversationId: string,
    llmConfig?: {
        provider: LlmProvider;
        model: string;
        apiKey?: string;
        storyboardModelProfile?: StoryboardModelProfile;
        imageModelProfile?: StoryboardModelProfile;
        useServerKey?: boolean;
    },
    imageModelProfile?: StoryboardModelProfile,
    responseMode: InsightChatResponseMode = DEFAULT_RESPONSE_MODE,
    memoryMode: InsightChatMemoryMode = DEFAULT_MEMORY_MODE,
    feedbackContext?: InsightChatFeedbackContext,
    attachments?: InsightChatAttachmentInput[],
    contextMessages?: InsightChatContextMessage[],
    memoryProfileNote?: string,
): Promise<AdminInsightChatResponse> {
    const normalizedResponseMode = normalizeResponseMode(responseMode);
    const normalizedFeedbackContext = normalizeFeedbackInput(feedbackContext);
    const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
    const normalizedMemoryProfileNote = normalizedMemoryMode === 'off' ? '' : sanitizeMemoryProfileNote(memoryProfileNote);
    const resolvedImageModelProfile = llmConfig?.imageModelProfile
        || llmConfig?.storyboardModelProfile
        || imageModelProfile;
    const normalizedMessage = buildConversationScopedCacheKey(
        conversationId,
        message,
        llmConfig,
        resolvedImageModelProfile,
        normalizedResponseMode,
        normalizedMemoryMode,
        normalizedMemoryProfileNote,
        normalizedFeedbackContext,
        attachments,
        contextMessages,
    );
    const now = Date.now();

    if (!llmConfig) {
        const cached = chatResponseCache.get(normalizedMessage);
        if (cached && cached.expiresAt > now) {
            return cached.data;
        }
    }

    const inFlight = inFlightChatRequest.get(normalizedMessage);
    if (inFlight && !llmConfig) return inFlight;

    const request = (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= CHAT_REQUEST_RETRY_ATTEMPTS; attempt += 1) {
            try {
                return await fetchJsonWithTimeout<AdminInsightChatResponse>('/api/admin/insight/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message,
                        requestId,
                        responseMode: normalizedResponseMode,
                        memoryMode: normalizedMemoryMode,
                        ...(normalizedMemoryProfileNote ? { memoryProfileNote: normalizedMemoryProfileNote } : {}),
                        ...(attachments?.length ? { attachments } : {}),
                        ...(contextMessages?.length ? { contextMessages } : {}),
                        ...(normalizedFeedbackContext ? { feedbackContext: normalizedFeedbackContext } : {}),
                        ...(llmConfig
                            ? {
                                provider: llmConfig.provider,
                                model: llmConfig.model,
                                ...(llmConfig.apiKey ? { apiKey: llmConfig.apiKey } : {}),
                                ...(llmConfig.useServerKey ? { useServerKey: true } : {}),
                                ...(resolvedImageModelProfile ? { storyboardModelProfile: resolvedImageModelProfile } : {}),
                                ...(resolvedImageModelProfile ? { imageModelProfile: resolvedImageModelProfile } : {}),
                            }
                            : {}),
                        ...(resolvedImageModelProfile && !llmConfig ? { storyboardModelProfile: resolvedImageModelProfile } : {}),
                        ...(resolvedImageModelProfile && !llmConfig ? { imageModelProfile: resolvedImageModelProfile } : {}),
                    }),
                }, CHAT_REQUEST_TIMEOUT_MS);
            } catch (error) {
                lastError = error;
                if (attempt >= CHAT_REQUEST_RETRY_ATTEMPTS || !isTransientError(error)) {
                    if (error instanceof Error) {
                        throw new Error('메시지를 전송하지 못했습니다');
                    }
                    throw error;
                }

                const delay = CHAT_REQUEST_RETRY_BASE_DELAY_MS * 2 ** attempt;
                await sleep(Math.min(1200, delay));
            }
        }

        if (lastError instanceof Error) {
            throw lastError;
        }
        throw new Error('메시지를 전송하지 못했습니다');
    })();

    if (!llmConfig) {
        inFlightChatRequest.set(normalizedMessage, request);
    }

    try {
        const response = await request;
        if (!llmConfig) {
            chatResponseCache.set(normalizedMessage, {
                data: response,
                expiresAt: now + CHAT_RESPONSE_TTL_MS,
            });
            trimCacheSize(chatResponseCache, CHAT_REQUEST_CACHE_LIMIT);
        }
        return response;
    } finally {
        if (!llmConfig) {
            inFlightChatRequest.delete(normalizedMessage);
        }
    }
}

async function postStreamChat(
    message: string,
    requestId: string,
    llmConfig: {
        provider: LlmProvider;
        model: string;
        apiKey?: string;
        useServerKey?: boolean;
        storyboardModelProfile?: StoryboardModelProfile;
        imageModelProfile?: StoryboardModelProfile;
    },
    onToken: (token: string) => void,
    abortSignal?: AbortSignal,
    responseMode: InsightChatResponseMode = DEFAULT_RESPONSE_MODE,
    memoryMode: InsightChatMemoryMode = DEFAULT_MEMORY_MODE,
    feedbackContext?: InsightChatFeedbackContext,
    attachments?: InsightChatAttachmentInput[],
    contextMessages?: InsightChatContextMessage[],
    memoryProfileNote?: string,
): Promise<AdminInsightChatResponse | null> {
    const normalizedResponseMode = normalizeResponseMode(responseMode);
    const normalizedFeedbackContext = normalizeFeedbackInput(feedbackContext);
    const normalizedMemoryMode = normalizeMemoryMode(memoryMode);
    const normalizedMemoryProfileNote = normalizedMemoryMode === 'off' ? '' : sanitizeMemoryProfileNote(memoryProfileNote);

    const resp = await fetch('/api/admin/insight/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortSignal,
        body: JSON.stringify({
            message,
            requestId,
            responseMode: normalizedResponseMode,
            memoryMode: normalizedMemoryMode,
            ...(normalizedMemoryProfileNote ? { memoryProfileNote: normalizedMemoryProfileNote } : {}),
            ...(attachments?.length ? { attachments } : {}),
            ...(contextMessages?.length ? { contextMessages } : {}),
            ...(normalizedFeedbackContext ? { feedbackContext: normalizedFeedbackContext } : {}),
            provider: llmConfig.provider,
            model: llmConfig.model,
            ...(llmConfig.apiKey ? { apiKey: llmConfig.apiKey } : {}),
            useServerKey: llmConfig.useServerKey,
            ...(llmConfig.imageModelProfile ? { imageModelProfile: llmConfig.imageModelProfile } : {}),
            ...(llmConfig.storyboardModelProfile ? { storyboardModelProfile: llmConfig.storyboardModelProfile } : {}),
        }),
    });

    if (!resp.ok) throw new Error('스트리밍 요청 실패');

    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        const payload = (await resp.json()) as { error?: string; content?: string } & AdminInsightChatResponse;
        if (payload && 'error' in payload && payload.error) {
            throw new Error(payload.error);
        }
        return payload as AdminInsightChatResponse;
    }

    if (!resp.body) throw new Error('스트리밍 본문 없음');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamState: InsightChatStreamState = { accumulated: '', streamError: null };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            streamState = parseInsightChatStreamLine(line, streamState, onToken);
            if (streamState.streamError) break;
        }

        if (streamState.streamError) break;
    }

    if (buffer.trim()) {
        streamState = parseInsightChatStreamLine(buffer, streamState, onToken);
    }

    const fallbackReason = streamState.cancellationReason === 'request_cancelled' ? 'request_cancelled' : 'stream_error';

    const streamToolTrace = [...(streamState.toolTrace ?? [])];
    const appendTrace = (trace: string) => {
        if (!trace || streamToolTrace.includes(trace)) return;
        streamToolTrace.push(trace);
    };
    appendTrace('route:stream');
    appendTrace('flow:stream');
    appendTrace(`provider:${llmConfig.provider}`);
    appendTrace(`responseMode:${normalizedResponseMode}`);
    appendTrace(normalizedMemoryMode ? `memoryMode:${normalizedMemoryMode}` : 'memoryMode:off');

    if (streamState.streamError || !streamState.accumulated) {
        const streamFailed = streamState.streamError
            ? '스트리밍 응답 중 오류가 발생했습니다.'
            : '스트리밍 응답을 받지 못했습니다.';
        return {
            asOf: new Date().toISOString(),
            content: streamState.streamError
                ? streamState.cancellationReason === 'request_cancelled'
                    ? ''
                    : `${streamFailed} (${streamState.streamError})`
                : `${streamFailed} 잠시 후 다시 시도해 주세요.`,
            sources: [],
            meta: {
                source: 'fallback',
                fallbackReason: streamState.streamError ? fallbackReason : 'stream_no_data',
                ...(streamState.requestId ? { requestId: streamState.requestId } : {}),
                memoryMode: normalizedMemoryMode,
                ...(streamToolTrace.length ? { toolTrace: streamToolTrace } : {}),
            },
        };
    }

    return null;
}

function mapSources(rawSources: InsightChatSource[] | undefined): InsightChatSource[] {
    const normalized: InsightChatSource[] = [];
    const seen = new Set<string>();

    for (const source of rawSources ?? []) {
        const videoTitle = sanitizeSourceValue(source.videoTitle);
        const youtubeLink = normalizeSourceLink(source.youtubeLink);
        const timestamp = sanitizeSourceValue(source.timestamp);
        const text = sanitizeSourceValue(source.text);

        if (!videoTitle && !youtubeLink && !timestamp && !text) continue;

        const key = `${videoTitle}||${youtubeLink}||${timestamp}||${text}`;
        if (seen.has(key)) continue;
        seen.add(key);

        normalized.push({
            videoTitle,
            youtubeLink,
            timestamp,
            text,
        });
    }

    return normalized;
}

type InsightChatTreemapResponse = {
    asOf: string;
    period: string;
    totalVideos: number;
    videos: Array<{
        id: string;
        title: string;
        category: string;
        viewCount: number;
        likeCount: number;
        commentCount: number;
        duration: number;
        publishedAt: string | null;
        previousViewCount: number | null;
        previousLikeCount: number | null;
        previousCommentCount: number | null;
        previousDuration: number | null;
    }>;
    availablePeriods?: string[];
};

export type ChatTreemapMetricMode = 'views' | 'likes' | 'comments' | 'duration';
export type ChatTreemapViewMode = 'all' | 'category' | 'change';
type ChatTreemapPeriod = 'ALL' | '1D' | '1W' | '2W' | '1M' | '3M' | '6M' | '1Y';

export type ChatTreemapLeaf = {
    id: string;
    name: string;
    title: string;
    category: string;
    value: number;
    metricRaw: number;
    previousMetricRaw: number | null;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    duration: number;
    metricText: string;
    percentText: string;
    percent: number;
    color: string;
};

type ChatTreemapHierarchyLeaf = ChatTreemapLeaf;

export type ChatTreemapGroup = {
    name: string;
    children: ChatTreemapLeaf[];
    value: number;
};

export type ChatTreemapNode = ChatTreemapLeaf | ChatTreemapGroup | ChatTreemapRoot;
export type ChatTreemapRoot = {
    name: string;
    children: ChatTreemapNode[];
};

export type ChatTreemapAnyNode = ChatTreemapNode;

type TreemapCell = {
    node: ChatTreemapLeaf;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};

type ChatTreemapTooltip = {
    id: string;
    title: string;
    category: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    duration: number;
    metricRaw: number;
    metricText: string;
    percentText: string;
    percent: number;
    previousMetricRaw: number | null;
    x: number;
    y: number;
};

type TreemapChartDimensions = {
    width: number;
    height: number;
};

// 메인 트리맵과 동일한 녹색 그라데이션 — 일관된 시각 언어
const CHAT_TREEMAP_COLORS = ['#414554', '#35764e', '#2f9e4f', '#30cc5a'];
const CHAT_TREEMAP_MAX_LEAVES = 2000;
const CHAT_TREEMAP_MIN_LEAVES = 5;
const CHAT_TREEMAP_MOBILE_MAX_LEAVES = 2000;
const CHAT_TREEMAP_MOBILE_MIN_LEAVES = 4;
const CHAT_TREEMAP_TABLET_MAX_LEAVES = 2000;
const CHAT_TREEMAP_TABLET_MIN_LEAVES = 5;
const CHAT_TREEMAP_MIN_WIDTH = 320;
const CHAT_TREEMAP_TABLET_MIN_WIDTH = 280;
const CHAT_TREEMAP_MOBILE_MIN_WIDTH = 220;
const CHAT_TREEMAP_MIN_HEIGHT = 220;
const CHAT_TREEMAP_TABLET_MIN_HEIGHT = 320;
const CHAT_TREEMAP_DESKTOP_MIN_HEIGHT = 400;
const CHAT_TREEMAP_MAX_HEIGHT = 1400;
const CHAT_TREEMAP_ASPECT_RATIO = 1.0;
const CHAT_TREEMAP_TOOLTIP_WIDTH = 280;
const CHAT_TREEMAP_TOOLTIP_HEIGHT = 160;
const CHAT_TREEMAP_AREA_PER_CELL = 800;
const CHAT_TREEMAP_MOBILE_AREA_PER_CELL = 1200;
const CHAT_TREEMAP_TABLET_AREA_PER_CELL = 1000;
const CHAT_TREEMAP_MAX_LAYOUT_TOP_SHARE = 0.52;
const CHAT_TREEMAP_EMPTY_MESSAGE = '트리맵에 표시할 데이터가 없습니다.';

const CHAT_TREEMAP_MOBILE_BP = 768;
const CHAT_TREEMAP_TABLET_BP = 1024;

const CHAT_TREEMAP_METRIC_OPTIONS: { value: ChatTreemapMetricMode; label: string }[] = [
    { value: 'views', label: '조회수' },
    { value: 'likes', label: '좋아요' },
    { value: 'comments', label: '댓글수' },
    { value: 'duration', label: '영상 길이' },
];

const CHAT_TREEMAP_PERIOD_OPTIONS: { value: ChatTreemapPeriod; label: string }[] = [
    { value: 'ALL', label: '전체' },
    { value: '1D', label: '1D' },
    { value: '1W', label: '1W' },
    { value: '2W', label: '2W' },
    { value: '1M', label: '1M' },
    { value: '3M', label: '3M' },
    { value: '6M', label: '6M' },
    { value: '1Y', label: '1Y' },
];

const CHAT_TREEMAP_VIEW_MODE_OPTIONS: { value: ChatTreemapViewMode; label: string }[] = [
    { value: 'all', label: '비율' },
    { value: 'category', label: '카테고리' },
    { value: 'change', label: '증감률' },
];

export function chatTreemapGetMetricValue(
    video: InsightChatTreemapResponse['videos'][number],
    mode: ChatTreemapMetricMode,
): number {
    if (mode === 'views') return video.viewCount;
    if (mode === 'likes') return video.likeCount;
    if (mode === 'comments') return video.commentCount;
    return video.duration;
}

export function chatTreemapGetPreviousMetric(
    video: InsightChatTreemapResponse['videos'][number],
    mode: ChatTreemapMetricMode,
): number | null {
    if (mode === 'views') return video.previousViewCount;
    if (mode === 'likes') return video.previousLikeCount;
    if (mode === 'comments') return video.previousCommentCount;
    return video.previousDuration;
}

export function chatTreemapCalcChange(current: number, previous: number | null): number {
    if (!Number.isFinite(current) || previous == null || previous <= 0) return 0;
    return ((current - previous) / previous) * 100;
}

function chatTreemapFormatShort(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${Number.parseFloat((value / 1_000_000).toFixed(1))}M`;
    if (value >= 1_000) return `${Number.parseFloat((value / 1_000).toFixed(1))}k`;
    return value.toLocaleString();
}

function chatTreemapFormatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function chatTreemapFormatMetric(mode: ChatTreemapMetricMode, value: number): string {
    if (mode === 'duration') return chatTreemapFormatDuration(value);
    return chatTreemapFormatShort(value);
}

function chatTreemapFormatTooltipMetric(mode: 'views' | 'likes' | 'comments' | 'duration', value: number): string {
    if (mode === 'duration') return chatTreemapFormatDuration(value);
    return `${Math.round(value).toLocaleString()}개`;
}

function chatTreemapGetMetricLabel(mode: ChatTreemapMetricMode): string {
    if (mode === 'views') return '조회수';
    if (mode === 'likes') return '좋아요';
    if (mode === 'comments') return '댓글수';
    return '영상 길이';
}

function chatTreemapFormatPercent(value: number): string {
    return `${value.toFixed(2)}%`;
}

export function buildInsightChatTreemapRows(
    rows: InsightChatTreemapResponse['videos'] | null,
    metricMode: ChatTreemapMetricMode,
    viewMode: ChatTreemapViewMode,
): ChatTreemapNode[] {
    if (!rows || rows.length === 0) return [];

    const isChangeMode = viewMode === 'change';
    const totalMetric = rows.reduce((sum, row) => sum + Math.max(0, chatTreemapGetMetricValue(row, metricMode)), 0);

    const leafRows: ChatTreemapLeaf[] = [];
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const metricRaw = Math.max(chatTreemapGetMetricValue(row, metricMode), 0);
        const previousMetricRaw = chatTreemapGetPreviousMetric(row, metricMode);
        const rowPercent = isChangeMode ? chatTreemapCalcChange(metricRaw, previousMetricRaw) : 0;

        leafRows.push({
            id: row.id,
            name: row.title,
            title: row.title,
            category: row.category?.trim() || '기타',
            value: Math.max(metricRaw, 0.25),
            metricRaw,
            previousMetricRaw,
            viewCount: row.viewCount,
            likeCount: row.likeCount,
            commentCount: row.commentCount,
            duration: row.duration,
            metricText: chatTreemapFormatMetric(metricMode, metricRaw),
            percent: rowPercent,
            percentText: isChangeMode ? chatTreemapFormatPercent(rowPercent) : '0%',
            color: chatTreemapGetColorByPercent(rowPercent),
        });
    }

    if (!isChangeMode) {
        for (const row of leafRows) {
            row.percent = totalMetric > 0 ? (row.metricRaw / totalMetric) * 100 : 0;
            row.percentText = chatTreemapFormatPercent(row.percent);
            row.color = chatTreemapGetColorByPercent(row.percent);
        }
    }

    leafRows.sort((a, b) => b.metricRaw - a.metricRaw);

    if (viewMode === 'category') {
        const grouped = new Map<string, { children: ChatTreemapLeaf[]; totalMetric: number }>();
        for (const item of leafRows) {
            const bucket = grouped.get(item.category) ?? { children: [], totalMetric: 0 };
            bucket.children.push(item);
            bucket.totalMetric += item.metricRaw;
            grouped.set(item.category, bucket);
        }
        return [...grouped.entries()]
            .map(([name, group]) => ({
                name,
                value: Math.max(group.totalMetric, 0.25),
                children: [...group.children].sort((a, b) => b.metricRaw - a.metricRaw),
            }))
            .sort((a, b) => b.value - a.value);
    }

    return leafRows;
}

function chatTreemapGetColorByPercent(percent: number): string {
    if (percent <= 0) return CHAT_TREEMAP_COLORS[0];
    if (percent <= 1) return CHAT_TREEMAP_COLORS[1];
    if (percent <= 2) return CHAT_TREEMAP_COLORS[2];
    return CHAT_TREEMAP_COLORS[3];
}

function chatTreemapGetPeriodLabel(period: ChatTreemapPeriod): string {
    if (period === 'ALL') return '전체';
    if (period === '1D') return '전일';
    if (period === '1W') return '전주';
    if (period === '2W') return '2주전';
    if (period === '1M') return '전월';
    if (period === '3M') return '3개월전';
    if (period === '6M') return '6개월전';
    if (period === '1Y') return '1년전';
    return '1년전';
}

const getTreemapMinDimensions = (width: number): { minWidth: number; minHeight: number } => {
    if (width < CHAT_TREEMAP_MOBILE_BP) {
        return {
            minWidth: CHAT_TREEMAP_MOBILE_MIN_WIDTH,
            minHeight: CHAT_TREEMAP_MIN_HEIGHT,
        };
    }

    if (width < CHAT_TREEMAP_TABLET_BP) {
        return {
            minWidth: CHAT_TREEMAP_TABLET_MIN_WIDTH,
            minHeight: CHAT_TREEMAP_TABLET_MIN_HEIGHT,
        };
    }

    return {
        minWidth: CHAT_TREEMAP_MIN_WIDTH,
        minHeight: CHAT_TREEMAP_DESKTOP_MIN_HEIGHT,
    };
};

function isTreemapLeaf(node: ChatTreemapAnyNode): node is ChatTreemapHierarchyLeaf {
    return !('children' in node);
}

function buildTreemapLayout(nodes: ChatTreemapNode[], width: number, height: number): TreemapCell[] {
    if (nodes.length === 0 || width <= 0 || height <= 0) {
        return [];
    }

    const source: ChatTreemapRoot = { name: 'root', children: nodes };

    const rootHierarchy = hierarchy<ChatTreemapAnyNode>(source, (entry) => (isTreemapLeaf(entry) ? undefined : entry.children));
    const root = rootHierarchy
        .sum((entry) => (isTreemapLeaf(entry) ? Math.max(0.25, entry.value) : 0));

    const layoutGenerator = treemap<ChatTreemapAnyNode>()
        .size([width, height])
        .paddingInner(2)
        .round(true)
        .tile(treemapResquarify);

    const laidOut = layoutGenerator(root) as HierarchyRectangularNode<ChatTreemapAnyNode>;

    return laidOut
        .descendants()
        .filter((entry) => entry.depth > 0 && isTreemapLeaf(entry.data as ChatTreemapAnyNode))
        .map((entry) => ({
            node: entry.data as ChatTreemapLeaf,
            x0: entry.x0,
            y0: entry.y0,
            x1: entry.x1,
            y1: entry.y1,
        }))
        .filter((entry) => entry.x1 > entry.x0 && entry.y1 > entry.y0);
}

const InsightChatTreemap = memo(() => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState<TreemapChartDimensions>({
        width: CHAT_TREEMAP_MOBILE_MIN_WIDTH,
        height: CHAT_TREEMAP_DESKTOP_MIN_HEIGHT,
    });
    const [tooltip, setTooltip] = useState<ChatTreemapTooltip | null>(null);
    const [metricMode, setMetricMode] = useState<ChatTreemapMetricMode>('views');
    const [viewMode, setViewMode] = useState<ChatTreemapViewMode>('all');
    const [period, setPeriod] = useState<ChatTreemapPeriod>('ALL');

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-insight-chat-treemap', metricMode, viewMode, period],
        queryFn: async () => {
            const params = new URLSearchParams({
                period,
                viewMode,
                metricMode,
            });
            const response = await fetch(`/api/insights/treemap?${params.toString()}`);
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(text || '트리맵 데이터를 가져오지 못했습니다.');
            }
            const payload = await response.json().catch(() => null);
            if (!payload || typeof payload !== 'object') {
                throw new Error('트리맵 응답 형식이 올바르지 않습니다.');
            }
            const videos = (payload as Partial<InsightChatTreemapResponse>).videos;
            if (!Array.isArray(videos)) {
                throw new Error('트리맵 응답 형식이 올바르지 않습니다.');
            }
            return payload as InsightChatTreemapResponse;
        },
        staleTime: 60_000,
    });

    useEffect(() => {
        if (!containerRef.current) return;

        const computeHeight = (width: number): number => {
            const { minHeight } = getTreemapMinDimensions(width);
            const ratioHeight = Math.round(width * CHAT_TREEMAP_ASPECT_RATIO);
            const viewportHeight = typeof window === 'undefined'
                ? Number.MAX_SAFE_INTEGER
                : Math.floor((window.visualViewport?.height ?? window.innerHeight) * 0.88);
            return Math.max(minHeight, Math.min(CHAT_TREEMAP_MAX_HEIGHT, Math.max(minHeight, Math.min(viewportHeight, ratioHeight))));
        };

        const computeHeightForData = (width: number): number => {
            const baseHeight = computeHeight(width);
            const itemCount = data?.videos?.length ?? 0;
            if (itemCount <= 0 || width <= 0) return baseHeight;
            // 메인 트리맵과 동일한 밀도: 셀당 최소 1500px² 확보
            const minAreaPerCell = 1500;
            const contentHeight = Math.ceil((itemCount * minAreaPerCell) / width);
            return Math.max(baseHeight, Math.min(CHAT_TREEMAP_MAX_HEIGHT, contentHeight));
        };

        const observeTarget = containerRef.current;

        const handleResize = () => {
            if (!observeTarget) return;
            const contentWidth = Math.floor(observeTarget.clientWidth);
            if (contentWidth <= 0) return;
            const width = Math.max(1, contentWidth - 2);
            const height = computeHeightForData(width);
            setDimensions((prev) => {
                if (Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2) return prev;
                return { width, height };
            });
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(observeTarget);
        window.addEventListener('resize', handleResize);

        const fallbackRaf = window.requestAnimationFrame(handleResize);
        const t1 = setTimeout(handleResize, 100);
        const t2 = setTimeout(handleResize, 400);
        const t3 = setTimeout(handleResize, 1200);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
            window.cancelAnimationFrame(fallbackRaf);
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
        };
    }, [data]);

    const updateTooltip = useCallback((event: PointerEvent<HTMLDivElement>, cell: TreemapCell) => {
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const pointerX = event.clientX - containerRect.left;
        const pointerY = event.clientY - containerRect.top;
        const tooltipWidth = Math.min(CHAT_TREEMAP_TOOLTIP_WIDTH, Math.max(200, containerRect.width * 0.8));
        const tooltipHeight = CHAT_TREEMAP_TOOLTIP_HEIGHT;

        setTooltip({
            id: cell.node.id,
            title: cell.node.title,
            category: cell.node.category,
            viewCount: cell.node.viewCount,
            likeCount: cell.node.likeCount,
            commentCount: cell.node.commentCount,
            duration: cell.node.duration,
            metricRaw: cell.node.metricRaw,
            metricText: cell.node.metricText,
            percentText: cell.node.percentText,
            percent: cell.node.percent,
            previousMetricRaw: cell.node.previousMetricRaw,
            x: Math.max(0, Math.min(pointerX + 12, containerRect.width - tooltipWidth)),
            y: Math.max(0, Math.min(pointerY + 12, containerRect.height - tooltipHeight)),
        });
    }, []);

    const clearTooltip = useCallback(() => {
        setTooltip(null);
    }, []);

    useEffect(() => {
        clearTooltip();
    }, [clearTooltip, dimensions.width, dimensions.height, data]);

    const isChangeMode = viewMode === 'change';

    const rows = useMemo(() => {
        if (dimensions.width <= 0 || dimensions.height <= 0) return [];
        if (!data) return [];
        return buildInsightChatTreemapRows(data.videos, metricMode, viewMode);
    }, [data, dimensions.width, dimensions.height, metricMode, viewMode]);

    const treemapCells = useMemo(
        () => buildTreemapLayout(rows, dimensions.width, dimensions.height),
        [rows, dimensions.width, dimensions.height],
    );

    const displayedSummary = useMemo(() => {
        if (!data) return '';
        const total = data.totalVideos;
        const shownVideos = isFinite(rows.length) ? rows.length : 0;
        const leafNodeCount = rows.reduce((count, row) => (
            'children' in row ? count + row.children.length : count + 1
        ), 0);
        const summaryCount = viewMode === 'category' ? leafNodeCount : shownVideos;
        const label = chatTreemapGetMetricLabel(metricMode);
        const modeLabel = isChangeMode ? '증감률' : '비율';
        return `${label} ${modeLabel} 기준 상위 ${summaryCount}/${total}개 영상 분포`;
    }, [data, metricMode, isChangeMode, rows, viewMode]);

    const periodOptions = useMemo(() => {
        if (isChangeMode) {
            return CHAT_TREEMAP_PERIOD_OPTIONS.filter((o) => o.value !== 'ALL');
        }
        if (viewMode === 'all') {
            return CHAT_TREEMAP_PERIOD_OPTIONS.filter((o) => o.value !== '1D' && o.value !== '1W');
        }
        return CHAT_TREEMAP_PERIOD_OPTIONS;
    }, [isChangeMode, viewMode]);

    useEffect(() => {
        const hasCurrentPeriod = periodOptions.some((o) => o.value === period);
        if (!hasCurrentPeriod) {
            setPeriod(periodOptions[0]?.value ?? '1D');
        }
    }, [periodOptions, period]);

    if (isLoading) {
        return (
            <div className="mt-2 text-xs text-[#6b7280]">
                트리맵 데이터를 불러오는 중입니다...
            </div>
        );
    }

    if (error) {
        return (
            <div className="mt-2 text-xs text-[#ef4444]">
                트리맵을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.
            </div>
        );
    }

    if (!data || data.videos.length === 0) {
        return (
            <div className="mt-2 text-xs text-[#6b7280]">
                {CHAT_TREEMAP_EMPTY_MESSAGE}
            </div>
        );
    }

    if (treemapCells.length === 0) {
        return (
            <div className="mt-2 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 text-xs text-[#6b7280]">
                트리맵을 표시할 수 없습니다. 잠시 후 다시 시도해 주세요.
            </div>
        );
    }

    return (
        <div className="mt-1">
            {/* 컨트롤 바 — Google Looker / Tableau 스타일 컴팩트 pill toggles */}
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {/* 모드 */}
                <div className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-[#9ca3af] select-none">모드</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-[#e5e7eb]">
                        {CHAT_TREEMAP_VIEW_MODE_OPTIONS.map((o) => (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => setViewMode(o.value)}
                                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${viewMode === o.value
                                    ? 'bg-[#111827] text-white'
                                    : 'bg-white text-[#374151] hover:bg-[#f3f4f6]'
                                    }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                {/* 지표 */}
                <div className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-[#9ca3af] select-none">지표</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-[#e5e7eb]">
                        {CHAT_TREEMAP_METRIC_OPTIONS.map((o) => (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => setMetricMode(o.value)}
                                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${metricMode === o.value
                                    ? 'bg-[#111827] text-white'
                                    : 'bg-white text-[#374151] hover:bg-[#f3f4f6]'
                                    }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                {/* 기간 */}
                <div className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-[#9ca3af] select-none">기간</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-[#e5e7eb]">
                        {periodOptions.map((o) => (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => setPeriod(o.value)}
                                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${period === o.value
                                    ? 'bg-[#111827] text-white'
                                    : 'bg-white text-[#374151] hover:bg-[#f3f4f6]'
                                    }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                {/* 색상 범례 */}
                <div className="inline-flex items-center gap-1 ml-auto">
                    <div className="inline-flex overflow-hidden rounded border border-[#e5e7eb]">
                        {CHAT_TREEMAP_COLORS.map((color, idx) => (
                            <div
                                key={color}
                                className="h-4 px-1.5 text-[8px] leading-4 text-white font-medium"
                                style={{ backgroundColor: color, textShadow: '0 1px 0 rgba(0,0,0,.25)' }}
                            >
                                {idx === 0 ? '0%' : `+${idx}%`}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mb-1 text-xs text-[#6b7280]">
                {displayedSummary}
            </div>
            <div ref={containerRef} className="w-full min-w-0">
                <div
                    className="relative w-full rounded-lg border border-[#e5e7eb] bg-[#f8fafc] overflow-visible"
                    style={{ height: `${dimensions.height}px` }}
                >
                    {tooltip ? (
                        <div
                            className="absolute z-20 min-w-[220px] max-w-[280px] rounded-lg border border-[#111827]/20 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur-sm"
                            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
                        >
                            <p className="text-xs font-semibold leading-snug text-[#111827] break-all">
                                {tooltip.title}
                            </p>
                            <p className="mt-1 text-[11px] text-[#6b7280]">
                                {tooltip.category}
                            </p>
                            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                                <p className="text-[11px] text-[#374151]">
                                    조회수: {chatTreemapFormatTooltipMetric('views', tooltip.viewCount)}
                                </p>
                                <p className="text-[11px] text-[#374151]">
                                    좋아요: {chatTreemapFormatTooltipMetric('likes', tooltip.likeCount)}
                                </p>
                                <p className="text-[11px] text-[#374151]">
                                    댓글수: {chatTreemapFormatTooltipMetric('comments', tooltip.commentCount)}
                                </p>
                                <p className="text-[11px] text-[#374151]">
                                    영상 길이: {chatTreemapFormatTooltipMetric('duration', tooltip.duration)}
                                </p>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 border-t border-[#e5e7eb] pt-1.5">
                                <p className="text-[11px] font-medium text-[#111827]">
                                    {isChangeMode
                                        ? `${chatTreemapGetPeriodLabel(period)} 증감률: ${tooltip.percentText}`
                                        : `비율: ${tooltip.percentText}`}
                                </p>
                                {isChangeMode ? (
                                    <p className="text-[10px] text-[#9ca3af]">
                                        이전 {chatTreemapGetMetricLabel(metricMode)}: {chatTreemapFormatMetric(metricMode, tooltip.previousMetricRaw ?? tooltip.metricRaw)}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                    {treemapCells.map((cell) => {
                        const width = Math.max(0, cell.x1 - cell.x0);
                        const height = Math.max(0, cell.y1 - cell.y0);
                        const tileArea = Math.max(1, width * height);
                        const tileBaseSize = Math.sqrt(tileArea);
                        const tileInnerHeight = Math.max(6, height - 6);
                        const isRenderable = width > 2 && height > 2;

                        if (!isRenderable) return null;

                        const metricFont = Math.max(10, Math.min(54, Math.floor(tileBaseSize * 0.19)));
                        const percentFont = Math.max(8, Math.min(24, Math.floor(metricFont * 0.6)));
                        const tinyFont = Math.max(8, Math.floor(Math.min(width, height) * 0.38));

                        const bothLineHeight = metricFont + percentFont + 4;
                        const canShowBoth = width >= 24 && tileArea >= 220 && bothLineHeight <= Math.max(10, tileInnerHeight - 2);
                        const canShowOneLine = width >= 14 && tileArea >= 150;
                        const canShowEllipsis = width >= 12 && height >= 12;

                        if (width < 16 || height < 16) {
                            return (
                                <div
                                    key={`${cell.node.id}-${cell.x0}-${cell.y0}`}
                                    className="absolute flex items-center justify-center border border-white/30 overflow-hidden"
                                    onPointerMove={(event) => updateTooltip(event, cell)}
                                    onPointerEnter={(event) => updateTooltip(event, cell)}
                                    onPointerLeave={clearTooltip}
                                    onPointerDown={(event) => updateTooltip(event, cell)}
                                    style={{
                                        left: `${(cell.x0 / dimensions.width) * 100}%`,
                                        top: `${(cell.y0 / dimensions.height) * 100}%`,
                                        width: `${(width / dimensions.width) * 100}%`,
                                        height: `${(height / dimensions.height) * 100}%`,
                                        backgroundColor: cell.node.color,
                                        color: '#ffffff',
                                        textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                    }}
                                >
                                    {canShowEllipsis ? (
                                        <span style={{ fontSize: `${tinyFont}px`, lineHeight: 1, fontWeight: 700 }}>...</span>
                                    ) : null}
                                </div>
                            );
                        }

                        return (
                            <div
                                key={`${cell.node.id}-${cell.x0}-${cell.y0}`}
                                className="absolute flex items-center justify-center border border-white/30 overflow-hidden"
                                onPointerMove={(event) => updateTooltip(event, cell)}
                                onPointerEnter={(event) => updateTooltip(event, cell)}
                                onPointerLeave={clearTooltip}
                                onPointerDown={(event) => updateTooltip(event, cell)}
                                style={{
                                    left: `${(cell.x0 / dimensions.width) * 100}%`,
                                    top: `${(cell.y0 / dimensions.height) * 100}%`,
                                    width: `${(width / dimensions.width) * 100}%`,
                                    height: `${(height / dimensions.height) * 100}%`,
                                    backgroundColor: cell.node.color,
                                    overflow: 'hidden',
                                    boxSizing: 'border-box',
                                }}
                            >
                                {canShowBoth ? (
                                    <div
                                        className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center"
                                        style={{ color: '#ffffff', textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px' }}
                                    >
                                        <span
                                            title={cell.node.metricText}
                                            className="w-full truncate text-center overflow-hidden whitespace-nowrap leading-tight font-semibold"
                                            style={{ fontSize: `${metricFont}px`, lineHeight: 1 }}
                                        >
                                            {cell.node.metricText}
                                        </span>
                                        <span
                                            title={cell.node.percentText}
                                            className="w-full truncate text-center overflow-hidden whitespace-nowrap leading-tight"
                                            style={{ fontSize: `${percentFont}px`, lineHeight: 1 }}
                                        >
                                            {cell.node.percentText}
                                        </span>
                                    </div>
                                ) : canShowOneLine ? (
                                    <div
                                        className="flex h-full w-full items-center justify-center px-1 text-center"
                                        style={{ color: '#ffffff', textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px' }}
                                    >
                                        <span
                                            className="w-full truncate overflow-hidden whitespace-nowrap font-semibold leading-tight"
                                            style={{ fontSize: `${metricFont}px`, lineHeight: 1 }}
                                        >
                                            {cell.node.metricText}
                                        </span>
                                    </div>
                                ) : canShowEllipsis ? (
                                    <div
                                        className="flex h-full w-full items-center justify-center px-1 text-center"
                                        style={{
                                            color: '#ffffff',
                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                            fontSize: `${metricFont}px`,
                                            lineHeight: '1',
                                            fontWeight: 700,
                                        }}
                                    >
                                        ...
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});
InsightChatTreemap.displayName = 'InsightChatTreemap';

export function deserializeConversationList(raw: PersistedChatState | null): {
    conversations: ChatConversation[];
    activeConversationId: string;
} | null {
    if (!raw
        || !Number.isInteger(raw.version)
        || raw.version < 1
        || raw.version > CHAT_STORAGE_SCHEMA_VERSION
        || !Array.isArray(raw.conversations)
        || raw.conversations.length === 0
    ) {
        return null;
    }

    const conversations = raw.conversations
        .map((conversation): ChatConversation | null => {
            if (!conversation || typeof conversation !== 'object') {
                return null;
            }

            if (typeof conversation.id !== 'string' || typeof conversation.title !== 'string') {
                return null;
            }

            if (!Array.isArray(conversation.messages)) {
                return null;
            }

            const messages = conversation.messages
                .filter((message): message is PersistedChatMessage => {
                    if (!message || typeof message !== 'object') {
                        return false;
                    }
                    return typeof message.id === 'string'
                        && (message.role === 'user' || message.role === 'assistant')
                        && typeof message.content === 'string'
                        && typeof message.createdAt === 'string';
                })
                .map((message) => {
                    const parsedCreatedAt = new Date(message.createdAt);
                    return {
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        sources: mapSources(message.sources),
                        followUpPrompts: normalizeFollowUpPrompts(message.followUpPrompts),
                        createdAt: Number.isNaN(parsedCreatedAt.getTime()) ? new Date() : parsedCreatedAt,
                        meta: message.meta,
                        visualComponent: message.visualComponent,
                    };
                });

            return {
                id: conversation.id,
                title: conversation.title,
                messages,
                tags: normalizeConversationTags(conversation.tags),
                createdAt: conversation.createdAt ?? Date.now(),
                updatedAt: conversation.updatedAt ?? Date.now(),
                isBooting: false,
                bootstrapFailed: Boolean(conversation.bootstrapFailed),
                pinned: raw.version >= 2 ? Boolean(conversation.pinned) : false,
                contextWindowSize: typeof conversation.contextWindowSize === 'number' && Number.isFinite(conversation.contextWindowSize)
                    ? Math.max(1, Math.floor(conversation.contextWindowSize))
                    : undefined,
                responseMode: normalizeResponseMode(conversation.responseMode),
                memoryMode: raw.version >= 5
                    ? normalizeMemoryMode(conversation.memoryMode)
                    : DEFAULT_MEMORY_MODE,
                memoryProfileNote: raw.version >= 6
                    ? sanitizeMemoryProfileNote(conversation.memoryProfileNote)
                    : undefined,
            };
        })
        .filter((conversation): conversation is ChatConversation => conversation !== null)
        .slice(0, MAX_CONVERSATIONS);

    if (conversations.length === 0) {
        return null;
    }

    const activeConversationId = raw.activeConversationId && conversations.some((conversation) => conversation.id === raw.activeConversationId)
        ? raw.activeConversationId
        : conversations[0].id;

    return { conversations, activeConversationId };
}

export function serializeConversationList(
    conversations: ChatConversation[],
    activeConversationId: string,
): PersistedChatState {
    return {
        version: CHAT_STORAGE_SCHEMA_VERSION,
        activeConversationId,
        conversations: conversations.slice(-MAX_CONVERSATIONS).map((conversation) => ({
            id: conversation.id,
            title: conversation.title,
            messages: conversation.messages.map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                sources: message.sources,
                followUpPrompts: message.followUpPrompts,
                createdAt: message.createdAt.toISOString(),
                meta: message.meta,
                visualComponent: message.visualComponent,
            })),
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            isBooting: conversation.isBooting,
            bootstrapFailed: conversation.bootstrapFailed,
            pinned: Boolean(conversation.pinned),
            tags: normalizeConversationTags(conversation.tags),
            contextWindowSize: conversation.contextWindowSize,
            responseMode: conversation.responseMode ?? DEFAULT_RESPONSE_MODE,
            memoryMode: conversation.memoryMode ?? DEFAULT_MEMORY_MODE,
            memoryProfileNote: sanitizeMemoryProfileNote(conversation.memoryProfileNote),
        })),
    };
}

function createInitialConversation(id: string): ChatConversation {
    return {
        id,
        title: EMPTY_TITLE,
        messages: [],
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isBooting: false,
        bootstrapFailed: false,
        pinned: false,
        contextWindowSize: MESSAGE_WINDOW_INITIAL,
        responseMode: DEFAULT_RESPONSE_MODE,
        memoryMode: DEFAULT_MEMORY_MODE,
        memoryProfileNote: '',
    };
}

function getConversationResponseMode(conversation: ChatConversation | null | undefined): InsightChatResponseMode {
    return normalizeResponseMode(conversation?.responseMode);
}

function getConversationMemoryMode(conversation: ChatConversation | null | undefined): InsightChatMemoryMode {
    return normalizeMemoryMode(conversation?.memoryMode);
}

const CHAT_BUBBLE_MARKDOWN_COMPONENTS = {
    h1: ({ children, ...props }: ComponentPropsWithoutRef<'h1'>) => <h2 {...props} className="text-base font-semibold mb-2 mt-3 first:mt-0 break-words">{children}</h2>,
    h2: ({ children, ...props }: ComponentPropsWithoutRef<'h2'>) => <h3 {...props} className="text-sm font-semibold mb-1 mt-2.5 first:mt-0 break-words">{children}</h3>,
    h3: ({ children, ...props }: ComponentPropsWithoutRef<'h3'>) => <h4 {...props} className="text-sm font-medium mb-1 mt-2.5 first:mt-0 break-words">{children}</h4>,
    p: ({ children, ...props }: ComponentPropsWithoutRef<'p'>) => <p {...props} className="whitespace-pre-wrap break-words text-sm leading-6">{children}</p>,
    ul: ({ children, ...props }: ComponentPropsWithoutRef<'ul'>) => <ul {...props} className="list-disc pl-5 my-1 space-y-0.5 text-sm leading-6 break-words">{children}</ul>,
    ol: ({ children, ...props }: ComponentPropsWithoutRef<'ol'>) => <ol {...props} className="list-decimal pl-5 my-1 space-y-0.5 text-sm leading-6 break-words">{children}</ol>,
    li: ({ children, ...props }: ComponentPropsWithoutRef<'li'>) => <li {...props} className="text-sm leading-6 break-words">{children}</li>,
    a: ({ children, href, ...props }: ComponentPropsWithoutRef<'a'>) => {
        const safeHref = href ?? '';
        const isExternal = /^https?:/i.test(safeHref);
        return (
            <a
                href={safeHref || '#'}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
                className="text-[#ef4444] underline underline-offset-2 hover:no-underline break-all"
            >
                {children}
            </a>
        );
    },
    table: ({ children, ...props }: ComponentPropsWithoutRef<'table'>) => (
        <div className="my-2 overflow-x-auto">
            <table {...props} className="w-full min-w-0 text-sm border-collapse border border-[#e5e7eb]">{children}</table>
        </div>
    ),
    thead: ({ children, ...props }: ComponentPropsWithoutRef<'thead'>) => <thead {...props} className="bg-[#f9fafb]">{children}</thead>,
    tbody: ({ children, ...props }: ComponentPropsWithoutRef<'tbody'>) => <tbody {...props}>{children}</tbody>,
    tr: ({ children, ...props }: ComponentPropsWithoutRef<'tr'>) => <tr {...props} className="border-b border-[#e5e7eb]">{children}</tr>,
    th: ({ children, ...props }: ComponentPropsWithoutRef<'th'>) => <th {...props} className="border border-[#e5e7eb] p-2 text-left text-[11px] break-words">{children}</th>,
    td: ({ children, ...props }: ComponentPropsWithoutRef<'td'>) => <td {...props} className="border border-[#e5e7eb] p-2 text-sm break-words">{children}</td>,
    blockquote: ({ children, ...props }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote {...props} className="border-l-4 border-[#e5e7eb] pl-3 my-2 text-sm text-[#6b7280] break-words">
            {children}
        </blockquote>
    ),
    pre: ({ children, ...props }: ComponentPropsWithoutRef<'pre'>) => (
        <pre {...props} className="overflow-x-auto rounded-md bg-[#f3f4f6] p-3 my-2 text-sm">{children}</pre>
    ),
    code: ({ children, ...props }: ComponentPropsWithoutRef<'code'>) => <code {...props} className="rounded bg-[#f3f4f6] px-1 py-0.5 text-xs">{children}</code>,
};

const CHAT_PREVIEW_MARKDOWN_COMPONENTS = {
    h1: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="font-semibold">{children}</span>,
    h2: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="font-semibold">{children}</span>,
    h3: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="font-medium">{children}</span>,
    h4: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="font-medium">{children}</span>,
    p: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props}>{children}</span>,
    em: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="italic">{children}</span>,
    strong: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="font-semibold">{children}</span>,
    code: ({ children, ...props }: ComponentPropsWithoutRef<'code'>) => <code {...props} className="rounded bg-[#f3f4f6] px-1 py-0.5 text-[11px]">{children}</code>,
    table: ({ children, ...props }: ComponentPropsWithoutRef<'table'>) => (
        <div className="my-1 overflow-x-auto">
            <table {...props} className="w-full text-xs border-collapse border border-[#e5e7eb]">{children}</table>
        </div>
    ),
    thead: ({ children, ...props }: ComponentPropsWithoutRef<'thead'>) => <thead {...props} className="bg-[#f9fafb]">{children}</thead>,
    tbody: ({ children, ...props }: ComponentPropsWithoutRef<'tbody'>) => <tbody {...props}>{children}</tbody>,
    tr: ({ children, ...props }: ComponentPropsWithoutRef<'tr'>) => <tr {...props} className="border-b border-[#e5e7eb]">{children}</tr>,
    th: ({ children, ...props }: ComponentPropsWithoutRef<'th'>) => <th {...props} className="border border-[#e5e7eb] p-1 text-left text-[11px]">{children}</th>,
    td: ({ children, ...props }: ComponentPropsWithoutRef<'td'>) => <td {...props} className="border border-[#e5e7eb] p-1 text-[11px]">{children}</td>,
    ul: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="inline">{children}</span>,
    ol: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="inline">{children}</span>,
    li: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="inline">{children}</span>,
    a: ({ children, href, ...props }: ComponentPropsWithoutRef<'a'>) => {
        const safeHref = href ?? '';
        const isExternal = /^https?:/i.test(safeHref);
        return (
            <a
                href={safeHref || '#'}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
                className="text-[#ef4444] underline underline-offset-2 hover:no-underline"
            >
                {children}
            </a>
        );
    },
    blockquote: ({ children, ...props }: ComponentPropsWithoutRef<'span'>) => <span {...props} className="text-[#6b7280]">{children}</span>,
};

const MARKDOWN_HINT_PATTERN = /(?:^#{1,6}\s+|^\s*[-*+]\s+|^\s*\d+\.\s+|`{3}|`[^`]+`|\*\*|__|\[[^\]]+\]\([^)]+\)|^>\s+|\|[^\n]*\|)/m;
const MARKDOWN_HINT_CACHE_LIMIT = 300;
const markdownHeuristicCache = new Map<string, boolean>();
const HTML_HINT_PATTERN = /<([a-z][\w:-]*)(\s|\/?>)/i;
const BLOCKED_HTML_TAGS_PATTERN = /<(script|style|iframe|object|embed|meta|link|base|form|svg|math|frame|frameset)\b[\s\S]*?>[\s\S]*?(?:<\/\1>|(?=\/\s*>))/gi;
const EVENT_ATTR_PATTERN = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SRC_HREF_JS_PROTOCOL_PATTERN = /\s+(src|href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;
const NODE_ATTR_PATTERN = /\s+node=(?:"\[object Object\]"|'\[object Object\]')/g;

function sanitizeHtmlForMarkdownInput(html: string): string {
    return html
        .replace(NODE_ATTR_PATTERN, '')
        .replace(SRC_HREF_JS_PROTOCOL_PATTERN, ' href="#"')
        .replace(BLOCKED_HTML_TAGS_PATTERN, '')
        .replace(EVENT_ATTR_PATTERN, '')
        .replace(/<(?:!--[\s\S]*?-->|\?[\s\S]*?\?>)/g, '');
}

function htmlToMarkdown(html: string): string {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
    const root = doc.body;
    if (!root) return '';

    const escapeMarkdownText = (value: string): string => value.replace(/[\\`*_~\[\]{}]/g, (char) => `\\${char}`);
    const normalizeSpace = (value: string): string => value.replace(/\s+/g, ' ').trim();

    const collectRows = (table: HTMLTableElement): string => {
        const rows = [...table.rows];
        if (!rows.length) return '';

        const parsedRows = rows.map((row) => [...row.cells].map((cell) => normalizeSpace(normalizeHtmlNode(cell))));
        const header = parsedRows[0] ?? [];
        const body = parsedRows.slice(1);
        if (!header.length) return '';

        const headerLine = `| ${header.join(' | ')} |`;
        const separator = `| ${header.map(() => '---').join(' | ')} |`;
        const bodyLines = body.map((columns) => `| ${columns.join(' | ')} |`);
        return [headerLine, separator, ...bodyLines].join('\n') + '\n\n';
    };

    const listToMarkdown = (node: HTMLUListElement | HTMLOListElement): string => {
        const items = [...node.children].filter((child): child is HTMLLIElement => child.tagName.toLowerCase() === 'li');
        return items
            .map((item, index) => {
                const prefix = node.tagName.toLowerCase() === 'ol' ? `${index + 1}. ` : '- ';
                return `${prefix}${normalizeSpace(normalizeHtmlNode(item))}`;
            })
            .join('\n') + '\n\n';
    };

    const normalizeHtmlNode = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
            return normalizeSpace(node.textContent || '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        const children = [...element.childNodes].map(normalizeHtmlNode).join('');

        switch (tag) {
            case 'h1':
                return `# ${normalizeSpace(children)}\n\n`;
            case 'h2':
                return `## ${normalizeSpace(children)}\n\n`;
            case 'h3':
                return `### ${normalizeSpace(children)}\n\n`;
            case 'h4':
                return `#### ${normalizeSpace(children)}\n\n`;
            case 'h5':
                return `##### ${normalizeSpace(children)}\n\n`;
            case 'h6':
                return `###### ${normalizeSpace(children)}\n\n`;
            case 'p':
            case 'div':
                return `${normalizeSpace(children)}\n\n`;
            case 'hr':
                return '---\n\n';
            case 'br':
                return '\n';
            case 'blockquote':
                return children.split('\n').map((line) => `> ${line}`).join('\n') + '\n\n';
            case 'pre':
                return `\n\`\`\`\n${element.textContent?.trim() || ''}\n\`\`\`\n\n`;
            case 'code':
                return `\`${escapeMarkdownText(element.textContent || '')}\``;
            case 'strong':
            case 'b':
                return `**${normalizeSpace(children)}**`;
            case 'em':
            case 'i':
                return `*${normalizeSpace(children)}*`;
            case 'a': {
                const href = (element.getAttribute('href') || '').trim();
                const text = normalizeSpace(children);
                return href ? `[${text}](${href})` : text;
            }
            case 'ul':
            case 'ol':
                return listToMarkdown(element as HTMLUListElement | HTMLOListElement);
            case 'li':
                return `- ${normalizeSpace(children)}`;
            case 'table':
                return collectRows(element as HTMLTableElement);
            case 'thead':
            case 'tbody':
            case 'tr':
            case 'th':
            case 'td':
                return normalizeSpace(children);
            default:
                return normalizeSpace(children);
        }
    };

    return [...root.childNodes]
        .map(normalizeHtmlNode)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

type ReactMarkdownProps = Parameters<typeof ReactMarkdown>[0];
type MarkdownComponentMap = NonNullable<ReactMarkdownProps['components']>;

function shouldRenderMarkdown(content: string): boolean {
    const cached = markdownHeuristicCache.get(content);
    if (cached !== undefined) {
        return cached;
    }

    const result = MARKDOWN_HINT_PATTERN.test(content) || HTML_HINT_PATTERN.test(content);

    if (markdownHeuristicCache.size >= MARKDOWN_HINT_CACHE_LIMIT) {
        markdownHeuristicCache.clear();
    }
    markdownHeuristicCache.set(content, result);

    return result;
}
const CONVERSATION_PREVIEW_CLAMP_STYLE: {
    display: string;
    overflow: string;
    textOverflow: string;
    WebkitLineClamp: number;
    WebkitBoxOrient: 'vertical';
    whiteSpace: 'nowrap';
} = {
    display: '-webkit-box',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    WebkitLineClamp: 1,
    WebkitBoxOrient: 'vertical',
    whiteSpace: 'nowrap',
};

const TypingIndicator = memo(() => (
    <div className="flex items-center gap-2 py-1">
        <div className="flex items-center gap-1">
            <span
                className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]"
                style={{ animation: 'chatTypingPulse 1.4s ease-in-out infinite', animationDelay: '0ms' }}
            />
            <span
                className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]"
                style={{ animation: 'chatTypingPulse 1.4s ease-in-out infinite', animationDelay: '200ms' }}
            />
            <span
                className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]"
                style={{ animation: 'chatTypingPulse 1.4s ease-in-out infinite', animationDelay: '400ms' }}
            />
        </div>
        <style dangerouslySetInnerHTML={{
            __html: `
            @keyframes chatTypingPulse {
                0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                40% { opacity: 1; transform: scale(1); }
            }

        ` }} />
    </div>
));
TypingIndicator.displayName = 'TypingIndicator';

const SourceList = memo(({ sources }: { sources: InsightChatSource[] }) => {
    if (sources.length === 0) return null;

    return (
        <div className="mt-3 border-t border-[#e5e7eb] pt-2">
            <p className="text-xs text-[#6b7280] font-semibold mb-2">
                참고 자료
                <span className="ml-1 text-[#9ca3af]">({sources.length}건)</span>
            </p>
            <div className="space-y-1">
                {sources.map((source, idx) => (
                    <div
                        key={`${source.videoTitle}-${source.youtubeLink}-${idx}`}
                        className="flex flex-wrap gap-1 text-xs leading-4 min-w-0 break-words text-[#6b7280]"
                    >
                        {source.youtubeLink ? (
                            <a
                                href={source.youtubeLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#ef4444] hover:underline"
                            >
                                <span className="font-medium break-words">{source.videoTitle || '스토리보드 참고 소스'}</span>
                            </a>
                        ) : (
                            <span className="font-medium break-words">{source.videoTitle || '스토리보드 참고 소스'}</span>
                        )}
                        <span className="text-[#6b7280] break-words">({source.timestamp || '-'})</span>
                        {source.text ? <span className="text-[#374151] truncate">: {source.text}</span> : null}
                    </div>
                ))}
            </div>
        </div>
    );
});
SourceList.displayName = 'SourceList';

const MessageMetaPanel = memo(({ meta, sources }: { meta?: AdminInsightChatMeta | null; sources?: InsightChatSource[] }) => {
    if (!meta) return null;

    const sourceLabel = getSourceLabel(meta.source);
    const modelLabel = getModelLabel(meta.model);
    const fallbackReasonLabel = getFallbackReasonLabel(meta.fallbackReason);
    const requestIdLabel = getRequestIdLabel(meta.requestId);
    const responseModeLabel = meta.responseMode ? {
        fast: '빠른 응답',
        deep: '깊은 분석',
        structured: '구조화',
    }[meta.responseMode] ?? null : null;
    const memoryModeLabel = meta.memoryMode ? {
        off: '기억 안함',
        session: '세션 기억',
        pinned: '핀 고정',
    }[meta.memoryMode] ?? null : null;
    const confidenceLabel = getConfidenceLabel(meta.confidence);
    const latencyLabel = getLatencyLabel(meta.latencyMs);
    const toolTrace = Array.isArray(meta.toolTrace) ? meta.toolTrace.filter(Boolean) : [];
    const citationQuality = meta.citationQuality ?? getCitationQualityFromSources(sources);
    const citationQualityLabel = getCitationQualityLabel(citationQuality);

    return (
        <div className="mt-2 border-t border-[#e5e7eb] pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
                {responseModeLabel ? (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${RESPONSE_MODE_BADGE_STYLES[meta.responseMode!]}`}>
                        모드: {responseModeLabel}
                    </span>
                ) : null}
                {memoryModeLabel ? (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${MEMORY_MODE_BADGE_STYLES[meta.memoryMode!]}`}>
                        기억: {memoryModeLabel}
                    </span>
                ) : null}
                {citationQualityLabel ? (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${META_CITATION_QUALITY_BADGE_STYLES[citationQuality]}`}>
                        인용: {citationQualityLabel}
                    </span>
                ) : null}
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#eef2ff] text-[#3730a3]">
                    출처: {sourceLabel}
                </span>
                {modelLabel ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#f0fdf4] text-[#166534]">
                        모델: {modelLabel}
                    </span>
                ) : null}
                {fallbackReasonLabel ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#fff7ed] text-[#9a3412]">
                        사유: {fallbackReasonLabel}
                    </span>
                ) : null}
                {confidenceLabel ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#e0f2fe] text-[#075985]">
                        신뢰도: {confidenceLabel}
                    </span>
                ) : null}
                {latencyLabel ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#ecfeff] text-[#0e7490]">
                        지연: {latencyLabel}
                    </span>
                ) : null}
                {requestIdLabel ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#f3f4f6] text-[#4b5563]">
                        요청ID: {requestIdLabel}
                    </span>
                ) : null}
            </div>
            {toolTrace.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] text-[#6b7280]">도구 추적:</span>
                    {toolTrace.slice(0, 3).map((trace) => (
                        <span
                            key={trace}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-[#f8fafc] text-[#64748b]"
                            title={trace}
                        >
                            {trace}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
});
MessageMetaPanel.displayName = 'MessageMetaPanel';

const FollowUpPromptChips = memo(({
    prompts,
    onSelectPrompt,
    disabled,
}: {
    prompts: InsightChatFollowUpPrompt[];
    onSelectPrompt: (prompt: string) => void;
    disabled?: boolean;
}) => {
    const visiblePrompts = prompts
        .slice()
        .filter((prompt, index, self) => {
            if (prompt.prompt.trim().length === 0) return false;
            return self.findIndex((item) => item.prompt === prompt.prompt) === index;
        })
        .slice(0, MAX_FOLLOW_UP_PROMPTS);

    if (visiblePrompts.length === 0) return null;

    return (
        <div className="mt-2">
            <p className="text-[10px] text-[#6b7280] font-semibold mb-1.5">추천 후속 질문</p>
            <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 min-w-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {visiblePrompts.map((prompt, index) => (
                    <button
                        key={`${prompt.prompt}-${index}`}
                        type="button"
                        onClick={() => onSelectPrompt(sanitizeFollowUpPromptText(prompt.prompt))}
                        disabled={disabled}
                        className={cn(
                            'inline-flex items-center rounded-full border px-2.5 py-1 text-xs text-[#374151] transition',
                            disabled ? 'border-[#d1d5db] text-[#9ca3af] cursor-not-allowed' : 'border-[#e5e7eb] hover:bg-[#f9fafb] hover:border-[#cbd5e1]',
                        )}
                        aria-label={`${prompt.label || prompt.prompt} 바로 보내기`}
                    >
                        {prompt.label || prompt.prompt}
                    </button>
                ))}
            </div>
        </div>
    );
});
FollowUpPromptChips.displayName = 'FollowUpPromptChips';

const MarkdownRenderer = memo(({
    content,
    components,
    className,
    plainTextClassName,
}: {
    content: string;
    components: MarkdownComponentMap;
    className?: string;
    plainTextClassName?: string;
}) => {
    const shouldParse = shouldRenderMarkdown(content);
    const shouldRenderRawHtml = HTML_HINT_PATTERN.test(content);

    if (!shouldParse) {
        return <div className={cn(plainTextClassName, className)}>{content}</div>;
    }

    if (shouldRenderRawHtml) {
        const markdown = htmlToMarkdown(sanitizeHtmlForMarkdownInput(content));
        return (
            <div
                className={cn(className, 'space-y-2')}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={components}
                >
                    {markdown || content}
                </ReactMarkdown>
            </div>
        );
    }

    return (
        <div className={className}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={components}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
});
MarkdownRenderer.displayName = 'MarkdownRenderer';



type ChatBubbleProps = {
  message: ChatMessage;
  followUpPrompts?: InsightChatFollowUpPrompt[];
  canEdit?: boolean;
  onEditMessage?: (message: ChatMessage) => void;
  onRegenerate?: (messageId: string) => void;
  canRegenerate?: boolean;
  feedback?: {
      rating?: InsightChatFeedbackRating;
      reason?: string;
  };
  onFeedback?: (messageId: string, rating: InsightChatFeedbackRating | null, reason?: string) => void;
  onFollowUpPrompt?: (prompt: string) => void;
  isFollowUpDisabled?: boolean;
};

const ChatBubble = memo(({
  message,
  followUpPrompts,
  canEdit,
  onEditMessage,
  onRegenerate,
  canRegenerate = false,
  feedback,
  onFeedback,
  onFollowUpPrompt,
  isFollowUpDisabled,
}: ChatBubbleProps) => {
    const isUser = message.role === 'user';
    const isTreemapMessage = message.visualComponent === 'treemap';
    const maxWidthClass = isUser ? 'max-w-[84%]' : isTreemapMessage ? 'w-full max-w-full' : 'max-w-[84%]';
    const textWrapClass = isTreemapMessage ? 'w-full' : 'w-full';
    const [isCopied, setIsCopied] = useState(false);
    const [isMetaVisible, setIsMetaVisible] = useState(false);
    const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (copyResetTimerRef.current) {
                clearTimeout(copyResetTimerRef.current);
            }
        };
    }, []);

    const handleCopyMessage = useCallback(async () => {
        if (!message.content) return;
        try {
            await navigator.clipboard.writeText(message.content);
            setIsCopied(true);
            if (copyResetTimerRef.current) {
                clearTimeout(copyResetTimerRef.current);
            }
            copyResetTimerRef.current = setTimeout(() => {
                setIsCopied(false);
            }, 1200);
        } catch (error) {
            console.error('메시지 복사 실패:', error);
            setIsCopied(false);
        }
    }, [message.content]);

    const hasMessageMeta = Boolean(message.meta);
    const toggleMeta = useCallback(() => {
        setIsMetaVisible((prev) => !prev);
    }, []);
    const normalizedFollowUpPrompts = useMemo(() => {
        if (!followUpPrompts?.length) return [];
        const seen = new Set<string>();
        return followUpPrompts
            .map((entry) => ({
                prompt: sanitizeFollowUpPromptText(entry.prompt),
                label: sanitizeFollowUpPromptText(entry.label),
            }))
            .filter((entry) => {
                if (!entry.prompt) return false;
                if (seen.has(entry.prompt)) return false;
                seen.add(entry.prompt);
                return true;
            });
    }, [followUpPrompts]);
    const actionRowAlignmentClass = isUser ? 'justify-end' : 'justify-start';
    const currentFeedback = message.id ? feedback : undefined;
    const handleEditClick = useCallback(() => {
        onEditMessage?.(message);
    }, [message, onEditMessage]);
    const handleRegenerateClick = useCallback(() => {
        onRegenerate?.(message.id);
    }, [message.id, onRegenerate]);
    const handleFollowUpPromptSelect = useCallback((prompt: string) => {
        onFollowUpPrompt?.(prompt);
    }, [onFollowUpPrompt]);

    return (
        <div className={cn(
            'flex min-w-0',
            isUser ? 'flex-row-reverse gap-2.5 mb-4' : isTreemapMessage ? 'flex-row gap-1.5 mb-2' : 'flex-row gap-2.5 mb-4',
            isTreemapMessage ? 'w-full' : 'w-auto',
        )}>
            <div
                className={cn(
                    'rounded-full grid place-items-center text-white text-xs shrink-0',
                    isTreemapMessage ? 'h-6 w-6' : 'h-8 w-8',
                    isUser ? 'bg-[#ef4444]' : 'bg-[#111827]',
                )}
            >
                {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className={isTreemapMessage ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
            </div>

            <div
                className={cn(
                    maxWidthClass,
                    'rounded-xl border border-[#e5e7eb] min-w-0 break-words',
                    isTreemapMessage ? 'px-1 py-1 overflow-visible' : 'px-3.5 py-2.5 overflow-hidden',
                    isUser ? 'bg-[#fde68a] text-[#111827]' : 'bg-white text-[#111827]',
                )}
            >
                {isUser ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                ) : message.content ? (
                    <div className={cn(textWrapClass, isTreemapMessage && 'px-1.5')}>
                        <MarkdownRenderer
                            content={message.content}
                            components={CHAT_BUBBLE_MARKDOWN_COMPONENTS}
                            className="text-sm leading-6 break-words"
                            plainTextClassName="whitespace-pre-wrap break-words text-sm leading-6"
                        />
                    </div>
                ) : (
                    <TypingIndicator />
                )}
                {message.visualComponent === 'treemap' ? <InsightChatTreemap /> : null}
                {!isTreemapMessage ? (
                    <div className={cn(textWrapClass)}>
                        <div className={cn(
                            'mt-2 flex w-full min-w-0 flex-nowrap items-center gap-1.5',
                            actionRowAlignmentClass,
                        )}>
                            <button
                                type="button"
                                className={cn(
                                    'inline-flex h-7 shrink-0 min-w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap',
                                    isCopied
                                        ? 'border-emerald-300 bg-[#ecfdf5] text-[#065f46]'
                                        : 'border-[#e5e7eb] hover:bg-[#f9fafb]',
                                    !message.content ? 'text-[#d1d5db] cursor-not-allowed' : 'text-[#374151]',
                                )}
                                onClick={handleCopyMessage}
                                disabled={!message.content}
                            >
                                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                {isCopied ? COPY_SUCCESS_MESSAGE : '복사'}
                            </button>
                            {hasMessageMeta ? (
                                <button
                                    type="button"
                                    className="inline-flex h-7 shrink-0 min-w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap border-[#e5e7eb] hover:bg-[#f9fafb] text-[#4b5563]"
                                    onClick={toggleMeta}
                                    aria-label={isMetaVisible ? '근거 패널 닫기' : '근거 패널 열기'}
                                >
                                    {isMetaVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    근거
                                </button>
                            ) : null}
                            {isUser && canEdit && onEditMessage ? (
                                <button
                                    type="button"
                                    className="inline-flex h-7 shrink-0 min-w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap border-[#e5e7eb] hover:bg-[#f9fafb] text-[#4b5563]"
                                    onClick={handleEditClick}
                                    aria-label="마지막 사용자 메시지 수정"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    수정
                                </button>
                            ) : null}
                            {(!isUser && onFeedback) ? (
                                <>
                                    <button
                                        type="button"
                                        className={cn(
                                            'inline-flex h-7 shrink-0 min-w-16 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap',
                                            currentFeedback?.rating === 'up'
                                                ? 'border-emerald-300 bg-[#ecfdf5] text-[#065f46]'
                                                : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#4b5563]',
                                        )}
                                        onClick={() => onFeedback(message.id, currentFeedback?.rating === 'up' ? null : 'up')}
                                        aria-label="이 답변이 유용해요"
                                    >
                                        <ThumbsUp className="h-3.5 w-3.5" />
                                        좋아요
                                    </button>
                                    <button
                                        type="button"
                                        className={cn(
                                            'inline-flex h-7 shrink-0 min-w-16 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap',
                                            currentFeedback?.rating === 'down'
                                                ? 'border-[#fda4af] bg-[#fff1f2] text-[#be123c]'
                                                : 'border-[#e5e7eb] hover:bg-[#f9fafb] text-[#4b5563]',
                                        )}
                                        onClick={() => onFeedback(message.id, currentFeedback?.rating === 'down' ? null : 'down')}
                                        aria-label="이 답변이 개선이 필요해요"
                                    >
                                        <ThumbsDown className="h-3.5 w-3.5" />
                                        개선 필요
                                    </button>
                                    {currentFeedback?.rating ? (
                                        <span className="inline-flex w-full text-[10px] text-[#6b7280] px-1">
                                            {currentFeedback.reason ? `사유: ${currentFeedback.reason}` : '사유를 입력해 주세요'}
                                        </span>
                                    ) : null}
                                </>
                            ) : null}
                            {!isUser && canRegenerate && onRegenerate ? (
                                <button
                                    type="button"
                                    className="inline-flex h-7 shrink-0 min-w-14 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs whitespace-nowrap border-[#e5e7eb] hover:bg-[#f9fafb] text-[#4b5563]"
                                    onClick={handleRegenerateClick}
                                    aria-label="이 답변 다시 생성"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    다시 생성
                                </button>
                            ) : null}
                        </div>
                        {normalizedFollowUpPrompts.length > 0 ? (
                            <FollowUpPromptChips
                                prompts={normalizedFollowUpPrompts}
                                disabled={isUser || isTreemapMessage || !!isFollowUpDisabled}
                                onSelectPrompt={handleFollowUpPromptSelect}
                            />
                        ) : null}
                        {currentFeedback?.rating ? (
                            <div className="mt-2 flex items-center gap-1.5">
                                <span className="text-[10px] font-medium text-[#6b757f] w-14 shrink-0">
                                    피드백 사유
                                </span>
                                <input
                                    type="text"
                                    value={currentFeedback.reason ?? ''}
                                    onChange={(event) => onFeedback?.(message.id, currentFeedback.rating ?? null, event.target.value)}
                                    placeholder="선택 입력 (최대 280자)"
                                    maxLength={280}
                                    className="flex-1 min-w-0 h-7 px-2 text-[11px] border border-[#e5e7eb] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-[#f87171]"
                                />
                            </div>
                        ) : null}
                        {hasMessageMeta && isMetaVisible ? <MessageMetaPanel meta={message.meta} sources={message.sources} /> : null}
                        {message.sources?.length ? <SourceList sources={message.sources} /> : null}
                    </div>
                ) : message.sources ? (
                    <div className={cn(textWrapClass, isTreemapMessage && 'px-1.5')}>
                        {message.sources?.length ? <SourceList sources={message.sources} /> : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
});
ChatBubble.displayName = 'ChatBubble';

const ConversationPreview = memo(({ content }: { content: string }) => (
    <div
        className="text-xs leading-4 text-[#6b7280]"
        style={CONVERSATION_PREVIEW_CLAMP_STYLE}
    >
        <MarkdownRenderer
            content={content}
            components={CHAT_PREVIEW_MARKDOWN_COMPONENTS}
            className="text-xs leading-4 text-[#6b7280]"
            plainTextClassName="text-xs leading-4 text-[#6b7280]"
        />
    </div>
));
ConversationPreview.displayName = 'ConversationPreview';

const InsightChatSectionComponent = () => {
    const initialConversationId = useMemo(() => makeConversationId(), []);
    const [conversations, setConversations] = useState<ChatConversation[]>(() => [
        createInitialConversation(initialConversationId),
    ]);
    const [activeConversationId, setActiveConversationId] = useState<string>(initialConversationId);
    const [inputValue, setInputValue] = useState('');
    const [draftAttachments, setDraftAttachments] = useState<DraftChatAttachment[]>([]);
    const [messageWindowSize, setMessageWindowSize] = useState(MESSAGE_WINDOW_INITIAL);
    const [sendingConversationId, setSendingConversationId] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [activeCommandIndex, setActiveCommandIndex] = useState(0);
    const bootstrapRequestRef = useRef(new Map<string, number>());
    const streamAbortControllerRef = useRef<AbortController | null>(null);
    const persistDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestPersistConversationsRef = useRef(conversations);
    const latestPersistActiveConversationIdRef = useRef(activeConversationId);

    const [llmKeys, setLlmKeys] = useState<StoredLlmKeys>({});
    const [activeModelId, setActiveModelId] = useState<string>('gemini-3-flash-preview');
    const [enabledModelIds, setEnabledModelIds] = useState<Set<string>>(LLM_DEFAULT_ENABLED);
    const [imageModelProfile, setImageModelProfile] = useState<ImageModelSelection>('none');
    const [showSettings, setShowSettings] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [showImageModelDropdown, setShowImageModelDropdown] = useState(false);
    const [showResponseModeDropdown, setShowResponseModeDropdown] = useState(false);
    const [showMemoryModeDropdown, setShowMemoryModeDropdown] = useState(false);
    const [showConversationList, setShowConversationList] = useState(false);
    const [showGuardrailPanel, setShowGuardrailPanel] = useState(false);
    const [isResettingGuardrailMetrics, setIsResettingGuardrailMetrics] = useState(false);
    const [guardrailActionMessage, setGuardrailActionMessage] = useState<string | null>(null);
    const [conversationSearchQuery, setConversationSearchQuery] = useState('');
    const [conversationQuickFilter, setConversationQuickFilter] = useState<InsightConversationFilter>(CONVERSATION_FILTER_ALL);
    const [activeConversationTagInput, setActiveConversationTagInput] = useState('');
    const [keyVisibility, setKeyVisibility] = useState<Partial<Record<LlmProvider, boolean>>>({});
    const [hasServerGeminiKey, setHasServerGeminiKey] = useState(false);
    const conversationImportInputRef = useRef<HTMLInputElement>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const imageModelDropdownRef = useRef<HTMLDivElement>(null);
    const responseModeDropdownRef = useRef<HTMLDivElement>(null);
    const memoryModeDropdownRef = useRef<HTMLDivElement>(null);
    const [pendingDeletedConversation, setPendingDeletedConversation] = useState<ConversationDeleteSnapshot | null>(null);
    const deleteUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const deleteUndoTokenRef = useRef(0);
    const [messageFeedbacks, setMessageFeedbacks] = useState<Record<string, {
        rating?: InsightChatFeedbackRating;
        reason?: string;
    }>>({});

    useEffect(() => {
        try {
            const raw = localStorage.getItem(LLM_KEYS_STORAGE_KEY);
            if (raw) setLlmKeys(JSON.parse(raw) as StoredLlmKeys);
            const savedModel = localStorage.getItem(LLM_MODEL_STORAGE_KEY);
            if (savedModel && LLM_MODELS.some((m) => m.id === savedModel)) setActiveModelId(savedModel);
            const savedEnabled = localStorage.getItem(LLM_ENABLED_MODELS_KEY);
            if (savedEnabled) {
                const parsed = JSON.parse(savedEnabled) as string[];
                if (Array.isArray(parsed)) setEnabledModelIds(new Set(parsed));
            }
            const savedImageProfile = localStorage.getItem(STORYBOARD_PROFILE_STORAGE_KEY);
            if (savedImageProfile === 'none' || savedImageProfile === 'nanobanana' || savedImageProfile === 'nanobanana_pro') {
                setImageModelProfile(savedImageProfile);
            }
        } catch { /* ignore */ }

        // 서버 환경변수 Gemini 키 로드
        void (async () => {
            try {
                const resp = await fetch('/api/admin/insight/llm-config');
                if (!resp.ok) return;
                const data = (await resp.json()) as { hasGeminiServerKey?: boolean };
                if (data?.hasGeminiServerKey) setHasServerGeminiKey(true);
            } catch { /* ignore */ }
        })();
    }, []);

    useEffect(() => {
        setDraftAttachments([]);
        setActiveConversationTagInput('');
    }, [activeConversationId]);

    const saveLlmKey = useCallback((provider: LlmProvider, key: string) => {
        setLlmKeys((prev) => {
            const next = { ...prev, [provider]: key.trim() || undefined };
            if (!key.trim()) delete next[provider];
            try { localStorage.setItem(LLM_KEYS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);

    const toggleModel = useCallback((modelId: string) => {
        setEnabledModelIds((prev) => {
            const next = new Set(prev);
            if (next.has(modelId)) {
                next.delete(modelId);
            } else {
                next.add(modelId);
            }
            try { localStorage.setItem(LLM_ENABLED_MODELS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
        });
    }, []);

    const selectModel = useCallback((modelId: string) => {
        setActiveModelId(modelId);
        setShowModelDropdown(false);
        try { localStorage.setItem(LLM_MODEL_STORAGE_KEY, modelId); } catch { /* ignore */ }
    }, []);

    const selectImageModelProfile = useCallback((profile: ImageModelSelection) => {
        setImageModelProfile(profile);
        setShowImageModelDropdown(false);
        try {
            if (profile === 'none') {
                localStorage.removeItem(STORYBOARD_PROFILE_STORAGE_KEY);
            } else {
                localStorage.setItem(STORYBOARD_PROFILE_STORAGE_KEY, profile);
            }
        } catch { /* ignore */ }
    }, []);

    const activeModel = useMemo(() => LLM_MODELS.find((m) => m.id === activeModelId) ?? LLM_MODELS[0], [activeModelId]);
    const activeProviderHasUserKey = Boolean(llmKeys[activeModel.provider]);
    const activeProviderHasServerKey = activeModel.provider === 'gemini' && hasServerGeminiKey;
    const activeProviderHasKey = activeProviderHasUserKey || activeProviderHasServerKey;
    const activeProviderUsesServerKey = activeModel.provider === 'gemini' && !activeProviderHasUserKey && hasServerGeminiKey;
    const hasProviderServerOrUserKey = useCallback((provider: LlmProvider) => {
        return provider === 'gemini' ? Boolean(llmKeys[provider]) || hasServerGeminiKey : Boolean(llmKeys[provider]);
    }, [hasServerGeminiKey, llmKeys]);
    const activeImageModelProfile = useMemo(
        () => IMAGE_MODEL_PROFILES.find((profile) => profile.id === imageModelProfile) ?? IMAGE_MODEL_PROFILES[0],
        [imageModelProfile],
    );

    const availableModels = useMemo(() => {
        return LLM_MODELS.filter((m) => enabledModelIds.has(m.id)).map((model) => ({
            ...model,
            hasKey: Boolean(llmKeys[model.provider]) || (model.provider === 'gemini' && hasServerGeminiKey),
        }));
    }, [hasServerGeminiKey, llmKeys, enabledModelIds]);

    const currentLlmConfig = useMemo(() => {
        if (!activeProviderHasKey) return undefined;
        const resolvedImageModelProfile = imageModelProfile === 'none' ? undefined : imageModelProfile;
        return {
            provider: activeModel.provider,
            model: activeModel.id,
            apiKey: llmKeys[activeModel.provider],
            useServerKey: activeProviderUsesServerKey,
            ...(resolvedImageModelProfile ? { storyboardModelProfile: resolvedImageModelProfile } : {}),
            ...(resolvedImageModelProfile ? { imageModelProfile: resolvedImageModelProfile } : {}),
        };
    }, [activeModel, activeProviderHasKey, activeProviderUsesServerKey, imageModelProfile, llmKeys]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
                setShowModelDropdown(false);
            }

            if (imageModelDropdownRef.current && !imageModelDropdownRef.current.contains(e.target as Node)) {
                setShowImageModelDropdown(false);
            }

            if (responseModeDropdownRef.current && !responseModeDropdownRef.current.contains(e.target as Node)) {
                setShowResponseModeDropdown(false);
            }

            if (memoryModeDropdownRef.current && !memoryModeDropdownRef.current.contains(e.target as Node)) {
                setShowMemoryModeDropdown(false);
            }
        };
        if (showModelDropdown || showImageModelDropdown || showResponseModeDropdown || showMemoryModeDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showModelDropdown, showImageModelDropdown, showResponseModeDropdown, showMemoryModeDropdown]);

    useEffect(() => {
        const updatePanelState = () => {
            const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
            setShowConversationList(isDesktop);
        };

        updatePanelState();
        window.addEventListener('resize', updatePanelState);
        return () => window.removeEventListener('resize', updatePanelState);
    }, []);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
        [conversations, activeConversationId],
    );
    const activeConversationResponseMode = getConversationResponseMode(activeConversation);
    const activeConversationMemoryMode = getConversationMemoryMode(activeConversation);
    const {
        data: guardrailMetrics,
        error: guardrailMetricsError,
        isFetching: isGuardrailMetricsFetching,
        refetch: refetchGuardrailMetrics,
    } = useQuery({
        queryKey: ['admin-insight-chat-guardrail-metrics'],
        queryFn: fetchChatGuardrailMetrics,
        enabled: showGuardrailPanel,
        staleTime: CHAT_GUARDRAIL_METRICS_STALE_MS,
        refetchInterval: showGuardrailPanel ? CHAT_GUARDRAIL_METRICS_REFRESH_MS : false,
        refetchIntervalInBackground: false,
        retry: 1,
    });
    const guardrailMetricsNormalized = useMemo(
        () => normalizeInsightChatGuardrailMetricsResponse(guardrailMetrics),
        [guardrailMetrics],
    );
    const guardrailSummary = useMemo(
        () => summarizeInsightChatGuardrailMetrics(guardrailMetricsNormalized),
        [guardrailMetricsNormalized],
    );
    const hasGuardrailMetricsData = Boolean(guardrailMetrics);
    const guardrailErrorMessage = guardrailMetricsError instanceof Error
        ? guardrailMetricsError.message
        : null;
    const guardrailUpdatedAtLabel = useMemo(() => {
        if (!hasGuardrailMetricsData) return null;
        const raw = guardrailMetricsNormalized.timestamp;
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) return null;
        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    }, [guardrailMetricsNormalized.timestamp, hasGuardrailMetricsData]);
    const guardrailDominantFallbackLabel = useMemo(() => {
        if (!guardrailSummary.dominantFallbackReason) return null;
        return getFallbackReasonLabel(guardrailSummary.dominantFallbackReason) ?? guardrailSummary.dominantFallbackReason;
    }, [guardrailSummary.dominantFallbackReason]);
    const hasGuardrailSignals = guardrailSummary.totalLatencyBudgetExceeded > 0
        || guardrailSummary.totalFallbackStreakAlerts > 0;

    const normalizedConversationQuery = conversationSearchQuery.trim().toLowerCase();
    const availableConversationTags = useMemo(() => {
        const tags = new Set<string>();
        for (const conversation of conversations) {
            for (const tag of normalizeConversationTags(conversation.tags)) {
                tags.add(tag);
            }
        }
        return [...tags].sort((a, b) => a.localeCompare(b));
    }, [conversations]);

    useEffect(() => {
        if (!conversationQuickFilter.startsWith('tag:')) return;
        const selectedTag = sanitizeConversationTag(conversationQuickFilter.slice(4));
        if (!selectedTag || !availableConversationTags.includes(selectedTag)) {
            setConversationQuickFilter(CONVERSATION_FILTER_ALL);
        }
    }, [availableConversationTags, conversationQuickFilter]);

    const conversationList = useMemo(
        () => [...conversations]
            .filter((conversation) => matchesInsightConversationFilter(conversation, normalizedConversationQuery, conversationQuickFilter))
            .sort((a, b) => {
                if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) {
                    return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
                }
                return b.updatedAt - a.updatedAt;
            }),
        [conversations, conversationQuickFilter, normalizedConversationQuery],
    );

    const visibleMessages = useMemo(() => {
        if (!activeConversation) return [];
        const total = activeConversation.messages.length;
        if (total <= 0) return [];

        const start = Math.max(0, total - Math.min(total, messageWindowSize));
        return activeConversation.messages.slice(start, total);
    }, [activeConversation, messageWindowSize]);
    const previousUserMessageById = useMemo(() => {
        const map = new Map<string, ChatMessage | null>();
        if (!activeConversation) return map;

        let previousUserMessage: ChatMessage | null = null;
        for (const message of activeConversation.messages) {
            map.set(message.id, previousUserMessage);
            if (message.role === 'user') {
                previousUserMessage = message;
            }
        }
        return map;
    }, [activeConversation]);

    const canShowMoreMessages = !!activeConversation && activeConversation.messages.length > messageWindowSize;
    const activeConversationMessageCount = activeConversation?.messages.length ?? 0;
    const contextWindowOptions = useMemo(() => {
        if (!activeConversationMessageCount) return CONTEXT_WINDOW_CHOICES;
        const unique = new Set(CONTEXT_WINDOW_CHOICES);
        unique.add(activeConversationMessageCount);
        const allValues = [...unique]
            .filter((value) => value > 0)
            .sort((a, b) => a - b);
        if (activeConversationMessageCount <= MESSAGE_WINDOW_INITIAL) {
            return allValues;
        }
        return allValues;
    }, [activeConversationMessageCount]);

    const activeContextWindow = activeConversation?.contextWindowSize ?? MESSAGE_WINDOW_INITIAL;
    const conversationContextWindowValue = activeConversation?.messages.length
        ? Math.min(activeContextWindow, activeConversation.messages.length)
        : activeContextWindow;

    const canRegenerateLastResponse = useMemo(() => {
        if (!activeConversation || !activeConversation.messages.length) {
            return false;
        }
        const last = activeConversation.messages[activeConversation.messages.length - 1];
        const prev = activeConversation.messages[activeConversation.messages.length - 2];
        return (
            !sendingConversationId &&
            last?.role === 'assistant' &&
            prev?.role === 'user' &&
            prev.content.trim()
        );
    }, [activeConversation, sendingConversationId]);

    const activeConversationResponseModeLabel = CHAT_RESPONSE_MODES.find((mode) => mode.value === activeConversationResponseMode)?.label
        ?? '빠른 응답';
    const activeConversationMemoryModeLabel = CHAT_MEMORY_MODES.find((mode) => mode.value === activeConversationMemoryMode)?.label
        ?? '기억 안함';
    const activeConversationMemoryProfileNote = activeConversation?.memoryProfileNote ?? '';

    const updateConversation = useCallback((conversationId: string, update: (prev: ChatConversation) => ChatConversation) => {
        setConversations((prev) => {
            let changed = false;
            const next = prev.map((item) => {
                if (item.id !== conversationId) return item;
                changed = true;
                return update(item);
            });
            return changed ? next : prev;
        });
    }, []);

    const setActiveConversationResponseMode = useCallback((nextMode: InsightChatResponseMode) => {
        if (!activeConversation) return;

        updateConversation(activeConversation.id, (prev) => ({
            ...prev,
            responseMode: normalizeResponseMode(nextMode),
            updatedAt: Date.now(),
        }));
        setShowResponseModeDropdown(false);
    }, [activeConversation, updateConversation]);

    const setActiveConversationMemoryMode = useCallback((nextMode: InsightChatMemoryMode) => {
        if (!activeConversation) return;

        updateConversation(activeConversation.id, (prev) => ({
            ...prev,
            memoryMode: normalizeMemoryMode(nextMode),
            updatedAt: Date.now(),
        }));
        setShowMemoryModeDropdown(false);
    }, [activeConversation, updateConversation]);

    const setActiveConversationMemoryProfileNote = useCallback((nextValue: string) => {
        if (!activeConversation) return;

        updateConversation(activeConversation.id, (prev) => ({
            ...prev,
            memoryProfileNote: sanitizeMemoryProfileNote(nextValue),
            updatedAt: Date.now(),
        }));
    }, [activeConversation, updateConversation]);

    useEffect(() => {
        if (!guardrailActionMessage) return;
        const timer = setTimeout(() => {
            setGuardrailActionMessage(null);
        }, 5000);
        return () => clearTimeout(timer);
    }, [guardrailActionMessage]);

    const handleRefreshGuardrailMetrics = useCallback(() => {
        if (!showGuardrailPanel) {
            setShowGuardrailPanel(true);
        }
        setGuardrailActionMessage(null);
        void refetchGuardrailMetrics();
    }, [refetchGuardrailMetrics, showGuardrailPanel]);

    const handleResetGuardrailMetrics = useCallback(async () => {
        if (isResettingGuardrailMetrics) return;
        setIsResettingGuardrailMetrics(true);
        setGuardrailActionMessage(null);

        try {
            const payload = await postResetChatGuardrailMetrics();
            setGuardrailActionMessage(payload.message);
            await refetchGuardrailMetrics();
        } catch (error) {
            const message = error instanceof Error ? error.message : '가드레일 지표 초기화에 실패했습니다.';
            setGuardrailActionMessage(message);
        } finally {
            setIsResettingGuardrailMetrics(false);
        }
    }, [isResettingGuardrailMetrics, refetchGuardrailMetrics]);

    const feedbackForMessage = useCallback((messageId: string) => messageFeedbacks[messageId], [messageFeedbacks]);
    const handleFeedback = useCallback((messageId: string, rating: InsightChatFeedbackRating | null, reason = '') => {
        setMessageFeedbacks((prev) => {
            const next = { ...prev };
            if (!rating) {
                delete next[messageId];
                return next;
            }

            const nextReason = rating ? reason.trim().slice(0, 280) : '';
            return {
                ...next,
                [messageId]: {
                    ...(next[messageId] ?? {}),
                    rating,
                    reason: nextReason || undefined,
                },
            };
        });
    }, []);

    const getFeedbackContextForMessage = useCallback((messageId: string): InsightChatFeedbackContext | undefined => {
        const feedback = messageFeedbacks[messageId];
        if (!feedback?.rating) return undefined;
        return {
            targetAssistantMessageId: messageId,
            rating: feedback.rating,
            ...(feedback.reason ? { reason: feedback.reason } : {}),
        };
    }, [messageFeedbacks]);

    const latestEditableUserMessageId = useMemo(() => {
        if (!activeConversation || !activeConversation.messages.length) {
            return null;
        }

        const messages = activeConversation.messages;
        const latestUserIndex = (() => {
            for (let index = messages.length - 1; index >= 0; index -= 1) {
                if (messages[index].role === 'user') return index;
            }
            return -1;
        })();

        if (latestUserIndex < 0 || latestUserIndex === messages.length - 1) {
            return null;
        }

        const candidate = messages[latestUserIndex];
        if (!candidate?.content.trim()) {
            return null;
        }

        return candidate.id;
    }, [activeConversation]);

    const promptLibraryGroups = useMemo(() => {
        const groupedLibrary = INSIGHT_PROMPT_LIBRARY.map((group) => ({
            ...group,
            prompts: [...group.prompts],
        }));

        const latestUserMessage = [...activeConversation?.messages ?? []]
            .reverse()
            .find((message) => message.role === 'user')?.content
            ?? '';
        const normalizedLatestMessage = latestUserMessage.trim().toLowerCase();

        if (!normalizedLatestMessage) {
            return groupedLibrary;
        }

        const isSalesTopic = normalizedLatestMessage.includes('매출') || normalizedLatestMessage.includes('매입') || normalizedLatestMessage.includes('수익');
        const isCampaignTopic = normalizedLatestMessage.includes('캠페인') || normalizedLatestMessage.includes('광고');

        if (!isSalesTopic && !isCampaignTopic) {
            return groupedLibrary;
        }

        const contextGroups: InsightPromptCommandGroup[] = CONTEXT_PROMPT_LIBRARY.map((group) => {
            const matchedPrompts = isSalesTopic && group.id === 'context-sales'
                ? group.prompts
                : isCampaignTopic && group.id === 'context-campaign'
                    ? group.prompts
                    : [];

            return {
                ...group,
                prompts: matchedPrompts,
            };
        }).filter((group) => group.prompts.length > 0);

        return groupedLibrary.map((group) => ({ ...group }))
            .concat(contextGroups.map((group) => ({ ...group })));
    }, [activeConversation]);
    const followUpPromptsByMessageId = useMemo(() => {
        const map = new Map<string, InsightChatFollowUpPrompt[]>();
        if (!visibleMessages.length) return map;

        for (const message of visibleMessages) {
            if (message.role !== 'assistant') continue;
            const previousUserMessage = previousUserMessageById.get(message.id) ?? null;
            map.set(
                message.id,
                deriveFollowUpPromptSuggestions(
                    message.followUpPrompts,
                    previousUserMessage?.content ?? '',
                    promptLibraryGroups,
                ),
            );
        }

        return map;
    }, [visibleMessages, previousUserMessageById, promptLibraryGroups]);

    const isCommandMode = useMemo(() => {
        const trimmed = inputValue.trimStart();
        return trimmed.startsWith('/');
    }, [inputValue]);

    const commandInput = useMemo(() => splitPromptInput(inputValue), [inputValue]);
    const commandPaletteQuery = commandInput?.command ?? '';
    const normalizedCommandPaletteQuery = commandPaletteQuery.replace(/^\//, '').trim();

    const filteredPromptPaletteGroups = useMemo<InsightPromptCommandGroup[]>(
        () => filterPromptCommandGroups(promptLibraryGroups, normalizedCommandPaletteQuery),
        [promptLibraryGroups, normalizedCommandPaletteQuery],
    );

    const activePromptGroups = useMemo(
        () => (isCommandMode ? filteredPromptPaletteGroups : promptLibraryGroups),
        [filteredPromptPaletteGroups, isCommandMode, promptLibraryGroups],
    );

    const commandSuggestions = useMemo(() => {
        if (!isCommandMode) return [];

        const flattened = flattenPromptCommands(filteredPromptPaletteGroups);
        return flattened.map((prompt) => {
            const group = filteredPromptPaletteGroups.find((group: InsightPromptCommandGroup) =>
                group.prompts.some((entry: InsightPromptCommand) => entry.id === prompt.id),
            );
            return {
                groupId: group?.id ?? prompt.groupId,
                groupTitle: group?.title ?? '',
                prompt,
                id: `${group?.id ?? prompt.groupId}-${prompt.id}`,
            };
        });
    }, [filteredPromptPaletteGroups, isCommandMode]);

    const hasPromptSuggestions = isCommandMode && commandSuggestions.length > 0;
    const totalQuickPromptCount = useMemo(
        () => (isCommandMode ? 0 : activePromptGroups.reduce((acc, group) => acc + group.prompts.length, 0)),
        [activePromptGroups, isCommandMode],
    );

    const compactQuickPrompts = useMemo(() => {
        if (isCommandMode) return [];
        return flattenPromptCommands(activePromptGroups);
    }, [activePromptGroups, isCommandMode]);

    useEffect(() => {
        if (!hasPromptSuggestions) {
            setActiveCommandIndex(0);
            return;
        }

        setActiveCommandIndex((index) => (index >= commandSuggestions.length ? 0 : index));
    }, [commandSuggestions, hasPromptSuggestions]);

    latestPersistConversationsRef.current = conversations;
    latestPersistActiveConversationIdRef.current = activeConversationId;

    const persistConversationStateNow = useCallback(() => {
        if (typeof window === 'undefined') return;
        const latestConversations = latestPersistConversationsRef.current;
        if (latestConversations.length === 0) {
            try {
                localStorage.removeItem(CHAT_STORAGE_KEY);
            } catch {
                // localStorage unavailable
            }
            return;
        }

        try {
            const payload = serializeConversationList(
                latestConversations,
                latestPersistActiveConversationIdRef.current,
            );
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // localStorage unavailable or full
        }
    }, []);
    const flushPersistConversationState = useCallback(() => {
        if (persistDebounceTimerRef.current) {
            clearTimeout(persistDebounceTimerRef.current);
            persistDebounceTimerRef.current = null;
        }
        persistConversationStateNow();
    }, [persistConversationStateNow]);
    const schedulePersistConversationState = useCallback(() => {
        if (persistDebounceTimerRef.current) {
            clearTimeout(persistDebounceTimerRef.current);
        }
        persistDebounceTimerRef.current = setTimeout(() => {
            persistDebounceTimerRef.current = null;
            persistConversationStateNow();
        }, CHAT_PERSIST_DEBOUNCE_MS);
    }, [persistConversationStateNow]);

    const loadBootstrap = useCallback(async (conversationId: string): Promise<void> => {
        const requestId = (bootstrapRequestRef.current.get(conversationId) ?? 0) + 1;
        bootstrapRequestRef.current.set(conversationId, requestId);

        updateConversation(conversationId, (prev) => ({
            ...prev,
            isBooting: true,
            bootstrapFailed: false,
        }));

        try {
            const bootstrap = await fetchChatBootstrap(conversationId);

            setConversations((prev) => {
                if ((bootstrapRequestRef.current.get(conversationId) ?? 0) !== requestId) {
                    return prev;
                }

                return prev.map((conversation) => {
                    if (conversation.id !== conversationId) return conversation;
                    return {
                        ...conversation,
                        messages: [
                            {
                                id: makeId('bootstrap'),
                                role: 'assistant',
                                content: bootstrap.message.content,
                                visualComponent: bootstrap.message.visualComponent,
                                sources: mapSources(bootstrap.message.sources),
                                createdAt: new Date(),
                            },
                        ],
                        isBooting: false,
                        bootstrapFailed: false,
                        updatedAt: Date.now(),
                    };
                });
            });
        } catch {
            setConversations((prev) => {
                if ((bootstrapRequestRef.current.get(conversationId) ?? 0) !== requestId) {
                    return prev;
                }

                return prev.map((conversation) => {
                    if (conversation.id !== conversationId) return conversation;
                    return {
                        ...conversation,
                        messages: [
                            {
                                id: makeId('bootstrap'),
                                role: 'assistant',
                                content: '초기 인사이트를 불러오지 못했습니다. 다시 열람하려면 새로고침해 주세요.',
                                createdAt: new Date(),
                                meta: {
                                    source: 'fallback',
                                    fallbackReason: 'bootstrap_failed',
                                },
                            },
                        ],
                        isBooting: false,
                        bootstrapFailed: true,
                        updatedAt: Date.now(),
                    };
                });
            });
        }
    }, [updateConversation]);

    const createConversation = useCallback((title: string = EMPTY_TITLE) => {
        const nextConversation: ChatConversation = {
            ...createInitialConversation(makeConversationId()),
            title,
            isBooting: true,
        };

        setConversations((prev) => [nextConversation, ...prev].slice(0, MAX_CONVERSATIONS));
        setActiveConversationId(nextConversation.id);

        void loadBootstrap(nextConversation.id);
    }, [loadBootstrap]);

    const hydrateFromStorage = useCallback(() => {
        if (typeof window === 'undefined') return null;

        try {
            const raw = localStorage.getItem(CHAT_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as PersistedChatState;
            return deserializeConversationList(parsed);
        } catch {
            return null;
        }
    }, []);

    const appendMessage = useCallback((conversationId: string, message: ChatMessage) => {
        updateConversation(conversationId, (prev) => {
            const isTitleDefault = prev.title === EMPTY_TITLE && message.role === 'user';
            const nextMessages = [...prev.messages, message];
            const trimmedMessages = nextMessages.length > MAX_MESSAGES_PER_CONVERSATION
                ? nextMessages.slice(-MAX_MESSAGES_PER_CONVERSATION)
                : nextMessages;

            return {
                ...prev,
                messages: trimmedMessages,
                title: isTitleDefault ? makeConversationTitle(message.content) : prev.title,
                updatedAt: Date.now(),
            };
        });
    }, [updateConversation]);

    const updateMessage = useCallback((conversationId: string, messageId: string, updater: (prev: ChatMessage) => ChatMessage) => {
        updateConversation(conversationId, (prev) => ({
            ...prev,
            messages: prev.messages.map((message) =>
                message.id === messageId
                    ? updater(message)
                    : message,
            ),
            updatedAt: Date.now(),
        }));
    }, [updateConversation]);

    const updateMessageContent = useCallback((conversationId: string, messageId: string, updater: (prev: string) => string) => {
        updateMessage(conversationId, messageId, (message) => ({
            ...message,
            content: updater(message.content),
        }));
    }, [updateMessage]);

    useEffect(() => {
        const restored = hydrateFromStorage();
        if (restored) {
            setConversations(restored.conversations);
            setActiveConversationId(restored.activeConversationId);

            const activeConversation = restored.conversations.find((conversation) => conversation.id === restored.activeConversationId) ?? restored.conversations[0];
            if (!activeConversation || activeConversation.messages.length === 0) {
                void loadBootstrap(activeConversation.id);
            }

            return;
        }
        void loadBootstrap(initialConversationId);
    }, [hydrateFromStorage, initialConversationId, loadBootstrap]);

    useEffect(() => {
        if (!activeConversation) {
            return;
        }

        const desiredWindow = activeConversation.contextWindowSize ?? MESSAGE_WINDOW_INITIAL;
        const boundedWindow = Math.min(
            Math.max(1, desiredWindow),
            activeConversation.messages.length || Math.max(desiredWindow, MESSAGE_WINDOW_INITIAL),
        );
        setMessageWindowSize(boundedWindow);
    }, [activeConversation]);

    useEffect(() => {
        if (!editingMessageId) return;
        if (!activeConversation?.messages.some((message) => message.id === editingMessageId)) {
            setEditingMessageId(null);
        }
    }, [activeConversation, editingMessageId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeConversation?.messages.length, activeConversationId]);

    useEffect(() => {
        schedulePersistConversationState();
    }, [activeConversationId, conversations, schedulePersistConversationState]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handlePageHide = () => {
            flushPersistConversationState();
        };
        window.addEventListener('pagehide', handlePageHide);
        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            flushPersistConversationState();
        };
    }, [flushPersistConversationState]);

    useEffect(() => () => {
        streamAbortControllerRef.current?.abort();
        streamAbortControllerRef.current = null;
        if (deleteUndoTimerRef.current) {
            clearTimeout(deleteUndoTimerRef.current);
            deleteUndoTimerRef.current = null;
        }
    }, []);

    const handleClearDeleteUndo = useCallback(() => {
        if (deleteUndoTimerRef.current) {
            clearTimeout(deleteUndoTimerRef.current);
            deleteUndoTimerRef.current = null;
        }
        setPendingDeletedConversation(null);
        deleteUndoTokenRef.current += 1;
    }, []);

    const handleScheduleDeleteUndoClear = useCallback((token: number) => {
        if (deleteUndoTimerRef.current) {
            clearTimeout(deleteUndoTimerRef.current);
        }
        deleteUndoTimerRef.current = setTimeout(() => {
            if (deleteUndoTokenRef.current !== token) return;
            setPendingDeletedConversation(null);
            deleteUndoTimerRef.current = null;
        }, CHAT_DELETE_UNDO_TIMEOUT_MS);
    }, []);

    const handleSelectConversation = useCallback((conversationId: string) => {
        setActiveConversationId(conversationId);
        if (!window.matchMedia('(min-width: 1024px)').matches) {
            setShowConversationList(false);
        }
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, []);

    const handleDeleteConversation = useCallback((conversationId: string) => {
        if (!window.confirm(CHAT_DELETE_CONFIRM_LABEL)) {
            return;
        }

        const deleteResult = deleteConversationFromList(conversations, activeConversationId, conversationId);
        if (!deleteResult.deleted) {
            return;
        }

        handleClearDeleteUndo();

        setConversations(deleteResult.conversations);
        if (deleteResult.activeConversationId) {
            setActiveConversationId(deleteResult.activeConversationId);
        } else {
            createConversation();
        }

        setPendingDeletedConversation(deleteResult.deleted);
        const token = deleteUndoTokenRef.current + 1;
        deleteUndoTokenRef.current = token;
        handleScheduleDeleteUndoClear(token);
    }, [activeConversationId, conversations, createConversation, handleClearDeleteUndo, handleScheduleDeleteUndoClear]);

    const handleUndoDeleteConversation = useCallback(() => {
        if (!pendingDeletedConversation) return;

        const restoreResult = restoreConversationFromList(
            conversations,
            activeConversationId,
            pendingDeletedConversation,
        );

        handleClearDeleteUndo();
        setConversations(restoreResult.conversations);
        setActiveConversationId(restoreResult.activeConversationId);
    }, [activeConversationId, conversations, handleClearDeleteUndo, pendingDeletedConversation]);

    const handleNewConversation = useCallback(() => {
        createConversation();
        if (!window.matchMedia('(min-width: 1024px)').matches) {
            setShowConversationList(false);
        }
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [createConversation]);

    const handleRetryBootstrap = useCallback(() => {
        if (!activeConversation) return;
        void loadBootstrap(activeConversation.id);
    }, [activeConversation, loadBootstrap]);

    const handleLoadMoreMessages = useCallback(() => {
        if (!activeConversation) return;

        setMessageWindowSize((prev) => Math.min(
            activeConversation.messages.length,
            prev + MESSAGE_WINDOW_BATCH,
        ));
    }, [activeConversation]);

    const handleSetMessageWindow = useCallback((nextWindowSize: number) => {
        if (!activeConversation) return;

        const bounded = Math.max(1, Math.min(nextWindowSize, activeConversation.messages.length || MESSAGE_WINDOW_INITIAL));
        setMessageWindowSize(bounded);
        updateConversation(activeConversation.id, (prev) => ({
            ...prev,
            contextWindowSize: bounded,
            updatedAt: Date.now(),
        }));
    }, [activeConversation, updateConversation]);

    const handleTogglePinnedConversation = useCallback((conversationId: string) => {
        updateConversation(conversationId, (prev) => ({
            ...prev,
            pinned: !prev.pinned,
            updatedAt: Date.now(),
        }));
    }, [updateConversation]);

    const handleDuplicateConversation = useCallback((conversationId: string) => {
        const target = conversations.find((conversation) => conversation.id === conversationId);
        if (!target) return;

        const duplicated = duplicateConversationForSidebar(target, conversations);
        setConversations((prev) => [duplicated, ...prev].slice(0, MAX_CONVERSATIONS));
        setActiveConversationId(duplicated.id);
    }, [conversations]);

    const handleAddConversationTag = useCallback(() => {
        if (!activeConversation) return;
        const normalizedTag = sanitizeConversationTag(activeConversationTagInput);
        if (!normalizedTag) return;

        updateConversation(activeConversation.id, (prev) => ({
            ...prev,
            tags: normalizeConversationTags([...normalizeConversationTags(prev.tags), normalizedTag]),
            updatedAt: Date.now(),
        }));
        setActiveConversationTagInput('');
    }, [activeConversation, activeConversationTagInput, updateConversation]);

    const handleRemoveConversationTag = useCallback((tag: string) => {
        if (!activeConversation) return;
        const normalizedTag = sanitizeConversationTag(tag);
        if (!normalizedTag) return;

        updateConversation(activeConversation.id, (prev) => ({
            ...prev,
            tags: normalizeConversationTags(prev.tags).filter((item) => item !== normalizedTag),
            updatedAt: Date.now(),
        }));
    }, [activeConversation, updateConversation]);

    const handleRenameConversation = useCallback((conversationId: string) => {
        const target = conversations.find((conversation) => conversation.id === conversationId);
        if (!target) return;

        const nextTitle = window.prompt('대화 제목을 입력해 주세요.', target.title === EMPTY_TITLE ? '' : target.title);
        if (!nextTitle) return;

        const normalizedTitle = nextTitle.trim();
        if (!normalizedTitle) return;

        updateConversation(conversationId, (prev) => ({
            ...prev,
            title: normalizedTitle,
            updatedAt: Date.now(),
        }));
    }, [conversations, updateConversation]);

    const handleExportConversation = useCallback((conversationId: string) => {
        const conversation = conversations.find((item) => item.id === conversationId);
        if (!conversation) return;

        const exportData = {
            exportedAt: new Date().toISOString(),
            conversation,
            schemaVersion: CHAT_STORAGE_SCHEMA_VERSION,
        };
        const fileName = buildExportFileName(`insight-chat-${conversation.title}-${conversation.id}`);
        triggerJsonDownload(JSON.stringify(exportData, null, 2), fileName);
    }, [conversations]);

    const handleExportAllConversations = useCallback(() => {
        const payload = buildConversationBackupExportPayload(conversations, activeConversationId);
        if (!payload) return;

        const fileName = buildExportFileName('insight-chat-backup-all');
        triggerJsonDownload(JSON.stringify(payload, null, 2), fileName);
    }, [activeConversationId, conversations]);

    const handleOpenConversationImportPicker = useCallback(() => {
        if (!!activeConversation?.isBooting || !!sendingConversationId) return;
        conversationImportInputRef.current?.click();
    }, [activeConversation?.isBooting, sendingConversationId]);

    const handleConversationImportFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const resetInput = () => {
            event.target.value = '';
        };
        const file = event.target.files?.[0];
        if (!file) {
            resetInput();
            return;
        }

        try {
            const rawText = await file.text();
            const rawPayload = JSON.parse(rawText) as unknown;
            const parsed = parseConversationImportPayload(rawPayload);
            if (!parsed) {
                window.alert('가져오기 파일 형식이 올바르지 않습니다.');
                return;
            }
            if (parsed.conversations.length === 0) {
                window.alert('가져올 대화가 없습니다.');
                return;
            }

            const mergedConversations = mergeImportedConversations(conversations, parsed.conversations);
            if (mergedConversations.length === 0) {
                window.alert('대화를 가져오지 못했습니다.');
                return;
            }

            const parsedActiveIndex = parsed.conversations.findIndex(
                (conversation) => conversation.id === parsed.activeConversationId,
            );
            const preferredActiveIndex = parsedActiveIndex >= 0 ? parsedActiveIndex : 0;
            const nextActiveConversationId = mergedConversations[preferredActiveIndex]?.id
                ?? mergedConversations[0]?.id
                ?? activeConversationId;

            setConversations(mergedConversations);
            setActiveConversationId(nextActiveConversationId);
            setInputValue('');
            setEditingMessageId(null);
            setDraftAttachments([]);
            setConversationSearchQuery('');
            setConversationQuickFilter(CONVERSATION_FILTER_ALL);

            window.alert(`대화 ${parsed.conversations.length}개를 가져왔습니다.`);
        } catch (error) {
            console.error('[admin/insight/chat] conversation import failed', error);
            window.alert('대화 파일을 읽지 못했습니다. JSON 파일인지 확인해 주세요.');
        } finally {
            resetInput();
        }
    }, [activeConversationId, conversations]);

    const handleOpenAttachmentPicker = useCallback(() => {
        if (!!activeConversation?.isBooting || !!sendingConversationId) return;
        attachmentInputRef.current?.click();
    }, [activeConversation?.isBooting, sendingConversationId]);

    const handleRemoveAttachment = useCallback((attachmentId: string) => {
        setDraftAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
    }, []);

    const handleAttachmentFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const { files } = event.target;
        if (!files || files.length === 0) return;

        const existingCount = draftAttachments.length;
        const remaining = Math.max(0, MAX_CHAT_ATTACHMENTS - existingCount);
        if (remaining <= 0) {
            window.alert(`첨부 파일은 최대 ${MAX_CHAT_ATTACHMENTS}개까지 업로드할 수 있습니다.`);
            event.target.value = '';
            return;
        }

        const selectedFiles = [...files].slice(0, remaining);
        const nextAttachments: DraftChatAttachment[] = [];
        for (const file of selectedFiles) {
            const normalizedName = sanitizeAttachmentName(file.name);
            if (!/\.(txt|csv)$/i.test(normalizedName)) {
                continue;
            }

            const mimeType = (file.type || '').toLowerCase();
            if (mimeType && !mimeType.startsWith('text/') && mimeType !== 'application/csv' && mimeType !== 'application/vnd.ms-excel') {
                continue;
            }

            if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
                continue;
            }

            const content = sanitizeAttachmentContent(await file.text());
            if (!content.trim()) {
                continue;
            }

            nextAttachments.push({
                id: makeId('attachment'),
                name: normalizedName,
                mimeType: mimeType || 'text/plain',
                content,
                sizeBytes: Math.min(MAX_CHAT_ATTACHMENT_BYTES, file.size || content.length),
            });
        }

        if (nextAttachments.length === 0) {
            window.alert('txt/csv 형식의 텍스트 파일만 첨부할 수 있습니다.');
            event.target.value = '';
            return;
        }

        setDraftAttachments((prev) => [...prev, ...nextAttachments].slice(0, MAX_CHAT_ATTACHMENTS));
        event.target.value = '';
    }, [draftAttachments.length]);

    const sendMessage = useCallback(async (
        input: string,
        options?: {
            replaceUserMessageId?: string;
            feedbackContext?: InsightChatFeedbackContext;
            attachments?: InsightChatAttachmentInput[];
        },
    ) => {
        const resolvedInput = resolvePromptInputWithGovernance(input);
        const content = resolvedInput.content;
        const contentForDisplay = resolvedInput.migrationHint
            ? `${content}\n\n${resolvedInput.migrationHint}`
            : content;
        if (!activeConversation || !content || sendingConversationId) return;
        const requestId = makeRequestId();
        const convId = activeConversation.id;
        const responseMode = activeConversationResponseMode;
        const memoryMode = activeConversationMemoryMode;
        const memoryProfileNote = activeConversationMemoryProfileNote;
        const feedbackContext = normalizeFeedbackInput(options?.feedbackContext);
        const attachments = normalizeAttachmentPayload(options?.attachments);
        const replaceUserMessageId = options?.replaceUserMessageId;
        const replaceIndex = replaceUserMessageId
            ? activeConversation.messages.findIndex((message) => message.id === replaceUserMessageId && message.role === 'user')
            : -1;
        const isReplacingMessage = !!replaceUserMessageId;
        if (isReplacingMessage) {
            setEditingMessageId(null);
        }

        if (replaceIndex >= 0) {
            updateConversation(convId, (prev) => {
                const latestIndex = prev.messages.findIndex((message) => message.id === replaceUserMessageId && message.role === 'user');
                if (latestIndex < 0) return prev;

                const userMeta = prev.messages[latestIndex];
                const nextMessages = [...prev.messages.slice(0, latestIndex + 1)];
                nextMessages[latestIndex] = {
                    ...userMeta,
                    content: contentForDisplay,
                    createdAt: new Date(),
                };

                return {
                    ...prev,
                    messages: nextMessages,
                    title: prev.title === EMPTY_TITLE && latestIndex === 0
                        ? makeConversationTitle(contentForDisplay)
                        : prev.title,
                    updatedAt: Date.now(),
                };
            });
        } else {
            appendMessage(convId, {
                id: makeId('user'),
                role: 'user',
                content: contentForDisplay,
                createdAt: new Date(),
            });
        }

        setInputValue('');
        setDraftAttachments([]);
        setSendingConversationId(convId);

        let assistantMessageId: string | null = null;
        let assistantProfile: AdminInsightChatResponse['meta'] | null = null;
        let streamController: AbortController | null = null;

        try {
            const contextMessages = buildInsightChatContextMessages(
                activeConversation.messages,
                memoryMode,
                feedbackContext?.targetAssistantMessageId,
            );

            if (currentLlmConfig) {
                streamController = new AbortController();
                streamAbortControllerRef.current = streamController;
                const assistantId = makeId('assistant');
                assistantMessageId = assistantId;
                assistantProfile = {
                    source: currentLlmConfig.provider as 'gemini' | 'openai' | 'anthropic',
                    model: currentLlmConfig.model,
                    responseMode,
                    memoryMode,
                    confidence: RESPONSE_MODE_CONFIDENCE_SCORE[responseMode],
                    toolTrace: [`responseMode:${responseMode}`, `provider:${currentLlmConfig.provider}`, 'flow:stream'],
                };
                appendMessage(convId, {
                    id: assistantId,
                    role: 'assistant',
                    content: '',
                    createdAt: new Date(),
                    meta: assistantProfile,
                });

                const localResponse = await postStreamChat(
                    content,
                    requestId,
                    currentLlmConfig,
                    (token) => updateMessageContent(convId, assistantId, (prev) => prev + token),
                    streamController.signal,
                    responseMode,
                    memoryMode,
                    feedbackContext,
                    attachments,
                    contextMessages,
                    memoryProfileNote,
                );

                if (localResponse) {
                    if (localResponse.meta?.fallbackReason === 'request_cancelled') {
                        updateMessage(convId, assistantId, (message) => ({
                            ...message,
                            content: `${message.content}\n\n${STREAM_STOP_MESSAGE}`,
                            meta: message.meta
                                ?? assistantProfile
                                ?? localResponse.meta
                                ?? {
                                    source: currentLlmConfig.provider as 'gemini' | 'openai' | 'anthropic',
                                    model: currentLlmConfig.model,
                                    responseMode,
                                },
                        }));
                        return;
                    }

                        updateMessage(convId, assistantId, (message) => ({
                            ...message,
                            content: localResponse.content,
                            sources: mapSources(localResponse.sources),
                            visualComponent: localResponse.visualComponent,
                            followUpPrompts: normalizeFollowUpPrompts(localResponse.followUpPrompts),
                            meta: {
                                ...assistantProfile,
                                ...(localResponse.meta ?? {}),
                            } as AdminInsightChatMeta,
                        }));
                    }
            } else {
                const resolvedImageModelProfile = imageModelProfile === 'none' ? undefined : imageModelProfile;
                const response = await postChatMessage(
                    content,
                    requestId,
                    convId,
                    undefined,
                    resolvedImageModelProfile,
                    responseMode,
                    memoryMode,
                    feedbackContext,
                    attachments,
                    contextMessages,
                    memoryProfileNote,
                );
                appendMessage(convId, {
                    id: makeId('assistant'),
                    role: 'assistant',
                    content: response.content,
                    sources: mapSources(response.sources),
                    visualComponent: response.visualComponent,
                    followUpPrompts: normalizeFollowUpPrompts(response.followUpPrompts),
                    createdAt: new Date(),
                    meta: response.meta,
                });
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError' && assistantMessageId) {
                const stopSuffix = STREAM_STOP_MESSAGE;
                updateMessage(convId, assistantMessageId, (message) => ({
                    ...message,
                    content: message.content && !message.content.includes(stopSuffix)
                        ? `${message.content}\n\n${stopSuffix}`
                        : message.content || stopSuffix,
                    meta: message.meta ?? assistantProfile ?? { source: 'fallback', fallbackReason: 'request_cancelled' },
                }));
                return;
            }

            const fallbackMessage = '응답을 전송하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
            if (assistantMessageId) {
                updateMessage(convId, assistantMessageId, (message) => ({
                    ...message,
                    content: message.content || fallbackMessage,
                    meta: message.meta ?? assistantProfile ?? { source: 'fallback', fallbackReason: 'request_failed' },
                }));
                return;
            }

            appendMessage(convId, {
                id: makeId('assistant'),
                role: 'assistant',
                content: fallbackMessage,
                createdAt: new Date(),
                meta: {
                    source: 'fallback',
                    fallbackReason: 'request_failed',
                },
            });
        } finally {
            if (streamAbortControllerRef.current === streamController) {
                streamAbortControllerRef.current = null;
            }
            setSendingConversationId(null);
            inputRef.current?.focus();
        }
    }, [
        activeConversation,
        appendMessage,
        updateConversation,
        updateMessage,
        updateMessageContent,
        activeConversationResponseMode,
        activeConversationMemoryMode,
        activeConversationMemoryProfileNote,
        sendingConversationId,
        currentLlmConfig,
        imageModelProfile,
    ]);

    const handleStopStreaming = useCallback(() => {
        if (!sendingConversationId) return;
        streamAbortControllerRef.current?.abort();
        streamAbortControllerRef.current = null;
    }, [sendingConversationId]);

    const handleRegenerateAssistantMessage = useCallback((assistantMessageId: string) => {
        if (!activeConversation || !activeConversation.messages.length || sendingConversationId) return;

        const assistantIndex = activeConversation.messages.findIndex((message) => message.id === assistantMessageId && message.role === 'assistant');
        if (assistantIndex <= 0) return;

        const previousUserMessage = (() => {
            for (let index = assistantIndex - 1; index >= 0; index -= 1) {
                if (activeConversation.messages[index].role === 'user') {
                    return activeConversation.messages[index];
                }
            }
            return null;
        })();

                if (!previousUserMessage?.content.trim()) return;
        void sendMessage(previousUserMessage.content, {
            replaceUserMessageId: previousUserMessage.id,
            feedbackContext: getFeedbackContextForMessage(assistantMessageId),
        });
    }, [activeConversation, getFeedbackContextForMessage, sendMessage, sendingConversationId]);

    const handleRegenerateLastResponse = useCallback(() => {
        if (!activeConversation || !canRegenerateLastResponse) return;
        const messages = activeConversation.messages;
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || lastMessage.role !== 'assistant') return;

        handleRegenerateAssistantMessage(lastMessage.id);
    }, [activeConversation, canRegenerateLastResponse, handleRegenerateAssistantMessage]);

    const handleEditMessage = useCallback((message: ChatMessage) => {
        if (!activeConversation || message.role !== 'user') return;
        if (sendingConversationId) return;
        if (message.id !== latestEditableUserMessageId) return;
        setEditingMessageId(message.id);
        setInputValue(message.content);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [activeConversation, latestEditableUserMessageId, sendingConversationId]);

    const handleSendMessage = useCallback(() => {
        if (!inputValue.trim()) {
            return;
        }
        const replaceUserMessageId = editingMessageId;
        if (replaceUserMessageId) {
            void sendMessage(inputValue, { replaceUserMessageId, attachments: draftAttachments });
            return;
        }
        void sendMessage(inputValue, { attachments: draftAttachments });
    }, [draftAttachments, editingMessageId, inputValue, sendMessage]);

    const resolvePromptFromTemplate = useCallback((prompt: InsightPromptCommand) => {
        return buildResolvedPromptValue(inputValue, prompt);
    }, [inputValue]);

    const handlePromptTemplateApply = useCallback((prompt: InsightPromptCommand, options?: { autoSend?: boolean }) => {
        const resolvedPrompt = resolvePromptFromTemplate(prompt);
        if (options?.autoSend) {
            void sendMessage(resolvedPrompt);
            return;
        }
        setInputValue(resolvedPrompt);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [resolvePromptFromTemplate, sendMessage]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' && hasPromptSuggestions) {
            event.preventDefault();
            setActiveCommandIndex((index) => (index + 1) % commandSuggestions.length);
            return;
        }

        if (event.key === 'ArrowUp' && hasPromptSuggestions) {
            event.preventDefault();
            setActiveCommandIndex((index) => (index - 1 + commandSuggestions.length) % commandSuggestions.length);
            return;
        }

        if (event.key === 'Tab' && hasPromptSuggestions) {
            const activeSuggestion = commandSuggestions[activeCommandIndex];
            if (!activeSuggestion) return;
            event.preventDefault();
            handlePromptTemplateApply(activeSuggestion.prompt);
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (isCommandMode) {
                const activeSuggestion = commandSuggestions[activeCommandIndex];
                if (activeSuggestion) {
                    handlePromptTemplateApply(activeSuggestion.prompt, { autoSend: true });
                    return;
                }
            }
            void handleSendMessage();
        }
    }, [
        activeCommandIndex,
        commandSuggestions,
        hasPromptSuggestions,
        handlePromptTemplateApply,
        handleSendMessage,
        isCommandMode,
    ]);

    const isSending = sendingConversationId === activeConversationId;
    const isStreamingInFlight = sendingConversationId !== null;
    const canStopStreaming = isStreamingInFlight && !!streamAbortControllerRef.current;
    const handleFollowUpPromptSelect = useCallback((prompt: string) => {
        const normalizedPrompt = sanitizeFollowUpPromptText(prompt);
        if (!normalizedPrompt || isStreamingInFlight) {
            return;
        }
        void sendMessage(normalizedPrompt);
    }, [isStreamingInFlight, sendMessage]);

    return (
        <section className="h-full min-h-0 min-w-0 flex overflow-hidden bg-white border border-[#e5e7eb] relative">
            {showConversationList ? (
                <button
                    type="button"
                    className="fixed inset-0 z-20 bg-black/20 lg:hidden"
                    onClick={() => setShowConversationList(false)}
                    aria-label="대화 목록 닫기"
                />
            ) : null}
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-30 w-[82vw] max-w-[320px] min-w-[150px] border-r border-[#e5e7eb] bg-[#fafafa] flex flex-col min-h-0',
                    'transform transition-transform duration-200',
                    showConversationList ? 'translate-x-0' : '-translate-x-full',
                    'lg:relative lg:inset-auto lg:z-auto lg:w-[clamp(150px,36vw,292px)] lg:translate-x-0',
                )}
            >
                <div className="p-3 border-b border-[#e5e7eb]">
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            className="mt-2 h-9 flex-1 bg-[#111827] text-white hover:bg-[#27272a]"
                            onClick={handleNewConversation}
                        >
                            <PlusCircle className="h-4 w-4 mr-1.5" />
                            새로운 대화
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 h-9 w-9 p-0 border-[#e5e7eb]"
                            onClick={handleOpenConversationImportPicker}
                            disabled={!!sendingConversationId || !!activeConversation?.isBooting}
                            title="대화 가져오기"
                        >
                            <Upload className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 h-9 w-9 p-0 border-[#e5e7eb]"
                            onClick={handleExportAllConversations}
                            disabled={conversations.length === 0 || !!sendingConversationId || !!activeConversation?.isBooting}
                            title="전체 대화 백업 내보내기"
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('mt-2 h-9 w-9 p-0 border-[#e5e7eb]', showSettings && 'bg-[#f3f4f6]')}
                            onClick={() => setShowSettings((prev) => !prev)}
                            title="LLM 설정"
                        >
                            <Settings className="h-4 w-4" />
                        </Button>
                    </div>
                    <input
                        ref={conversationImportInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={(event) => {
                            void handleConversationImportFileChange(event);
                        }}
                        className="hidden"
                    />
                </div>

                {showSettings ? (
                    <div className="flex-1 h-0 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
                        <p className="text-xs font-semibold text-[#374151] uppercase tracking-wider">API 키 설정</p>
                        {(['gemini', 'openai', 'anthropic'] as LlmProvider[]).map((provider) => {
                            const isVisible = keyVisibility[provider] ?? false;
                            return (
                                <div key={provider} className="space-y-1.5">
                                    <label className="text-xs font-medium text-[#374151]">
                                        {LLM_PROVIDER_LABELS[provider]}
                                    </label>
                                    <div className="flex gap-1">
                                        <input
                                            type={isVisible ? 'text' : 'password'}
                                            placeholder="API Key"
                                            value={llmKeys[provider] ?? ''}
                                            onChange={(e) => saveLlmKey(provider, e.target.value)}
                                            className="flex-1 h-8 px-2 text-xs border border-[#e5e7eb] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-[#f87171] font-mono"
                                        />
                                        <button
                                            type="button"
                                            className="h-8 w-8 grid place-items-center border border-[#e5e7eb] rounded-md hover:bg-[#f3f4f6]"
                                            onClick={() => setKeyVisibility((prev) => ({ ...prev, [provider]: !isVisible }))}
                                            title={isVisible ? '숨기기' : '보기'}
                                        >
                                            {isVisible ? <EyeOff className="h-3 w-3 text-[#6b7280]" /> : <Eye className="h-3 w-3 text-[#6b7280]" />}
                                        </button>
                                    </div>
                                    {llmKeys[provider] ? (
                                        <p className="text-[10px] text-emerald-600">키 설정됨</p>
                                    ) : provider === 'gemini' && hasServerGeminiKey ? (
                                        <p className="text-[10px] text-emerald-700">서버 키 사용</p>
                                    ) : (
                                        <p className="text-[10px] text-[#9ca3af]">
                                            {provider === 'gemini' ? '서버 키 미설정' : '미설정'}
                                        </p>
                                    )}
                                </div>
                            );
                        })}

                        <div className="pt-3 border-t border-[#e5e7eb] space-y-2">
                            <p className="text-xs font-semibold text-[#374151] uppercase tracking-wider">모델 활성화</p>
                            {LLM_MODELS.map((model) => {
                                const isEnabled = enabledModelIds.has(model.id);
                                return (
                                    <button
                                        key={model.id}
                                        type="button"
                                        onClick={() => toggleModel(model.id)}
                                        className={cn(
                                            'w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-xs transition-colors',
                                            isEnabled
                                                ? 'border-emerald-200 bg-[#f0fdf4] text-[#111827]'
                                                : 'border-[#e5e7eb] bg-[#f9fafb] text-[#9ca3af]',
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className={cn(
                                                'h-4 w-4 rounded border flex items-center justify-center transition-colors',
                                                isEnabled ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-[#d1d5db]',
                                            )}>
                                                {isEnabled ? <Check className="h-2.5 w-2.5 text-white" /> : null}
                                            </div>
                                            <span>{model.name}</span>
                                        </div>
                                        <span className="text-[10px] text-[#9ca3af]">{LLM_PROVIDER_LABELS[model.provider]}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="pt-2 border-t border-[#e5e7eb]">
                            <p className="text-[10px] text-[#9ca3af] leading-relaxed">
                                API 키는 브라우저에만 저장됩니다.
                                활성화된 모델 중 키가 설정된 모델만 선택 가능합니다.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 h-0 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
                        <div className="px-2 pb-1">
                            <Input
                                value={conversationSearchQuery}
                                onChange={(event) => setConversationSearchQuery(event.target.value)}
                                placeholder="대화 검색"
                                className="h-8 text-xs bg-white border-[#e5e7eb] focus-visible:ring-[#f87171]"
                            />
                        </div>
                        {pendingDeletedConversation ? (
                            <div className="mx-2 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] p-2 text-xs text-[#166534] flex items-center justify-between gap-2">
                                <span className="truncate">삭제한 대화를 복구할 수 있습니다.</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2 bg-[#166534] hover:bg-[#14532d] text-white"
                                    onClick={handleUndoDeleteConversation}
                                >
                                    되돌리기
                                </Button>
                            </div>
                        ) : null}
                        <div className="px-2 pb-2">
                            <div className="flex flex-wrap gap-1">
                                <button
                                    type="button"
                                    className={cn(
                                        'h-6 px-2 rounded-full border text-[11px] transition-colors',
                                        conversationQuickFilter === CONVERSATION_FILTER_ALL
                                            ? 'border-[#fb7185] bg-[#fff1f2] text-[#be123c]'
                                            : 'border-[#e5e7eb] bg-white text-[#6b7280] hover:bg-[#f9fafb]',
                                    )}
                                    onClick={() => setConversationQuickFilter(CONVERSATION_FILTER_ALL)}
                                >
                                    전체
                                </button>
                                <button
                                    type="button"
                                    className={cn(
                                        'h-6 px-2 rounded-full border text-[11px] transition-colors',
                                        conversationQuickFilter === CONVERSATION_FILTER_PINNED
                                            ? 'border-[#fb7185] bg-[#fff1f2] text-[#be123c]'
                                            : 'border-[#e5e7eb] bg-white text-[#6b7280] hover:bg-[#f9fafb]',
                                    )}
                                    onClick={() => setConversationQuickFilter(CONVERSATION_FILTER_PINNED)}
                                >
                                    고정
                                </button>
                                {availableConversationTags.map((tag) => {
                                    const tagFilter: InsightConversationFilter = `tag:${tag}`;
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            className={cn(
                                                'h-6 px-2 rounded-full border text-[11px] transition-colors',
                                                conversationQuickFilter === tagFilter
                                                    ? 'border-[#fb7185] bg-[#fff1f2] text-[#be123c]'
                                                    : 'border-[#e5e7eb] bg-white text-[#6b7280] hover:bg-[#f9fafb]',
                                            )}
                                            onClick={() => setConversationQuickFilter(tagFilter)}
                                        >
                                            #{tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {activeConversation ? (
                            <div className="px-2 pb-2">
                                <div className="rounded-lg border border-[#e5e7eb] bg-white p-2 space-y-2">
                                    <p className="text-[11px] font-medium text-[#6b7280]">현재 대화 태그</p>
                                    <div className="flex gap-1">
                                        <Input
                                            value={activeConversationTagInput}
                                            onChange={(event) => setActiveConversationTagInput(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    handleAddConversationTag();
                                                }
                                            }}
                                            maxLength={MAX_CONVERSATION_TAG_LENGTH}
                                            placeholder="태그 추가"
                                            className="h-7 text-xs bg-white border-[#e5e7eb] focus-visible:ring-[#f87171]"
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 px-2"
                                            onClick={handleAddConversationTag}
                                        >
                                            추가
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {activeConversation.tags.length === 0 ? (
                                            <span className="text-[11px] text-[#9ca3af]">태그 없음</span>
                                        ) : activeConversation.tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="inline-flex items-center gap-1 rounded-full border border-[#fbcfe8] bg-[#fff1f2] px-2 py-0.5 text-[11px] text-[#be185d]"
                                            >
                                                #{tag}
                                                <button
                                                    type="button"
                                                    className="rounded-full p-0.5 hover:bg-[#ffe4e6]"
                                                    onClick={() => handleRemoveConversationTag(tag)}
                                                    aria-label={`태그 ${tag} 제거`}
                                                >
                                                    <X className="h-2.5 w-2.5" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                        {conversationList.length === 0 ? (
                            <p className="px-2 py-10 text-sm text-[#6b7280] text-center">새로운 대화를 준비 중입니다</p>
                        ) : (
                            conversationList.map((conversation) => {
                                const isActive = conversation.id === activeConversationId;
                                const userMsg = conversation.messages.find((m) => m.role === 'user');
                                const label = conversation.title !== EMPTY_TITLE
                                    ? conversation.title
                                    : userMsg
                                        ? shortText(userMsg.content, 30)
                                        : conversation.bootstrapFailed
                                            ? '연결 실패'
                                            : '새로운 대화';

                                return (
                                    <div
                                        key={conversation.id}
                                        className={cn(
                                            'group relative flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer',
                                            isActive
                                                ? 'border-[#fb7185] bg-white'
                                                : 'border-transparent hover:border-[#e5e7eb] hover:bg-white',
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSelectConversation(conversation.id)}
                                            className="flex-1 min-w-0 text-left"
                                        >
                                            <p className={cn(
                                                'text-sm truncate pr-5',
                                                isActive ? 'font-semibold text-[#111827]' : 'font-medium text-[#374151]',
                                            )}>{label}</p>
                                            {conversation.pinned ? (
                                                <p className="mt-0.5 text-[10px] text-[#ef4444] flex items-center gap-1">
                                                    <Pin className="h-3 w-3" />
                                                    고정됨
                                                </p>
                                            ) : null}
                                            {conversation.tags.length > 0 ? (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {conversation.tags.map((tag) => (
                                                        <span
                                                            key={`${conversation.id}-${tag}`}
                                                            className="inline-flex rounded-full border border-[#fbcfe8] bg-[#fff1f2] px-1.5 py-0.5 text-[10px] leading-none text-[#be185d]"
                                                        >
                                                            #{tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleTogglePinnedConversation(conversation.id);
                                            }}
                                            className="h-6 w-6 grid place-items-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]"
                                            title={conversation.pinned ? '고정 해제' : '고정'}
                                        >
                                            {conversation.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleRenameConversation(conversation.id);
                                            }}
                                            className="h-6 w-6 grid place-items-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]"
                                            title="이름 변경"
                                        >
                                            <Pencil className="h-3 w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleDuplicateConversation(conversation.id);
                                            }}
                                            className="h-6 w-6 grid place-items-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]"
                                            title="대화 복제"
                                        >
                                            <Copy className="h-3 w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleExportConversation(conversation.id);
                                            }}
                                            className="h-6 w-6 grid place-items-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]"
                                            title="대화 내보내기"
                                        >
                                            <Download className="h-3 w-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteConversation(conversation.id);
                                            }}
                                            className="h-6 w-6 grid place-items-center rounded-md text-[#ef4444] hover:bg-[#fee2e2] opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="대화 삭제"
                                        >
                                            <Trash2 className="h-3 w-3 text-[#ef4444]" />
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </aside>

            <section className="flex-1 min-w-0 flex flex-col min-h-0">
                <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-[#e5e7eb] bg-white">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowConversationList(true)}
                        className="h-9 flex-1"
                    >
                        대화 목록
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className="h-9"
                        onClick={handleNewConversation}
                    >
                        <PlusCircle className="h-4 w-4 mr-1.5" />
                        새 대화
                    </Button>
                </div>
                <div className="border-b border-[#e5e7eb] bg-[#fcfcfd] px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-[#374151]">가드레일</span>
                            <span
                                className={cn(
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                    !guardrailMetricsNormalized.guardrailConfig.enabled
                                        ? 'border-[#e5e7eb] bg-[#f3f4f6] text-[#6b7280]'
                                        : hasGuardrailSignals
                                            ? 'border-[#fecaca] bg-[#fff1f2] text-[#be123c]'
                                            : 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]',
                                )}
                            >
                                {!guardrailMetricsNormalized.guardrailConfig.enabled
                                    ? '비활성'
                                    : hasGuardrailSignals
                                        ? '주의 필요'
                                        : hasGuardrailMetricsData
                                            ? '정상'
                                            : '대기'}
                            </span>
                            <span className="text-[11px] text-[#6b7280]">
                                지연 초과 {guardrailSummary.totalLatencyBudgetExceeded}
                            </span>
                            <span className="text-[11px] text-[#6b7280]">
                                폴백 경고 {guardrailSummary.totalFallbackStreakAlerts}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => {
                                    setShowGuardrailPanel((prev) => !prev);
                                    if (!showGuardrailPanel) {
                                        void refetchGuardrailMetrics();
                                    }
                                }}
                            >
                                {showGuardrailPanel ? '지표 숨기기' : '지표 보기'}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0"
                                onClick={handleRefreshGuardrailMetrics}
                                disabled={isGuardrailMetricsFetching}
                                title="지표 새로고침"
                            >
                                <RefreshCw className={cn('h-3.5 w-3.5', isGuardrailMetricsFetching && 'animate-spin')} />
                            </Button>
                        </div>
                    </div>
                    {showGuardrailPanel ? (
                        <div className="mt-2 rounded-lg border border-[#e5e7eb] bg-white p-2.5 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[11px] text-[#6b7280]">
                                    {guardrailUpdatedAtLabel ? `최근 업데이트 ${guardrailUpdatedAtLabel}` : '업데이트 정보 없음'}
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-[11px]"
                                        onClick={handleResetGuardrailMetrics}
                                        disabled={isResettingGuardrailMetrics}
                                    >
                                        {isResettingGuardrailMetrics ? '초기화 중...' : '지표 초기화'}
                                    </Button>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {([
                                    { key: 'chat', label: 'Chat 라우트' },
                                    { key: 'stream', label: 'Stream 라우트' },
                                ] as const).map((route) => {
                                    const metrics = guardrailMetricsNormalized.routes[route.key];
                                    const outcomeRates = summarizeInsightChatGuardrailRouteOutcomeRates(metrics);
                                    const providerEntries = getTopMetricEntries(metrics.provider_request_counts, 3);
                                    const sourceEntries = getTopMetricEntries(metrics.source_counts, 3);
                                    const reasonEntries = getTopMetricEntries(metrics.fallback_totals ?? metrics.reliability_fallback_streak_alerts, 3);
                                    const citationQualityEntries = getTopMetricEntries(metrics.citation_quality_counts, 3);
                                    const responseModeEntries = getTopMetricEntries(metrics.response_mode_counts, 3);
                                    const memoryModeEntries = getTopMetricEntries(metrics.memory_mode_counts, 3);
                                    const feedbackRatingEntries = getTopMetricEntries(metrics.feedback_rating_counts, 3);
                                    const feedbackHasReasonEntries = getTopMetricEntries(metrics.feedback_has_reason_counts, 3);
                                    const feedbackReasonCategoryEntries = getTopMetricEntries(
                                        metrics.feedback_reason_category_counts,
                                        3,
                                    );
                                    return (
                                        <div
                                            key={route.key}
                                            className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-2 text-[11px] text-[#334155]"
                                        >
                                            <p className="font-semibold text-[#0f172a]">{route.label}</p>
                                            <p className="mt-1">지연 초과: {metrics.latency_budget_exceeded}</p>
                                            <p className="mt-1">총 요청: {outcomeRates.totalRequests}</p>
                                            <div className="mt-1">
                                                <div className="text-[#475569]">요청 결과율</div>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {outcomeRates.totalRequests > 0 ? (
                                                        <>
                                                            <span>
                                                                {renderGuardrailMetricBadge(
                                                                    '성공',
                                                                    outcomeRates.successRate,
                                                                    'border border-[#dcfce7] bg-[#f0fdf4] text-[#166534]',
                                                                    '%',
                                                                )}
                                                            </span>
                                                            <span>
                                                                {renderGuardrailMetricBadge(
                                                                    '폴백',
                                                                    outcomeRates.fallbackRate,
                                                                    'border border-[#ffe4e6] bg-[#fff1f2] text-[#9f1239]',
                                                                    '%',
                                                                )}
                                                            </span>
                                                            <span>
                                                                {renderGuardrailMetricBadge(
                                                                    '오류',
                                                                    outcomeRates.errorRate,
                                                                    'border border-[#fee2e2] bg-[#fef2f2] text-[#991b1b]',
                                                                    '%',
                                                                )}
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="text-[11px] text-[#64748b]">요청 결과 데이터 없음</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-1">
                                                <div className="text-[#475569]">상위 공급자</div>
                                               <div className="mt-1 flex flex-wrap gap-1">
                                                    {providerEntries.length > 0 ? (
                                                        providerEntries.map(([provider, count]) => {
                                                            const label = getGuardrailMetricLabel(provider);
                                                            return (
                                                                <span key={`${route.key}-${provider}`}>
                                                                    {renderGuardrailMetricBadge(
                                                                        label,
                                                                        count,
                                                                        'border border-[#e0e7ff] bg-[#eef2ff] text-[#3730a3]',
                                                                    )}
                                                                </span>
                                                            );
                                                        })
                                                    ) : (
                                                        <span className="text-[11px] text-[#64748b]">공급자 데이터 없음</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-2">
                                                <div className="text-[#475569]">상위 출처</div>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {sourceEntries.length > 0 ? (
                                                        sourceEntries.map(([source, count]) => {
                                                            const label = getGuardrailMetricLabel(source);
                                                            return (
                                                                <span key={`${route.key}-${source}`}>
                                                                    {renderGuardrailMetricBadge(
                                                                        label,
                                                                        count,
                                                                        'border border-[#dcfce7] bg-[#f0fdf4] text-[#166534]',
                                                                    )}
                                                                </span>
                                                            );
                                                        })
                                                    ) : (
                                                        <span className="text-[11px] text-[#64748b]">출처 데이터 없음</span>
                                                    )}
                                                </div>
                                            </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 인용 품질</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {citationQualityEntries.length > 0 ? (
                                                            citationQualityEntries.map(([quality, count]) => {
                                                                const label = getCitationQualityMetricLabel(quality);
                                                                return (
                                                                    <span key={`${route.key}-${quality}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label,
                                                                            count,
                                                                            `border border-[#ddd6fe] bg-[#ede9fe] ${getCitationQualityMetricBadgeStyle(quality)}`,
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">인용 품질 데이터 없음</span>
                                                        )}
                                                    </div>
                                            </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 폴백 원인</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {reasonEntries.length > 0 ? (
                                                            reasonEntries.map(([reason, count]) => {
                                                                const label = getFallbackReasonLabel(reason);
                                                                return (
                                                                    <span key={`${route.key}-${reason}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label || reason,
                                                                            count,
                                                                            'border border-[#ffe4e6] bg-[#fff1f2] text-[#9f1239]',
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">폴백 연속 경고 없음</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 피드백 사유 카테고리</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {feedbackReasonCategoryEntries.length > 0 ? (
                                                            feedbackReasonCategoryEntries.map(([category, count]) => {
                                                                const label = getFeedbackReasonCategoryMetricLabel(category);
                                                                return (
                                                                    <span key={`${route.key}-${category}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label,
                                                                            count,
                                                                            'border border-[#ffedd5] bg-[#fff7ed] text-[#c2410c]',
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">피드백 사유 카테고리 데이터 없음</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 응답 모드</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {responseModeEntries.length > 0 ? (
                                                            responseModeEntries.map(([mode, count]) => {
                                                                const label = getResponseModeMetricLabel(mode);
                                                                return (
                                                                    <span key={`${route.key}-${mode}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label,
                                                                            count,
                                                                            'border border-[#f5f3ff] bg-[#f8fafc] text-[#4c1d95]',
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">응답 모드 데이터 없음</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 기억 모드</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {memoryModeEntries.length > 0 ? (
                                                            memoryModeEntries.map(([mode, count]) => {
                                                                const label = getMemoryModeMetricLabel(mode);
                                                                return (
                                                                    <span key={`${route.key}-${mode}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label,
                                                                            count,
                                                                            'border border-[#fef3c7] bg-[#fffbeb] text-[#92400e]',
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">기억 모드 데이터 없음</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 피드백</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {feedbackRatingEntries.length > 0 ? (
                                                            feedbackRatingEntries.map(([rating, count]) => {
                                                                const label = getFeedbackRatingMetricLabel(rating);
                                                                return (
                                                                    <span key={`${route.key}-${rating}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label,
                                                                            count,
                                                                            'border border-[#ccfbf1] bg-[#ecfeff] text-[#155e75]',
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">피드백 데이터 없음</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-2">
                                                    <div className="text-[#475569]">상위 피드백 사유 포함</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {feedbackHasReasonEntries.length > 0 ? (
                                                            feedbackHasReasonEntries.map(([reason, count]) => {
                                                                const label = getFeedbackHasReasonMetricLabel(reason);
                                                                return (
                                                                    <span key={`${route.key}-${reason}`}>
                                                                        {renderGuardrailMetricBadge(
                                                                            label,
                                                                            count,
                                                                            'border border-[#fee2e2] bg-[#fef2f2] text-[#991b1b]',
                                                                        )}
                                                                    </span>
                                                                );
                                                            })
                                                        ) : (
                                                            <span className="text-[11px] text-[#64748b]">피드백 사유 데이터 없음</span>
                                                        )}
                                                    </div>
                                                </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="rounded-md border border-dashed border-[#e5e7eb] bg-[#fafafa] px-2 py-1.5 text-[11px] text-[#6b7280]">
                                <p>
                                    가드레일: {guardrailMetricsNormalized.guardrailConfig.enabled ? 'ON' : 'OFF'} ·
                                    지연 예산 {guardrailMetricsNormalized.guardrailConfig.latencyBudgetMs}ms ·
                                    연속 임계치 {guardrailMetricsNormalized.guardrailConfig.fallbackStreakThreshold}회
                                </p>
                                {guardrailDominantFallbackLabel ? (
                                    <p className="mt-1">
                                        최다 폴백 원인: {guardrailDominantFallbackLabel} ({guardrailSummary.dominantFallbackCount}회)
                                    </p>
                                ) : null}
                            </div>
                            {guardrailErrorMessage ? (
                                <p className="text-[11px] text-[#dc2626]">{guardrailErrorMessage}</p>
                            ) : null}
                            {guardrailActionMessage ? (
                                <p className="text-[11px] text-[#166534]">{guardrailActionMessage}</p>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 bg-white">
                    {activeConversation?.bootstrapFailed ? (
                        <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
                            <AlertCircle className="h-10 w-10 text-[#f59e0b]" />
                            <p className="text-sm text-[#374151]">현재 챗봇 준비 상태를 확인할 수 없습니다.</p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRetryBootstrap}
                            >
                                다시 불러오기
                            </Button>
                        </div>
                    ) : (
                        <>
                            {activeConversation?.messages.length === 0 ? (
                                <div className="h-full flex items-center justify-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="h-10 w-10 rounded-full grid place-items-center bg-[#111827]">
                                            <Bot className="h-4 w-4 text-white" />
                                        </div>
                                        <TypingIndicator />
                                    </div>
                                </div>
                            ) : (
                                        <>
                                            <div className="px-1 pb-2 flex flex-wrap items-center gap-2 justify-end">
                                                <span className="text-xs text-[#6b7280]">컨텍스트 창:</span>
                                                <select
                                                    value={conversationContextWindowValue}
                                                    onChange={(event) => handleSetMessageWindow(Number(event.target.value))}
                                                    className="h-7 w-28 rounded-md border border-[#e5e7eb] px-2 text-xs"
                                                >
                                                    {contextWindowOptions.map((size) => (
                                                        <option key={size} value={size}>
                                                            {size >= activeConversationMessageCount ? '전체' : `${size}개`}
                                                        </option>
                                                    ))}
                                                </select>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        if (!activeConversation) return;
                                                        handleSetMessageWindow(activeConversation.messages.length || MESSAGE_WINDOW_INITIAL);
                                                    }}
                                                    className="h-7 px-2 text-xs"
                                                >
                                                    전체 보기
                                                </Button>
                                            </div>
                                            {canShowMoreMessages ? (
                                                <div className="px-1 py-2 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={handleLoadMoreMessages}
                                                className="text-xs text-[#ef4444] underline underline-offset-2 hover:no-underline"
                                            >
                                                이전 대화 더 보기
                                            </button>
                                        </div>
                                    ) : null}

                                    {visibleMessages.map((message) => {
                                        const previousUserMessage = previousUserMessageById.get(message.id) ?? null;

                                        const followUpPrompts = followUpPromptsByMessageId.get(message.id) ?? [];

                                        return (
                                            <ChatBubble
                                                key={message.id}
                                                message={message}
                                                followUpPrompts={followUpPrompts}
                                                canEdit={message.id === latestEditableUserMessageId}
                                                onEditMessage={handleEditMessage}
                                                canRegenerate={!!(message.role === 'assistant' && previousUserMessage?.content.trim() && !isStreamingInFlight)}
                                                onRegenerate={handleRegenerateAssistantMessage}
                                                feedback={feedbackForMessage(message.id)}
                                                onFeedback={handleFeedback}
                                                onFollowUpPrompt={handleFollowUpPromptSelect}
                                                isFollowUpDisabled={isStreamingInFlight}
                                            />
                                        );
                                    })}
                                </>
                            )}

                            {isSending && !currentLlmConfig ? (
                                <div className="flex gap-2.5 mb-3">
                                    <div className="h-8 w-8 rounded-full grid place-items-center text-white text-xs bg-[#111827]">
                                        <Bot className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="max-w-[84%] rounded-xl px-3.5 py-2.5 border border-[#e5e7eb] bg-white break-words min-w-0">
                                        <TypingIndicator />
                                    </div>
                                </div>
                            ) : null}

                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>

                <div className="border-t border-[#e5e7eb] px-3 py-3 bg-white">
                    <div className="mb-2 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 min-w-0">
                        <div className="flex shrink-0 flex-nowrap items-center gap-2">
                            <div ref={modelDropdownRef} className="relative shrink-0">
                                <button
                                    type="button"
                                    className={cn(
                                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-white',
                                        activeProviderHasKey
                                            ? 'border-emerald-300 text-emerald-700'
                                            : 'border-[#fca5a5] text-[#ef4444]',
                                    )}
                                    onClick={() => setShowModelDropdown((prev) => !prev)}
                                >
                                    <span className="font-medium">{activeModel.name}</span>
                                    <ChevronDown className="h-3 w-3" />
                                </button>

                                {showModelDropdown ? (
                                    <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                                        {(['gemini', 'openai', 'anthropic'] as LlmProvider[]).map((provider) => {
                                            const providerModels = availableModels.filter((m) => m.provider === provider);
                                            const providerHasKey = hasProviderServerOrUserKey(provider);
                                            return (
                                                <div key={provider}>
                                                    <p className="px-3 py-1.5 text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wider">
                                                        {LLM_PROVIDER_LABELS[provider]}
                                                        {!providerHasKey && <span className="ml-1 text-[#fca5a5]">키 미설정</span>}
                                                    </p>
                                                    {providerModels.map((model) => (
                                                        <button
                                                            key={model.id}
                                                            type="button"
                                                            disabled={!model.hasKey}
                                                            className={cn(
                                                                'w-full text-left px-3 py-2 text-xs flex items-center justify-between',
                                                                model.hasKey
                                                                    ? 'hover:bg-[#f9fafb] text-[#111827]'
                                                                    : 'text-[#d1d5db] cursor-not-allowed',
                                                                model.id === activeModelId && 'bg-[#f0fdf4]',
                                                            )}
                                                            onClick={() => selectModel(model.id)}
                                                        >
                                                            <span>{model.name}</span>
                                                            {model.id === activeModelId ? <Check className="h-3 w-3 text-emerald-600" /> : null}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>

                            <div ref={imageModelDropdownRef} className="relative shrink-0">
                                <button
                                    type="button"
                                    className={cn(
                                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-white border-emerald-300 text-emerald-700',
                                    )}
                                    onClick={() => setShowImageModelDropdown((prev) => !prev)}
                                >
                                    <span>{activeImageModelProfile.name}</span>
                                    <ChevronDown className="h-3 w-3" />
                                </button>

                                {showImageModelDropdown ? (
                                    <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                                        {IMAGE_MODEL_PROFILES.map((profile) => (
                                            <button
                                                key={profile.id}
                                                type="button"
                                                className={cn(
                                                    'w-full text-left px-3 py-2 text-xs flex items-center justify-between',
                                                    profile.id === imageModelProfile ? 'bg-[#f0fdf4]' : 'hover:bg-[#f9fafb]',
                                                )}
                                                onClick={() => selectImageModelProfile(profile.id)}
                                            >
                                                <span>{profile.name}</span>
                                                {profile.id === imageModelProfile ? <Check className="h-3 w-3 text-emerald-600" /> : null}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>

                            <div ref={responseModeDropdownRef} className="relative shrink-0">
                                <button
                                    type="button"
                                    className={cn(
                                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-white border-emerald-300 text-emerald-700',
                                    )}
                                    onClick={() => setShowResponseModeDropdown((prev) => !prev)}
                                >
                                    <span>{activeConversationResponseModeLabel}</span>
                                    <ChevronDown className="h-3 w-3" />
                                </button>

                                {showResponseModeDropdown ? (
                                    <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                                        {CHAT_RESPONSE_MODES.map((mode) => (
                                            <button
                                                key={mode.value}
                                                type="button"
                                                className={cn(
                                                    'w-full text-left px-3 py-2 text-xs flex flex-col',
                                                    mode.value === activeConversationResponseMode
                                                        ? 'bg-[#f0fdf4] text-[#065f46]'
                                                        : 'hover:bg-[#f9fafb] text-[#111827]',
                                                )}
                                                onClick={() => setActiveConversationResponseMode(mode.value)}
                                            >
                                                <span className="font-medium">{mode.label}</span>
                                                <span className="text-[11px] text-[#6b7280]">{mode.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>

                            <div ref={memoryModeDropdownRef} className="relative shrink-0">
                                <button
                                    type="button"
                                    className={cn(
                                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-white border-emerald-300 text-emerald-700',
                                    )}
                                    onClick={() => setShowMemoryModeDropdown((prev) => !prev)}
                                >
                                    <span>{activeConversationMemoryModeLabel}</span>
                                    <ChevronDown className="h-3 w-3" />
                                </button>

                                {showMemoryModeDropdown ? (
                                    <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                                        {CHAT_MEMORY_MODES.map((mode) => (
                                            <button
                                                key={mode.value}
                                                type="button"
                                                className={cn(
                                                    'w-full text-left px-3 py-2 text-xs flex flex-col',
                                                    mode.value === activeConversationMemoryMode
                                                        ? 'bg-[#f0fdf4] text-[#065f46]'
                                                        : 'hover:bg-[#f9fafb] text-[#111827]',
                                                )}
                                                onClick={() => setActiveConversationMemoryMode(mode.value)}
                                            >
                                                <span className="font-medium">{mode.label}</span>
                                                <span className="text-[11px] text-[#6b7280]">{mode.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>

                            <div className="relative shrink-0 min-w-0 max-w-[16rem]">
                                <Input
                                    value={activeConversationMemoryProfileNote}
                                    onChange={(event) => setActiveConversationMemoryProfileNote(event.target.value)}
                                    placeholder="기억 프로필 메모"
                                    maxLength={MAX_MEMORY_PROFILE_NOTE_LENGTH}
                                    aria-label="기억 프로필 메모"
                                    className="h-8 text-xs bg-white border-[#e5e7eb] focus-visible:ring-[#f87171]"
                                />
                            </div>
                        </div>

                        {isCommandMode ? (
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] uppercase tracking-wider text-[#6b7280] font-semibold mb-1">명령어 제안</p>
                                {hasPromptSuggestions ? (
                                    <div
                                        className="grid gap-1"
                                        role="listbox"
                                        aria-label="프롬프트 명령어 제안"
                                        aria-live="polite"
                                    >
                                        {commandSuggestions.map((suggestion, index) => {
                                            const isActive = index === activeCommandIndex;
                                            const resolvedPromptPreview = resolvePromptFromTemplate(suggestion.prompt);
                                            return (
                                                <div
                                                    key={suggestion.id}
                                                    role="option"
                                                    aria-selected={isActive}
                                                    tabIndex={0}
                                                    className={cn(
                                                        'w-full text-left rounded-lg border px-2.5 py-1.5',
                                                        isActive ? 'border-[#2563eb] bg-[#eff6ff]' : 'border-[#e5e7eb] bg-white',
                                                        'hover:border-[#93c5fd]'
                                                    )}
                                                    onMouseEnter={() => setActiveCommandIndex(index)}
                                                    onMouseDown={(event) => {
                                                        event.preventDefault();
                                                    }}
                                                    onClick={() => handlePromptTemplateApply(suggestion.prompt)}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-semibold text-[#111827] truncate">
                                                                {suggestion.prompt.command} · {suggestion.groupTitle || suggestion.prompt.label}
                                                            </p>
                                                            <p className="text-[11px] text-[#6b7280] truncate" title={suggestion.prompt.description}>
                                                                {suggestion.prompt.description}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    handlePromptTemplateApply(suggestion.prompt);
                                                                }}
                                                                className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-[#e5e7eb] text-[#4b5563] hover:bg-[#f9fafb]"
                                                                aria-label={`${suggestion.prompt.label} 명령어 삽입`}
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    handlePromptTemplateApply(suggestion.prompt, { autoSend: true });
                                                                }}
                                                                className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-[#e5e7eb] text-[#f97316] hover:bg-[#fff7ed]"
                                                                aria-label={`${suggestion.prompt.label} 즉시 전송`}
                                                            >
                                                                <Send className="h-3.5 w-3.5" />
                                                            </button>
                                                            <span className="sr-only">
                                                                미리보기: {resolvedPromptPreview}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-xs text-[#6b7280]">일치하는 명령어가 없습니다.</p>
                                )}
                            </div>
                        ) : (
                            <div className="min-w-0 flex-1 rounded-lg border border-[#f3f4f6] bg-white/80 px-2 py-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                    <p className="shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wider font-semibold text-[#6b7280]">
                                        빠른 프롬프트
                                        <span className="ml-1.5 text-[#9ca3af] font-normal">({totalQuickPromptCount})</span>
                                    </p>
                                    <div className="min-w-0 flex-1">
                                        {compactQuickPrompts.length > 0 ? (
                                            <div
                                                data-allow-horizontal-scroll="true"
                                                className="flex flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5 min-w-0 whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                                            >
                                                {compactQuickPrompts.map((prompt: InsightPromptCommand) => (
                                                    <span
                                                        key={`compact-${prompt.groupId}-${prompt.id}`}
                                                        className="inline-flex shrink-0 items-center rounded-md border border-[#e5e7eb] bg-[#fafafa] text-xs text-[#111827]"
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePromptTemplateApply(prompt)}
                                                            className="px-2 py-1 text-[#374151] font-medium whitespace-nowrap hover:bg-[#f3f4f6] rounded-l-md"
                                                            aria-label={`삽입: ${prompt.label}`}
                                                        >
                                                            {prompt.label}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePromptTemplateApply(prompt, { autoSend: true })}
                                                            className="px-1.5 py-1 border-l border-[#e5e7eb] text-[#f97316] hover:bg-[#ffedd5] rounded-r-md inline-flex items-center justify-center"
                                                            aria-label={`즉시 전송: ${prompt.label}`}
                                                        >
                                                            <Send className="h-3.5 w-3.5" />
                                                            <span className="sr-only">즉시 전송</span>
                                                        </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-[#9ca3af] truncate">추천 가능한 프롬프트가 없습니다.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                    </div>
                    {draftAttachments.length > 0 ? (
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            {draftAttachments.map((attachment) => (
                                <span
                                    key={attachment.id}
                                    className="inline-flex items-center gap-1 rounded-full border border-[#d1d5db] bg-[#f9fafb] px-2 py-0.5 text-[11px] text-[#374151]"
                                >
                                    <span className="max-w-[180px] truncate" title={attachment.name}>{attachment.name}</span>
                                    <button
                                        type="button"
                                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[#6b7280] hover:bg-[#e5e7eb]"
                                        onClick={() => handleRemoveAttachment(attachment.id)}
                                        aria-label={`${attachment.name} 첨부 제거`}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleSendMessage();
                        }}
                        className="flex gap-2"
                    >
                        <div className="shrink-0 flex items-center gap-1">
                            {canRegenerateLastResponse ? (
                                <Button
                                    type="button"
                                    className="h-11 px-2"
                                    variant="outline"
                                    onClick={handleRegenerateLastResponse}
                                    title="마지막 답변 다시 생성"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            ) : null}
                            {canStopStreaming ? (
                                <Button
                                    type="button"
                                    className="h-11 px-2 border-[#ef4444] text-[#ef4444] hover:bg-[#fef2f2]"
                                    variant="outline"
                                    onClick={handleStopStreaming}
                                    title="스트리밍 응답 중단"
                                >
                                    <Square className="h-4 w-4" />
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                className="h-11 px-2"
                                variant="outline"
                                onClick={handleOpenAttachmentPicker}
                                disabled={draftAttachments.length >= MAX_CHAT_ATTACHMENTS || !!activeConversation?.isBooting || !!isStreamingInFlight}
                                title="txt/csv 첨부"
                            >
                                <Paperclip className="h-4 w-4" />
                            </Button>
                        </div>
                        <input
                            ref={attachmentInputRef}
                            type="file"
                            accept=".txt,.csv,text/plain,text/csv,application/csv,application/vnd.ms-excel"
                            multiple
                            onChange={(event) => {
                                void handleAttachmentFileChange(event);
                            }}
                            className="hidden"
                        />
                        <Input
                            ref={inputRef}
                            value={inputValue}
                            onChange={(event) => setInputValue(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={editingMessageId ? '수정한 메시지를 입력해 주세요' : '질문을 입력해 주세요'}
                            disabled={!!activeConversation?.isBooting || !!isStreamingInFlight}
                            className="h-11 border-[#e5e7eb] focus-visible:ring-[#f87171]"
                        />
                        <Button
                            type="submit"
                            className="h-11"
                            disabled={!inputValue.trim() || !!activeConversation?.isBooting || !!isStreamingInFlight}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
            </section>
        </section >
    );
};

const InsightChatSection = memo(InsightChatSectionComponent);
InsightChatSection.displayName = 'InsightChatSection';

export default InsightChatSection;
