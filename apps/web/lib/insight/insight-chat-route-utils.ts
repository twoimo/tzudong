import type { InsightChatSource, AdminInsightChatResponse } from '@/types/insight';

type FallbackResponseOptions = {
    requestId?: string;
    fallbackReason: string;
    content?: string;
    error?: string;
    sources?: InsightChatSource[];
    asOf?: string;
    responseMode?: 'fast' | 'deep' | 'structured';
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
