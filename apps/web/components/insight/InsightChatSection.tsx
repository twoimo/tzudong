'use client';

import {
    type ComponentPropsWithoutRef,
    type KeyboardEvent,
    type PointerEvent,
    type ReactNode,
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
    Send,
    User,
    PlusCircle,
    Settings,
    Eye,
    EyeOff,
    ChevronDown,
    Check,
    Trash2,
} from 'lucide-react';
import { hierarchy, treemap, treemapResquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
    AdminInsightChatBootstrapResponse,
    AdminInsightChatResponse,
    InsightChatSource,
    LlmProvider,
    LlmModelOption,
    StoryboardModelProfile,
} from '@/types/insight';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: InsightChatSource[];
    createdAt: Date;
    meta?: AdminInsightChatResponse['meta'];
    visualComponent?: AdminInsightChatResponse['visualComponent'];
};

type ChatConversation = {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    isBooting: boolean;
    bootstrapFailed: boolean;
};

const EMPTY_TITLE = '새로운 대화';
const CHAT_BOOTSTRAP_TTL_MS = 4 * 60 * 1000;
const CHAT_RESPONSE_TTL_MS = 3 * 60 * 1000;
const CHAT_REQUEST_TIMEOUT_MS = 18_000;
const CHAT_REQUEST_RETRY_ATTEMPTS = 1;
const CHAT_REQUEST_RETRY_BASE_DELAY_MS = 250;
const CHAT_REQUEST_CACHE_LIMIT = 64;
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 220;
const MESSAGE_WINDOW_INITIAL = 80;
const MESSAGE_WINDOW_BATCH = 80;
const CHAT_STORAGE_KEY = 'tzudong-admin-insight-conversations-v1';
const LLM_KEYS_STORAGE_KEY = 'tzudong-admin-llm-keys';
const LLM_MODEL_STORAGE_KEY = 'tzudong-admin-llm-active-model';
const LLM_ENABLED_MODELS_KEY = 'tzudong-admin-llm-enabled-models';
const STORYBOARD_PROFILE_STORAGE_KEY = 'tzudong-admin-storyboard-profile';

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
    version: 1;
    conversations: PersistedConversation[];
    activeConversationId: string;
};

type PersistedConversation = {
    id: string;
    title: string;
    messages: PersistedChatMessage[];
    createdAt: number;
    updatedAt: number;
    isBooting?: boolean;
    bootstrapFailed?: boolean;
};

const chatBootstrapCache = new Map<string, CachedEntry<AdminInsightChatBootstrapResponse>>();
const chatResponseCache = new Map<string, CachedEntry<AdminInsightChatResponse>>();
const inFlightBootstrapRequest = new Map<string, Promise<AdminInsightChatBootstrapResponse>>();
const inFlightChatRequest = new Map<string, Promise<AdminInsightChatResponse>>();

const SUGGESTED_PROMPTS: string[] = [];

function makeId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeConversationId(): string {
    return makeId('conversation');
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

async function fetchChatBootstrap(): Promise<AdminInsightChatBootstrapResponse> {
    const cacheKey = 'admin-insight-bootstrap';
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

async function postChatMessage(
    message: string,
    llmConfig?: {
        provider: LlmProvider;
        model: string;
        apiKey: string;
        storyboardModelProfile?: StoryboardModelProfile;
        imageModelProfile?: StoryboardModelProfile;
    },
    imageModelProfile?: StoryboardModelProfile,
): Promise<AdminInsightChatResponse> {
    const resolvedImageModelProfile = llmConfig?.imageModelProfile
        || llmConfig?.storyboardModelProfile
        || imageModelProfile;
    const normalizedMessage = `${normalizeCacheKey(message)}|${resolvedImageModelProfile || ''}`;
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
                ...(llmConfig
                    ? {
                provider: llmConfig.provider,
                        model: llmConfig.model,
                        apiKey: llmConfig.apiKey,
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
    llmConfig: {
        provider: LlmProvider;
        model: string;
        apiKey: string;
        storyboardModelProfile?: StoryboardModelProfile;
        imageModelProfile?: StoryboardModelProfile;
    },
    onToken: (token: string) => void,
): Promise<AdminInsightChatResponse | null> {
    const resp = await fetch('/api/admin/insight/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            provider: llmConfig.provider,
            model: llmConfig.model,
            apiKey: llmConfig.apiKey,
            ...(llmConfig.imageModelProfile ? { imageModelProfile: llmConfig.imageModelProfile } : {}),
            ...(llmConfig.storyboardModelProfile ? { storyboardModelProfile: llmConfig.storyboardModelProfile } : {}),
        }),
    });

    if (!resp.ok) throw new Error('스트리밍 요청 실패');

    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        return resp.json() as Promise<AdminInsightChatResponse>;
    }

    if (!resp.body) throw new Error('스트리밍 본문 없음');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
                const parsed = JSON.parse(payload) as { text?: string; error?: string };
                if (parsed.text) onToken(parsed.text);
            } catch { /* skip */ }
        }
    }

    return null;
}

