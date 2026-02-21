'use client';

import { type ReactNode, KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Loader2, Send, User, PlusCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { AdminInsightChatBootstrapResponse, AdminInsightChatResponse, InsightChatSource } from '@/types/insight';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: InsightChatSource[];
    createdAt: Date;
    meta?: AdminInsightChatResponse['meta'];
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

const EMPTY_TITLE = '새 대화';
const CHAT_BOOTSTRAP_TTL_MS = 4 * 60 * 1000;
const CHAT_RESPONSE_TTL_MS = 3 * 60 * 1000;
const CHAT_REQUEST_TIMEOUT_MS = 18_000;
const CHAT_REQUEST_CACHE_LIMIT = 64;
const MAX_CONVERSATIONS = 30;
const CHAT_REQUEST_RETRY_ATTEMPTS = 1;
const CHAT_REQUEST_RETRY_BASE_DELAY_MS = 250;

type CachedEntry<T> = {
    data: T;
    expiresAt: number;
};

const chatBootstrapCache = new Map<string, CachedEntry<AdminInsightChatBootstrapResponse>>();
const chatResponseCache = new Map<string, CachedEntry<AdminInsightChatResponse>>();
const inFlightBootstrapRequest = new Map<string, Promise<AdminInsightChatBootstrapResponse>>();
const inFlightChatRequest = new Map<string, Promise<AdminInsightChatResponse>>();

const SUGGESTED_PROMPTS = [
    '먹방 스토리보드 기획안 짜줘',
    '인기 키워드 보여줘',
    '이번달 시즌 키워드 추천해줘',
    '히트맵 요약해줘',
    '운영 지표 요약',
];

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
    const shortened = shortText(content, 24);
    return shortened || '새 대화';
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

async function postChatMessage(message: string): Promise<AdminInsightChatResponse> {
    const normalizedMessage = normalizeCacheKey(message);
    const now = Date.now();
    const cached = chatResponseCache.get(normalizedMessage);
    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    const inFlight = inFlightChatRequest.get(normalizedMessage);
    if (inFlight) return inFlight;

    const request = (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= CHAT_REQUEST_RETRY_ATTEMPTS; attempt += 1) {
            try {
                return await fetchJsonWithTimeout<AdminInsightChatResponse>('/api/admin/insight/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message }),
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

    inFlightChatRequest.set(normalizedMessage, request);

    try {
        const response = await request;
        chatResponseCache.set(normalizedMessage, {
            data: response,
            expiresAt: now + CHAT_RESPONSE_TTL_MS,
        });
        trimCacheSize(chatResponseCache, CHAT_REQUEST_CACHE_LIMIT);
        return response;
    } finally {
        inFlightChatRequest.delete(normalizedMessage);
    }
}

function mapSources(rawSources: InsightChatSource[] | undefined): InsightChatSource[] {
    return (rawSources ?? []).filter((source) => Boolean(source.videoTitle || source.youtubeLink || source.timestamp || source.text));
}

const CHAT_BUBBLE_MARKDOWN_COMPONENTS = {
    h1: ({ children }: { children: ReactNode }) => <h2 className="text-base font-semibold mb-2 mt-3 first:mt-0">{children}</h2>,
    h2: ({ children }: { children: ReactNode }) => <h3 className="text-sm font-semibold mb-1 mt-2.5 first:mt-0">{children}</h3>,
    h3: ({ children }: { children: ReactNode }) => <h4 className="text-sm font-medium mb-1 mt-2.5 first:mt-0">{children}</h4>,
    p: ({ children }: { children: ReactNode }) => <p className="whitespace-pre-wrap text-sm leading-6">{children}</p>,
    ul: ({ children }: { children: ReactNode }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm leading-6">{children}</ul>,
    ol: ({ children }: { children: ReactNode }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm leading-6">{children}</ol>,
    li: ({ children }: { children: ReactNode }) => <li className="text-sm leading-6">{children}</li>,
    a: ({ children, href }: { children: ReactNode; href?: string }) => {
        const safeHref = href ?? '';
        const isExternal = /^https?:/i.test(safeHref);
        return (
            <a
                href={safeHref || '#'}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                className="text-[#ef4444] underline underline-offset-2 hover:no-underline"
            >
                {children}
            </a>
        );
    },
    table: ({ children }: { children: ReactNode }) => (
        <div className="my-2 overflow-x-auto">
            <table className="w-full text-sm border-collapse border border-[#e5e7eb]">{children}</table>
        </div>
    ),
    thead: ({ children }: { children: ReactNode }) => <thead className="bg-[#f9fafb]">{children}</thead>,
    th: ({ children }: { children: ReactNode }) => <th className="border border-[#e5e7eb] p-2 text-left text-[11px]">{children}</th>,
    td: ({ children }: { children: ReactNode }) => <td className="border border-[#e5e7eb] p-2 text-sm">{children}</td>,
    blockquote: ({ children }: { children: ReactNode }) => (
        <blockquote className="border-l-4 border-[#e5e7eb] pl-3 my-2 text-sm text-[#6b7280]">
            {children}
        </blockquote>
    ),
    pre: ({ children }: { children: ReactNode }) => (
        <pre className="overflow-x-auto rounded-md bg-[#f3f4f6] p-3 my-2 text-sm">{children}</pre>
    ),
    code: ({ children }: { children: ReactNode }) => <code className="rounded bg-[#f3f4f6] px-1 py-0.5 text-xs">{children}</code>,
};

const CHAT_PREVIEW_MARKDOWN_COMPONENTS = {
    p: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    em: ({ children }: { children: ReactNode }) => <span className="italic">{children}</span>,
    strong: ({ children }: { children: ReactNode }) => <span className="font-semibold">{children}</span>,
    code: ({ children }: { children: ReactNode }) => <code className="rounded bg-[#f3f4f6] px-1 py-0.5 text-[11px]">{children}</code>,
    ul: ({ children }: { children: ReactNode }) => <span className="inline">{children}</span>,
    ol: ({ children }: { children: ReactNode }) => <span className="inline">{children}</span>,
    li: ({ children }: { children: ReactNode }) => <span className="inline">{children}</span>,
    a: ({ children, href }: { children: ReactNode; href?: string }) => {
        const safeHref = href ?? '';
        const isExternal = /^https?:/i.test(safeHref);
        return (
            <a
                href={safeHref || '#'}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                className="text-[#ef4444] underline underline-offset-2 hover:no-underline"
            >
                {children}
            </a>
        );
    },
    blockquote: ({ children }: { children: ReactNode }) => <span className="text-[#6b7280]">{children}</span>,
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
                            'flex flex-wrap gap-1 text-xs leading-4',
                            source.youtubeLink
                                ? 'text-[#ef4444] hover:underline'
                                : 'text-[#6b7280]',
                        )}
                    >
                        <span className="font-medium">{source.videoTitle || '스토리보드 참고 소스'}</span>
                        <span className="text-[#6b7280]">({source.timestamp || '-'})</span>
                        {source.text ? <span className="text-[#374151] truncate">: {source.text}</span> : null}
                    </a>
                ))}
            </div>
        </div>
    );
});
SourceList.displayName = 'SourceList';

const ChatBubble = memo(({ message }: { message: ChatMessage }) => {
    const isUser = message.role === 'user';

    return (
        <div className={cn(
            'flex gap-2.5 mb-4',
            isUser ? 'flex-row-reverse' : 'flex-row',
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
                    'max-w-[84%] rounded-xl px-3.5 py-2.5 border border-[#e5e7eb]',
                    isUser ? 'bg-[#fde68a] text-[#111827]' : 'bg-white text-[#111827]',
                )}
            >
                {isUser ? (
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                ) : (
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={CHAT_BUBBLE_MARKDOWN_COMPONENTS}
                    >
                        {message.content}
                    </ReactMarkdown>
                )}
                {message.meta?.source ? (
                    <p className="text-[11px] text-[#6b7280] mt-1.5">
                        응답 유형: {message.meta.source}
                        {message.meta.fallbackReason ? ` · 사유: ${message.meta.fallbackReason}` : null}
                    </p>
                ) : null}
                {message.sources ? <SourceList sources={message.sources} /> : null}
            </div>
        </div>
    );
});
ChatBubble.displayName = 'ChatBubble';

const ChatSkeleton = memo(() => (
    <div className="h-full px-3 py-4 space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={cn('space-y-2', index % 2 === 0 ? 'items-end' : 'items-start', 'flex flex-col')}>
                <div className="flex items-center gap-2 w-full">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-3.5 w-16" />
                </div>
                <Skeleton className={cn('rounded-xl', index % 2 === 0 ? 'ml-auto' : '', 'h-20 max-w-[84%] w-80')} />
            </div>
        ))}
    </div>
));
ChatSkeleton.displayName = 'ChatSkeleton';

const ConversationPreview = memo(({ content }: { content: string }) => (
    <div className="overflow-hidden text-ellipsis whitespace-nowrap">
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={CHAT_PREVIEW_MARKDOWN_COMPONENTS}
        >
            {content}
        </ReactMarkdown>
    </div>
));
ConversationPreview.displayName = 'ConversationPreview';