function mapSources(rawSources: InsightChatSource[] | undefined): InsightChatSource[] {
    return (rawSources ?? []).filter((source) => Boolean(source.videoTitle || source.youtubeLink || source.timestamp || source.text));
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

type ChatTreemapLeaf = {
    id: string;
    name: string;
    title: string;
    category: string;
    value: number;
    metricText: string;
    percentText: string;
    color: string;
};

type ChatTreemapHierarchyLeaf = ChatTreemapLeaf;

type ChatTreemapGroup = {
    name: string;
    children: ChatTreemapLeaf[];
    value: number;
};

type ChatTreemapNode = ChatTreemapLeaf | ChatTreemapGroup | ChatTreemapRoot;
type ChatTreemapRoot = {
    name: string;
    children: ChatTreemapNode[];
};

type ChatTreemapAnyNode = ChatTreemapNode;

type TreemapCell = {
    node: ChatTreemapLeaf;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};

type ChatTreemapSourceRow = ChatTreemapLeaf & {
    metric: number;
};

type ChatTreemapTooltip = {
    id: string;
    title: string;
    category: string;
    metricText: string;
    percentText: string;
    x: number;
    y: number;
};

type TreemapChartDimensions = {
    width: number;
    height: number;
};

const CHAT_TREEMAP_PALETTE = ['#22c55e', '#0ea5e9', '#f97316', '#a855f7', '#ef4444', '#14b8a6', '#6366f1', '#facc15', '#fb7185', '#2dd4bf'];
const CHAT_TREEMAP_MAX_LEAVES = 18;
const CHAT_TREEMAP_MIN_LEAVES = 5;
const CHAT_TREEMAP_MOBILE_MAX_LEAVES = 10;
const CHAT_TREEMAP_MOBILE_MIN_LEAVES = 4;
const CHAT_TREEMAP_TABLET_MAX_LEAVES = 14;
const CHAT_TREEMAP_TABLET_MIN_LEAVES = 5;
const CHAT_TREEMAP_MIN_WIDTH = 320;
const CHAT_TREEMAP_TABLET_MIN_WIDTH = 280;
const CHAT_TREEMAP_MOBILE_MIN_WIDTH = 220;
const CHAT_TREEMAP_MIN_HEIGHT = 220;
const CHAT_TREEMAP_TABLET_MIN_HEIGHT = 260;
const CHAT_TREEMAP_DESKTOP_MIN_HEIGHT = 280;
const CHAT_TREEMAP_MAX_HEIGHT = 760;
const CHAT_TREEMAP_ASPECT_RATIO = 0.82;
const CHAT_TREEMAP_TOOLTIP_WIDTH = 240;
const CHAT_TREEMAP_TOOLTIP_HEIGHT = 108;
const CHAT_TREEMAP_AREA_PER_CELL = 9_500;
const CHAT_TREEMAP_MOBILE_AREA_PER_CELL = 12_000;
const CHAT_TREEMAP_TABLET_AREA_PER_CELL = 10_500;
const CHAT_TREEMAP_MAX_LAYOUT_TOP_SHARE = 0.52;
const CHAT_TREEMAP_EMPTY_MESSAGE = '트리맵에 표시할 데이터가 없습니다.';

const CHAT_TREEMAP_MOBILE_BP = 768;
const CHAT_TREEMAP_TABLET_BP = 1024;

const getTreemapAreaPerCell = (width: number): number => {
    if (width < CHAT_TREEMAP_MOBILE_BP) return CHAT_TREEMAP_MOBILE_AREA_PER_CELL;
    if (width < CHAT_TREEMAP_TABLET_BP) return CHAT_TREEMAP_TABLET_AREA_PER_CELL;
    return CHAT_TREEMAP_AREA_PER_CELL;
};

const getTreemapLeafBounds = (width: number): { minLeaves: number; maxLeaves: number } => {
    if (width < CHAT_TREEMAP_MOBILE_BP) {
        return {
            minLeaves: CHAT_TREEMAP_MOBILE_MIN_LEAVES,
            maxLeaves: CHAT_TREEMAP_MOBILE_MAX_LEAVES,
        };
    }

    if (width < CHAT_TREEMAP_TABLET_BP) {
        return {
            minLeaves: CHAT_TREEMAP_TABLET_MIN_LEAVES,
            maxLeaves: CHAT_TREEMAP_TABLET_MAX_LEAVES,
        };
    }

    return {
        minLeaves: CHAT_TREEMAP_MIN_LEAVES,
        maxLeaves: CHAT_TREEMAP_MAX_LEAVES,
    };
};

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

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-insight-chat-treemap'],
        queryFn: async () => {
            const params = new URLSearchParams({
                period: 'ALL',
                viewMode: 'all',
                metricMode: 'views',
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
        const container = containerRef.current;
        const measurementTarget = container.parentElement ?? container;

        const update = () => {
            if (!containerRef.current) return;

            const resolveWidthFromElement = (element: HTMLElement | null): number => {
                if (!element) return 0;
                const candidate = Math.floor(element.clientWidth);
                if (candidate > 0) return candidate;

                const rectWidth = Math.floor(element.getBoundingClientRect().width);
                return rectWidth > 0 ? rectWidth : 0;
            };

            const viewportFallback = typeof window === 'undefined'
                ? CHAT_TREEMAP_MOBILE_MIN_WIDTH
                : Math.max(1, Math.floor((window.visualViewport?.width ?? window.innerWidth) * 0.92));
            const resolvedWidth = resolveWidthFromElement(measurementTarget)
                || resolveWidthFromElement(containerRef.current)
                || resolveWidthFromElement(measurementTarget.parentElement)
                || viewportFallback;

            const width = Math.max(1, Math.floor(resolvedWidth));
            const { minHeight } = getTreemapMinDimensions(width);
            const ratioHeight = Math.round(width * CHAT_TREEMAP_ASPECT_RATIO);
            const viewportHeight = typeof window === 'undefined'
                ? Number.MAX_SAFE_INTEGER
                : Math.floor((window.visualViewport?.height ?? window.innerHeight) * 0.75);
            const targetHeight = Math.max(minHeight, Math.min(CHAT_TREEMAP_MAX_HEIGHT, Math.max(minHeight, Math.min(viewportHeight, ratioHeight))));
            setDimensions({ width, height: targetHeight });
        };

        update();
        const rafId = typeof window === 'undefined' ? null : window.requestAnimationFrame(update);

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(containerRef.current);
        if (measurementTarget !== container) {
            resizeObserver.observe(measurementTarget);
        }

        return () => {
            resizeObserver.disconnect();
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, []);

    const updateTooltip = useCallback((event: PointerEvent<HTMLDivElement>, cell: TreemapCell) => {
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const pointerX = event.clientX - containerRect.left;
        const pointerY = event.clientY - containerRect.top;
        const tooltipWidth = Math.min(CHAT_TREEMAP_TOOLTIP_WIDTH, Math.max(170, containerRect.width * 0.8));
        const tooltipHeight = CHAT_TREEMAP_TOOLTIP_HEIGHT;

        setTooltip({
            id: cell.node.id,
            title: cell.node.title,
            category: cell.node.category,
            metricText: cell.node.metricText,
            percentText: cell.node.percentText,
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

    const rows = useMemo(() => {
        if (dimensions.width <= 0 || dimensions.height <= 0) return [];
        if (!data) return [];

        const sortedVideos = data.videos
            .map((video) => ({
                ...video,
                metric: Number.isFinite(video.viewCount) ? Math.max(0, video.viewCount) : 0,
            }))
            .filter((video) => Number.isFinite(video.metric))
            .sort((a, b) => b.metric - a.metric);

        if (sortedVideos.length === 0) return [];

        const totalMetric = sortedVideos.reduce((sum, row) => sum + row.metric, 0);
        const { minLeaves, maxLeaves } = getTreemapLeafBounds(dimensions.width);
        const areaPerCell = getTreemapAreaPerCell(dimensions.width);
        const areaBasedLimit = Math.max(minLeaves, Math.floor((dimensions.width * dimensions.height) / areaPerCell));
        const visibleCount = Math.max(
            minLeaves,
            Math.min(maxLeaves, areaBasedLimit || minLeaves),
        );
        const visibleVideos = sortedVideos.slice(0, visibleCount);

        const layoutRows = visibleVideos.map((row) => ({
            ...row,
            metricForDisplay: row.metric,
            metricForLayout: row.metric,
        }));

        const totalLayoutMetric = layoutRows.reduce((sum, row) => sum + row.metricForLayout, 0);
        if (totalLayoutMetric > 0) {
            for (const row of layoutRows) {
                row.metricForLayout = row.metricForLayout / totalLayoutMetric;
            }
        } else {
            const equalShare = 1 / layoutRows.length;
            for (const row of layoutRows) {
                row.metricForLayout = equalShare;
            }
        }

        if (layoutRows.length > 1) {
            const topShare = layoutRows[0].metricForLayout;
            if (topShare > CHAT_TREEMAP_MAX_LAYOUT_TOP_SHARE) {
                const targetTop = CHAT_TREEMAP_MAX_LAYOUT_TOP_SHARE;
                const remainForOthers = 1 - targetTop;
                const otherTotal = 1 - topShare;
                layoutRows[0].metricForLayout = targetTop;

                if (otherTotal > 0) {
                    const boostRatio = remainForOthers / otherTotal;
                    for (let i = 1; i < layoutRows.length; i += 1) {
                        layoutRows[i].metricForLayout *= boostRatio;
                    }
                } else {
                    const shared = remainForOthers / (layoutRows.length - 1);
                    for (let i = 1; i < layoutRows.length; i += 1) {
                        layoutRows[i].metricForLayout = shared;
                    }
                }
            }
        }

        const rowsWithColor = layoutRows
            .map((row, index) => ({
            id: row.id,
            name: row.title,
            title: row.title,
            category: row.category?.trim() || '기타',
            value: Math.max(0.25, row.metricForLayout),
            metric: row.metricForDisplay,
            metricText: `${Math.round(row.metricForDisplay).toLocaleString()}회`,
                percentText: totalMetric > 0 ? `${((row.metricForDisplay / totalMetric) * 100).toFixed(1)}%` : '0%',
                color: CHAT_TREEMAP_PALETTE[index % CHAT_TREEMAP_PALETTE.length],
            }));

        const visibleMetric = rowsWithColor.reduce((sum, row) => sum + row.metric, 0);
        return rowsWithColor
            .sort((a, b) => b.metric - a.metric)
            .slice(0, CHAT_TREEMAP_MAX_LEAVES)
            .map((row) => ({
                ...row,
                percentText: visibleMetric > 0 ? `${((row.metric / visibleMetric) * 100).toFixed(1)}%` : '0%',
            }));
    }, [data, dimensions.width, dimensions.height]);

    const treemapCells = useMemo(
        () => buildTreemapLayout(rows, dimensions.width, dimensions.height),
        [rows, dimensions.width, dimensions.height],
    );
    const visibleTreemapCells = treemapCells;

    const displayedSummary = useMemo(() => {
        if (!data) return '';
        const total = data.totalVideos;
        const shownVideos = rows.length;
        return `조회수 기준 상위 ${shownVideos}/${total}개 영상 분포`;
    }, [data, rows]);

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

    if (visibleTreemapCells.length === 0) {
        return (
            <div className="mt-2 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 text-xs text-[#6b7280]">
                트리맵을 표시할 수 없습니다. 잠시 후 다시 시도해 주세요.
            </div>
        );
    }

    return (
        <div className="mt-2">
            <div className="mb-2 text-xs text-[#6b7280]">
                {displayedSummary}
            </div>
            <div ref={containerRef} className="w-full min-w-0">
                <div
                    className="relative w-full rounded-lg border border-[#e5e7eb] bg-[#f8fafc] overflow-visible"
                    style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
                >
                    {tooltip ? (
                        <div
                            className="absolute z-20 min-w-[200px] max-w-[250px] rounded-md border border-[#111827]/20 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm"
                            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
                        >
                            <p className="text-xs font-semibold leading-snug text-[#111827] break-all">
                                {tooltip.title}
                            </p>
                            <p className="mt-1 text-[11px] text-[#374151]">
                                카테고리: {tooltip.category}
                            </p>
                            <p className="text-[11px] text-[#374151]">
                                조회수: {tooltip.metricText}
                            </p>
                            <p className="text-[11px] text-[#6b7280]">
                                비중: {tooltip.percentText}
                            </p>
                        </div>
                    ) : null}
                    {visibleTreemapCells.map((cell) => {
                        const width = Math.max(0, cell.x1 - cell.x0);
                        const height = Math.max(0, cell.y1 - cell.y0);
                        const area = width * height;
                        const hasText = area >= 1200 && width >= 32 && height >= 28;
                        const hasMetric = area >= 1600 && width >= 44 && height >= 32;
                        const hasPercent = area >= 2800 && width >= 58 && height >= 42;
                        const isRenderable = width > 2 && height > 2;

                        if (!isRenderable) return null;

                        const titleMaxLength = Math.max(5, Math.min(24, Math.floor(Math.sqrt(area) / 3.3)));
                        const shortTitle = hasText
                            ? (cell.node.title.length > titleMaxLength
                                ? `${cell.node.title.slice(0, Math.max(5, titleMaxLength - 1))}…`
                                : cell.node.title)
                            : '';

                        const titleFont = hasText ? Math.max(9, Math.min(12, Math.floor(Math.sqrt(area) / 16))) : 0;
                        const metricFont = hasMetric ? Math.max(8, Math.min(11, Math.floor(Math.sqrt(area) / 19))) : 0;
                        const percentFont = hasPercent ? Math.max(7, Math.min(9, Math.floor(Math.sqrt(area) / 22))) : 0;

                        return (
                            <div
                                key={`${cell.node.id}-${cell.x0}-${cell.y0}`}
                                className="absolute flex flex-col justify-end border border-white/35 px-1.5 py-1 text-white overflow-hidden"
                                onPointerMove={(event) => updateTooltip(event, cell)}
                                onPointerEnter={(event) => updateTooltip(event, cell)}
                                onPointerLeave={clearTooltip}
                                onPointerDown={(event) => updateTooltip(event, cell)}
                                style={{
                                    left: cell.x0,
                                    top: cell.y0,
                                    width,
                                    height,
                                    backgroundColor: cell.node.color,
                                    color: '#f8fafc',
                                }}
                            >
                                {hasText ? (
                                    <p
                                        style={{ fontSize: `${titleFont}px` }}
                                        className="truncate leading-tight font-semibold"
                                        title={cell.node.title}
                                    >
                                        {shortTitle}
                                    </p>
                                ) : null}
                                {hasMetric ? (
                                    <p
                                        style={{ fontSize: `${metricFont}px` }}
                                        className="font-bold leading-tight"
                                    >
                                        {cell.node.metricText}
                                    </p>
                                ) : null}
                                {hasPercent ? (
                                    <p
                                        style={{ fontSize: `${percentFont}px` }}
                                        className="leading-tight text-white/90"
                                    >
                                        {cell.node.percentText}
                                    </p>
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

function deserializeConversationList(raw: PersistedChatState | null): {
    conversations: ChatConversation[];
    activeConversationId: string;
} | null {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.conversations) || raw.conversations.length === 0) {
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
                        createdAt: Number.isNaN(parsedCreatedAt.getTime()) ? new Date() : parsedCreatedAt,
                        meta: message.meta,
                        visualComponent: message.visualComponent,
                    };
                });

            return {
                id: conversation.id,
                title: conversation.title,
                messages,
                createdAt: conversation.createdAt ?? Date.now(),
                updatedAt: conversation.updatedAt ?? Date.now(),
                isBooting: false,
                bootstrapFailed: Boolean(conversation.bootstrapFailed),
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

function serializeConversationList(conversations: ChatConversation[], activeConversationId: string): PersistedChatState {
    return {
        version: 1,
        activeConversationId,
        conversations: conversations.slice(-MAX_CONVERSATIONS).map((conversation) => ({
            id: conversation.id,
            title: conversation.title,
            messages: conversation.messages.map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                sources: message.sources,
                createdAt: message.createdAt.toISOString(),
                meta: message.meta,
                visualComponent: message.visualComponent,
            })),
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            isBooting: conversation.isBooting,
            bootstrapFailed: conversation.bootstrapFailed,
        })),
    };
}

function createInitialConversation(id: string): ChatConversation {
    return {
        id,
        title: EMPTY_TITLE,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isBooting: false,
        bootstrapFailed: false,
    };
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

const SourceList = memo(({ sources }: { sources: InsightChatSource[] }) => {
    if (sources.length === 0) return null;

    return (
        <div className="mt-3 border-t border-[#e5e7eb] pt-2">
            <p className="text-xs text-[#6b7280] mb-2">참고 자료</p>
            <div className="space-y-1">
                {sources.map((source, idx) => (
                    <a
                        key={`${source.videoTitle}-${idx}`}
                        href={source.youtubeLink || '#'}
                        target={source.youtubeLink ? '_blank' : undefined}
                        rel={source.youtubeLink ? 'noopener noreferrer' : undefined}
                        className={cn(
                            'flex flex-wrap gap-1 text-xs leading-4 min-w-0 break-words',
                            source.youtubeLink
                                ? 'text-[#ef4444] hover:underline'
                                : 'text-[#6b7280]',
                        )}
                    >
                        <span className="font-medium break-words">{source.videoTitle || '스토리보드 참고 소스'}</span>
                        <span className="text-[#6b7280] break-words">({source.timestamp || '-'})</span>
                        {source.text ? <span className="text-[#374151] truncate">: {source.text}</span> : null}
                    </a>
                ))}
            </div>
        </div>
    );
});
SourceList.displayName = 'SourceList';
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



const ChatBubble = memo(({ message }: { message: ChatMessage }) => {
    const isUser = message.role === 'user';
    const isTreemapMessage = message.visualComponent === 'treemap';
    const maxWidthClass = isUser ? 'max-w-[84%]' : isTreemapMessage ? 'w-full max-w-full' : 'max-w-[84%]';
    const textWrapClass = isTreemapMessage ? 'w-full' : 'w-full';

    return (
        <div className={cn(
            'flex gap-2.5 mb-4 min-w-0',
            isUser ? 'flex-row-reverse' : 'flex-row',
            isTreemapMessage ? 'w-full' : 'w-auto',
        )}>
            <div
                className={cn(
                    'h-8 w-8 rounded-full grid place-items-center text-white text-xs shrink-0',
                    isUser ? 'bg-[#ef4444]' : 'bg-[#111827]',
                )}
            >
                {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            </div>

            <div
                className={cn(
                    maxWidthClass,
                    'rounded-xl px-3.5 py-2.5 border border-[#e5e7eb] min-w-0 break-words',
                    isTreemapMessage ? 'overflow-visible' : 'overflow-hidden',
                isUser ? 'bg-[#fde68a] text-[#111827]' : 'bg-white text-[#111827]',
                )}
            >
                {isUser ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                ) : message.content ? (
                    <div className={textWrapClass}>
                        <MarkdownRenderer
                            content={message.content}
                            components={CHAT_BUBBLE_MARKDOWN_COMPONENTS}
                            className="text-sm leading-6 break-words"
                            plainTextClassName="whitespace-pre-wrap break-words text-sm leading-6"
                        />
                    </div>
                ) : (
                    <p className="text-sm text-[#6b7280]">응답 생성 중...</p>
                )}
                {message.visualComponent === 'treemap' ? <InsightChatTreemap /> : null}
                <div className={textWrapClass}>
                    {message.meta?.source ? (
                        <p className="text-[11px] text-[#6b7280] mt-1.5">
                            응답 유형: {message.meta.source}
                            {message.meta.fallbackReason ? ` · 사유: ${message.meta.fallbackReason}` : null}
                        </p>
                    ) : null}
                    {message.sources ? <SourceList sources={message.sources} /> : null}
                </div>
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
    const [messageWindowSize, setMessageWindowSize] = useState(MESSAGE_WINDOW_INITIAL);
    const [sendingConversationId, setSendingConversationId] = useState<string | null>(null);
    const bootstrapRequestRef = useRef(new Map<string, number>());

    const [llmKeys, setLlmKeys] = useState<StoredLlmKeys>({});
    const [activeModelId, setActiveModelId] = useState<string>('gemini-3-flash-preview');
    const [enabledModelIds, setEnabledModelIds] = useState<Set<string>>(LLM_DEFAULT_ENABLED);
    const [imageModelProfile, setImageModelProfile] = useState<ImageModelSelection>('none');
    const [showSettings, setShowSettings] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [showImageModelDropdown, setShowImageModelDropdown] = useState(false);
    const [showConversationList, setShowConversationList] = useState(false);
    const [keyVisibility, setKeyVisibility] = useState<Partial<Record<LlmProvider, boolean>>>({});
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const imageModelDropdownRef = useRef<HTMLDivElement>(null);

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
                const data = (await resp.json()) as { geminiEnvKey: string | null };
                if (data.geminiEnvKey) {
                    setLlmKeys((prev) => {
                        if (prev.gemini) return prev; // 사용자 설정 우선
                        const next = { ...prev, gemini: data.geminiEnvKey! };
                        return next;
                    });
                }
            } catch { /* ignore */ }
        })();
    }, []);

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
    const activeProviderKey = llmKeys[activeModel.provider] || '';
    const activeImageModelProfile = useMemo(
        () => IMAGE_MODEL_PROFILES.find((profile) => profile.id === imageModelProfile) ?? IMAGE_MODEL_PROFILES[0],
        [imageModelProfile],
    );

    const availableModels = useMemo(() => {
        return LLM_MODELS.filter((m) => enabledModelIds.has(m.id)).map((model) => ({
            ...model,
            hasKey: Boolean(llmKeys[model.provider]),
        }));
    }, [llmKeys, enabledModelIds]);

    const currentLlmConfig = useMemo(() => {
        if (!activeProviderKey) return undefined;
        const resolvedImageModelProfile = imageModelProfile === 'none' ? undefined : imageModelProfile;
        return {
            provider: activeModel.provider,
            model: activeModel.id,
            apiKey: activeProviderKey,
            ...(resolvedImageModelProfile ? { storyboardModelProfile: resolvedImageModelProfile } : {}),
            ...(resolvedImageModelProfile ? { imageModelProfile: resolvedImageModelProfile } : {}),
        };
    }, [activeModel, activeProviderKey, imageModelProfile]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
                setShowModelDropdown(false);
            }

            if (imageModelDropdownRef.current && !imageModelDropdownRef.current.contains(e.target as Node)) {
                setShowImageModelDropdown(false);
            }
        };
        if (showModelDropdown || showImageModelDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showModelDropdown, showImageModelDropdown]);

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

    const conversationList = useMemo(
        () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
        [conversations],
    );

    const visibleMessages = useMemo(() => {
        if (!activeConversation) return [];
        const total = activeConversation.messages.length;
        if (total <= 0) return [];

        const start = Math.max(0, total - Math.min(total, messageWindowSize));
        return activeConversation.messages.slice(start, total);
    }, [activeConversation, messageWindowSize]);

    const canShowMoreMessages = !!activeConversation && activeConversation.messages.length > messageWindowSize;

    const persistConversationState = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (conversations.length === 0) return;

        try {
            const payload = serializeConversationList(conversations, activeConversationId);
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // localStorage unavailable or full
        }
    }, [activeConversationId, conversations]);

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

    const loadBootstrap = useCallback(async (conversationId: string): Promise<void> => {
        const requestId = (bootstrapRequestRef.current.get(conversationId) ?? 0) + 1;
        bootstrapRequestRef.current.set(conversationId, requestId);

        updateConversation(conversationId, (prev) => ({
            ...prev,
            isBooting: true,
            bootstrapFailed: false,
        }));

        try {
            const bootstrap = await fetchChatBootstrap();

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
            id: makeConversationId(),
            title,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isBooting: true,
            bootstrapFailed: false,
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

        setMessageWindowSize(Math.min(MESSAGE_WINDOW_INITIAL, activeConversation.messages.length || MESSAGE_WINDOW_INITIAL));
    }, [activeConversationId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeConversation?.messages.length, activeConversationId]);

    useEffect(() => {
        persistConversationState();
    }, [conversations, activeConversationId, persistConversationState]);

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
        const remaining = conversations.filter((c) => c.id !== conversationId);
        if (remaining.length === 0) {
            createConversation();
        }
        setConversations((prev) => {
            const next = prev.filter((c) => c.id !== conversationId);
            return next.length > 0 ? next : prev;
        });
        if (activeConversationId === conversationId) {
            if (remaining.length > 0) {
                setActiveConversationId(remaining[0].id);
            }
        }
    }, [activeConversationId, conversations, createConversation]);

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

    const handleSendMessage = useCallback(async () => {
        const content = inputValue.trim();
        if (!activeConversation || !content || sendingConversationId === activeConversation.id) return;

        const userMessage: ChatMessage = {
            id: makeId('user'),
            role: 'user',
            content,
            createdAt: new Date(),
        };

        appendMessage(activeConversation.id, userMessage);
        setInputValue('');
        setSendingConversationId(activeConversation.id);

        const convId = activeConversation.id;

        try {
            if (currentLlmConfig) {
                const assistantId = makeId('assistant');
                appendMessage(convId, {
                    id: assistantId,
                    role: 'assistant',
                    content: '',
                    createdAt: new Date(),
                    meta: { source: currentLlmConfig.provider as 'gemini' | 'openai' | 'anthropic', model: currentLlmConfig.model },
                });

                const localResponse = await postStreamChat(
                    content,
                    currentLlmConfig,
                    (token) => updateMessageContent(convId, assistantId, (prev) => prev + token),
                );

                if (localResponse) {
                    updateMessage(convId, assistantId, (message) => ({
                        ...message,
                        content: localResponse.content,
                        sources: mapSources(localResponse.sources),
                        visualComponent: localResponse.visualComponent,
                        meta: localResponse.meta,
                    }));
                }
            } else {
                const resolvedImageModelProfile = imageModelProfile === 'none' ? undefined : imageModelProfile;
                const response = await postChatMessage(content, undefined, resolvedImageModelProfile);
                appendMessage(convId, {
                    id: makeId('assistant'),
                    role: 'assistant',
                    content: response.content,
                    sources: mapSources(response.sources),
                    visualComponent: response.visualComponent,
                    createdAt: new Date(),
                    meta: response.meta,
                });
            }
        } catch {
            appendMessage(convId, {
                id: makeId('assistant'),
                role: 'assistant',
                content: '응답을 전송하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
                createdAt: new Date(),
                meta: {
                    source: 'fallback',
                    fallbackReason: 'request_failed',
                },
            });
        } finally {
            setSendingConversationId(null);
            inputRef.current?.focus();
        }
    }, [activeConversation, appendMessage, updateMessage, updateMessageContent, inputValue, sendingConversationId, currentLlmConfig, imageModelProfile]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSendMessage();
        }
    }, [handleSendMessage]);

    const isSending = sendingConversationId === activeConversationId;

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
                            className={cn('mt-2 h-9 w-9 p-0 border-[#e5e7eb]', showSettings && 'bg-[#f3f4f6]')}
                            onClick={() => setShowSettings((prev) => !prev)}
                            title="LLM 설정"
                        >
                            <Settings className="h-4 w-4" />
                        </Button>
                    </div>
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
                                    ) : (
                                        <p className="text-[10px] text-[#9ca3af]">
                                            {provider === 'gemini' ? '서버 키 로드 중...' : '미설정'}
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
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteConversation(conversation.id);
                                            }}
                                            className="absolute top-1/2 -translate-y-1/2 right-2 h-6 w-6 grid place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] transition-opacity"
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
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 bg-white">
                    {activeConversation?.bootstrapFailed ? (
                        <div className="min-h-[360px] flex flex-col items-center justify-center text-center px-4 gap-2">
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
                                <div className="min-h-[360px] flex items-center justify-center text-sm text-[#6b7280]">

                                </div>
                            ) : (
                                <>
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

                                    {visibleMessages.map((message) => (
                                        <ChatBubble key={message.id} message={message} />
                                    ))}
                                </>
                            )}

                            {isSending && !currentLlmConfig ? (
                            <div className="flex gap-2.5 mb-3">
                                    <div className="h-8 w-8 rounded-full grid place-items-center text-white text-xs bg-[#111827]">
                                        <Bot className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="max-w-[84%] rounded-xl px-3.5 py-2.5 border border-[#e5e7eb] break-words min-w-0">
                                        <p className="text-sm text-[#111827] font-medium">응답 생성 중...</p>
                                    </div>
                                </div>
                            ) : null}

                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>

                <div className="border-t border-[#e5e7eb] px-3 py-3 bg-white">
                    <div className="mb-2 flex flex-wrap gap-2 items-center">
                        <div ref={modelDropdownRef} className="relative">
                            <button
                                type="button"
                                className={cn(
                                    'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-white',
                                    activeProviderKey
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
                                        return (
                                            <div key={provider}>
                                                <p className="px-3 py-1.5 text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wider">
                                                    {LLM_PROVIDER_LABELS[provider]}
                                                    {!llmKeys[provider] && <span className="ml-1 text-[#fca5a5]">키 미설정</span>}
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

                        <div ref={imageModelDropdownRef} className="relative">
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

                        {SUGGESTED_PROMPTS.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e5e7eb] bg-white text-[#374151] hover:bg-[#fff7ed]"
                                onClick={() => setInputValue(prompt)}
                                disabled={!!activeConversation?.isBooting || !!sendingConversationId}
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleSendMessage();
                        }}
                        className="flex gap-2"
                    >
                        <Input
                            ref={inputRef}
                            value={inputValue}
                            onChange={(event) => setInputValue(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="예: 먹방 스토리보드 기획안 짜줘"
                            disabled={!!activeConversation?.isBooting || !!isSending}
                            className="h-11 border-[#e5e7eb] focus-visible:ring-[#f87171]"
                        />
                        <Button
                            type="submit"
                            className="h-11"
                            disabled={!inputValue.trim() || !!activeConversation?.isBooting || !!isSending}
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