const InsightChatSectionComponent = () => {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string>('');
    const [inputValue, setInputValue] = useState('');
    const [sendingConversationId, setSendingConversationId] = useState<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const bootstrapRequestRef = useRef(new Map<string, number>());

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

    const appendMessage = useCallback((conversationId: string, message: ChatMessage) => {
        updateConversation(conversationId, (prev) => {
            const isTitleDefault = prev.title === EMPTY_TITLE && message.role === 'user';
            return {
                ...prev,
                messages: [...prev.messages, message],
                title: isTitleDefault ? makeConversationTitle(message.content) : prev.title,
                updatedAt: Date.now(),
            };
        });
    }, [updateConversation]);

    useEffect(() => {
        if (isInitialized) return;

        const first = {
            id: makeConversationId(),
            title: EMPTY_TITLE,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isBooting: true,
            bootstrapFailed: false,
        };

        setConversations([first]);
        setActiveConversationId(first.id);
        setIsInitialized(true);
        void loadBootstrap(first.id);
    }, [isInitialized, loadBootstrap]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeConversation?.messages.length, activeConversationId]);

    const handleSelectConversation = useCallback((conversationId: string) => {
        setActiveConversationId(conversationId);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, []);

    const handleNewConversation = useCallback(() => {
        createConversation();
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [createConversation]);

    const handleRetryBootstrap = useCallback(() => {
        if (!activeConversation) return;
        void loadBootstrap(activeConversation.id);
    }, [activeConversation, loadBootstrap]);

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

        try {
            const response = await postChatMessage(content);
            appendMessage(activeConversation.id, {
                id: makeId('assistant'),
                role: 'assistant',
                content: response.content,
                sources: mapSources(response.sources),
                createdAt: new Date(),
                meta: response.meta,
            });
        } catch {
            appendMessage(activeConversation.id, {
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
    }, [activeConversation, appendMessage, inputValue, sendingConversationId]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSendMessage();
        }
    }, [handleSendMessage]);

    const isSending = sendingConversationId === activeConversationId;

    return (
        <section className="h-full min-h-0 flex overflow-hidden bg-white border border-[#e5e7eb]">
            <aside className="w-[292px] min-w-[240px] border-r border-[#e5e7eb] bg-[#fafafa] flex flex-col">
                <div className="p-3 border-b border-[#e5e7eb]">
                    <Button
                        type="button"
                        size="sm"
                        className="mt-2 h-9 w-full bg-[#111827] text-white hover:bg-[#27272a]"
                        onClick={handleNewConversation}
                    >
                        <PlusCircle className="h-4 w-4 mr-1.5" />
                        새 대화 시작
                    </Button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
                    {conversationList.length === 0 ? (
                        <p className="px-2 py-10 text-sm text-[#6b7280] text-center">새 대화를 준비 중입니다</p>
                    ) : (
                        conversationList.map((conversation) => {
                            const isActive = conversation.id === activeConversationId;
                            const latestMessage = conversation.messages.at(-1);
                            const preview = latestMessage
                                ? latestMessage.content
                                : conversation.bootstrapFailed
                                    ? '연결 실패. 새로고침 필요'
                                    : '메시지 로딩 준비 중';

                            return (
                                <button
                                    key={conversation.id}
                                    type="button"
                                    onClick={() => {
                                        handleSelectConversation(conversation.id);
                                    }}
                                    className={cn(
                                        'w-full text-left px-3 py-2 rounded-lg border',
                                        isActive
                                            ? 'border-[#fb7185] bg-white'
                                            : 'border-transparent hover:border-[#e5e7eb] hover:bg-white',
                                    )}
                                >
                                    <p className="font-medium text-sm text-[#111827] truncate">{conversation.title}</p>
                                    <div className="mt-1 text-xs text-[#6b7280] leading-relaxed overflow-hidden whitespace-nowrap text-ellipsis">
                                        <ConversationPreview content={preview} />
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            <section className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 bg-white">
                    {activeConversation?.isBooting ? (
                        <ChatSkeleton />
                    ) : activeConversation?.bootstrapFailed ? (
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
                                    메시지를 시작하려면 아래 입력창에서 질문을 입력해 주세요.
                                </div>
                            ) : (
                                activeConversation?.messages.map((message) => (
                                    <ChatBubble key={message.id} message={message} />
                                ))
                            )}

                            {isSending ? (
                                <div className="flex gap-2.5 mb-3">
                                    <div className="h-8 w-8 rounded-full grid place-items-center text-white text-xs bg-[#111827]">
                                        <Bot className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="max-w-[84%] rounded-xl px-3.5 py-2.5 border border-[#e5e7eb]">
                                        <div className="flex items-center gap-2 text-[#6b7280]">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            분석 중...
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>

                <div className="border-t border-[#e5e7eb] px-3 py-3 bg-white">
                    <div className="mb-2 flex flex-wrap gap-2">
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
        </section>
    );
};

const InsightChatSection = memo(InsightChatSectionComponent);
InsightChatSection.displayName = 'InsightChatSection';

export default InsightChatSection;
