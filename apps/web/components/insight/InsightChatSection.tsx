'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
    AdminInsightChatBootstrapResponse,
    AdminInsightChatResponse,
    AdminInsightHeatmapResponse,
    AdminInsightSeasonResponse,
    AdminInsightWordcloudResponse,
    InsightChatSource,
    InsightHeatmapDataPoint,
    InsightVisualComponentType,
} from '@/types/insight';
import type { DashboardSummaryResponse } from '@/types/dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toKoreanKeywordLabel } from '@/lib/insight/keyword-label';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Bot,
    Calendar,
    ExternalLink,
    Loader2,
    MessageSquare,
    Plus,
    Send,
    Sparkles,
    TrendingUp,
    User,
    BarChart3,
} from 'lucide-react';

type VisualComponentType = InsightVisualComponentType;

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: InsightChatSource[];
    visualComponent?: VisualComponentType;
    createdAt: Date;
};

type ChatSession = {
    id: string;
    title: string;
    createdAt: Date;
    messages: ChatMessage[];
};

function makeId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fetchChatBootstrap(): Promise<AdminInsightChatBootstrapResponse> {
    const response = await fetch('/api/admin/insight/chat/bootstrap');
    if (!response.ok) throw new Error('인사이트 채팅 초기 데이터를 가져오지 못했습니다');
    return response.json() as Promise<AdminInsightChatBootstrapResponse>;
}

async function postChatMessage(message: string): Promise<AdminInsightChatResponse> {
    const response = await fetch('/api/admin/insight/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
    });
    if (!response.ok) throw new Error('메시지를 전송하지 못했습니다');
    return response.json() as Promise<AdminInsightChatResponse>;
}

async function fetchWordcloud(): Promise<AdminInsightWordcloudResponse> {
    const response = await fetch('/api/admin/insight/wordcloud');
    if (!response.ok) throw new Error('워드클라우드 데이터를 가져오지 못했습니다');
    return response.json() as Promise<AdminInsightWordcloudResponse>;
}

async function fetchSeason(): Promise<AdminInsightSeasonResponse> {
    const response = await fetch('/api/admin/insight/season');
    if (!response.ok) throw new Error('시즌 데이터를 가져오지 못했습니다');
    return response.json() as Promise<AdminInsightSeasonResponse>;
}

async function fetchHeatmap(): Promise<AdminInsightHeatmapResponse> {
    const response = await fetch('/api/admin/insight/heatmap');
    if (!response.ok) throw new Error('히트맵 데이터를 가져오지 못했습니다');
    return response.json() as Promise<AdminInsightHeatmapResponse>;
}

async function fetchDashboardSummary(): Promise<DashboardSummaryResponse> {
    const response = await fetch('/api/dashboard/summary');
    if (!response.ok) throw new Error('대시보드 요약 데이터를 가져오지 못했습니다');
    return response.json() as Promise<DashboardSummaryResponse>;
}

function buildHeatmapBars(points: InsightHeatmapDataPoint[], buckets: number): number[] {
    if (points.length === 0) return [];
    const binSize = Math.max(1, Math.floor(100 / buckets));
    const sums = new Array(buckets).fill(0);
    const counts = new Array(buckets).fill(0);

    for (const p of points) {
        const idx = Math.min(buckets - 1, Math.max(0, Math.floor(p.position / binSize)));
        sums[idx] += p.engagement;
        counts[idx] += 1;
    }

    return sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
}

const MiniWordCloud = memo(() => {
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-insight-wordcloud-mini'],
        queryFn: fetchWordcloud,
        staleTime: 1000 * 60 * 5,
    });

    if (isLoading) {
        return (
            <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return null;
    }

    const top = (data?.keywords ?? []).slice(0, 10);
    if (top.length === 0) return null;

    return (
        <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
            <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <span className="text-xs font-medium">인기 키워드</span>
            </div>
            <div className="flex flex-wrap gap-1">
                {top.map((k) => (
                            <span
                                key={k.keyword}
                                className="px-1.5 py-0.5 rounded bg-secondary/50 text-[10px] text-muted-foreground"
                                title={`${k.count}`}
                            >
                                {toKoreanKeywordLabel(k.keyword)}
                            </span>
                        ))}
                    </div>
        </div>
    );
});
MiniWordCloud.displayName = 'MiniWordCloud';

const MiniCalendar = memo(() => {
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-insight-season-mini'],
        queryFn: fetchSeason,
        staleTime: 1000 * 60 * 5,
    });

    if (isLoading) {
        return (
            <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) return null;

    const now = new Date();
    const month = now.getMonth() + 1;
    const monthData = data?.months?.find((m) => m.month === month);
    const keywords = monthData?.keywords?.slice(0, 3) ?? [];
    if (keywords.length === 0) return null;

    return (
        <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
            <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-blue-500" />
                <span className="text-xs font-medium">{month}월 시즌 추천</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {keywords.map((k) => (
                    <div key={k.keyword} className="text-center p-1.5 bg-secondary/50 rounded">
                        <div className="text-lg">{k.icon}</div>
                        <div className="text-[10px] font-medium truncate">{k.keyword}</div>
                        <div className="text-[8px] text-muted-foreground truncate">{k.recommendedUploadDate}</div>
                    </div>
                ))}
            </div>
        </div>
    );
});
MiniCalendar.displayName = 'MiniCalendar';

const MiniHeatmap = memo(() => {
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin-insight-heatmap-mini'],
        queryFn: fetchHeatmap,
        staleTime: 1000 * 60 * 5,
    });

    if (isLoading) {
        return (
            <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) return null;

    const top = data?.videos?.[0];
    if (!top) return null;

    const bars = buildHeatmapBars(top.heatmapData ?? [], 20);
    const max = Math.max(...bars, 0.001);

    return (
        <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-red-500" />
                    <span className="text-xs font-medium">히트맵 요약</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                    {top.peakSegment.start}%~{top.peakSegment.end}%
                </span>
            </div>
            <div className="flex gap-0.5 h-8">
                {bars.map((v, i) => (
                    <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{ backgroundColor: `rgba(239, 68, 68, ${Math.max(0.12, v / max)})` }}
                        title={`${Math.round(v * 100)}%`}
                    />
                ))}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground line-clamp-1" title={top.title}>
                {top.title}
            </div>
        </div>
    );
});
MiniHeatmap.displayName = 'MiniHeatmap';

const MiniStats = memo(() => {
    const { data, isLoading, error } = useQuery({
        queryKey: ['dashboard-summary-mini'],
        queryFn: fetchDashboardSummary,
        staleTime: 1000 * 60 * 5,
    });

    if (isLoading) {
        return (
            <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) return null;

    if (!data) return null;

    return (
        <div className="bg-secondary/30 rounded-lg p-3 mt-2 border border-border/30">
            <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-medium">운영 요약</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-secondary/50 rounded p-2">
                    <div className="text-[10px] text-muted-foreground">맛집</div>
                    <div className="font-semibold">{data.totals.restaurants.toLocaleString()}</div>
                </div>
                <div className="bg-secondary/50 rounded p-2">
                    <div className="text-[10px] text-muted-foreground">영상</div>
                    <div className="font-semibold">{data.totals.videos.toLocaleString()}</div>
                </div>
                <div className="bg-secondary/50 rounded p-2">
                    <div className="text-[10px] text-muted-foreground">좌표</div>
                    <div className="font-semibold">{data.totals.withCoordinates.toLocaleString()}</div>
                </div>
            </div>
        </div>
    );
});
MiniStats.displayName = 'MiniStats';

const VisualComponentRenderer = memo(({ type }: { type: VisualComponentType }) => {
    switch (type) {
        case 'wordcloud':
            return <MiniWordCloud />;
        case 'calendar':
            return <MiniCalendar />;
        case 'heatmap':
            return <MiniHeatmap />;
        case 'stats':
            return <MiniStats />;
        default:
            return null;
    }
});
VisualComponentRenderer.displayName = 'VisualComponentRenderer';

const ChatMessageBubble = memo(({ message }: { message: ChatMessage }) => {
    const isUser = message.role === 'user';

    return (
        <div className={cn(
            "flex gap-3 mb-5 animate-in fade-in slide-in-from-bottom-2 duration-300",
            isUser ? "flex-row-reverse" : "flex-row"
        )}>
            <div className={cn(
                "h-9 w-9 rounded-full flex items-center justify-center shrink-0 shadow-lg",
                isUser
                    ? "bg-gradient-to-br from-primary to-primary/80 ring-2 ring-primary/20"
                    : "bg-gradient-to-br from-violet-500 to-purple-600 ring-2 ring-violet-500/20"
            )}>
                {isUser ? (
                    <User className="h-4 w-4 text-primary-foreground" />
                ) : (
                    <Bot className="h-4 w-4 text-white" />
                )}
            </div>
            <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 shadow-md transition-all hover:shadow-lg",
                isUser
                    ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground"
                    : "bg-gradient-to-br from-secondary/80 to-secondary/50 text-foreground border border-border/30"
            )}>
                {isUser ? (
                    <p className="text-sm font-medium whitespace-pre-wrap">{message.content}</p>
                ) : (
                    <div className="prose prose-sm prose-invert max-w-none
                        [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-2 [&_h2]:text-foreground
                        [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-foreground
                        [&_p]:text-sm [&_p]:mb-2 [&_p]:text-foreground/90 [&_p]:leading-relaxed
                        [&_ul]:text-sm [&_ul]:mb-2 [&_ul]:pl-4
                        [&_ol]:text-sm [&_ol]:mb-2 [&_ol]:pl-4
                        [&_li]:mb-1 [&_li]:text-foreground/90
                        [&_strong]:text-primary [&_strong]:font-semibold
                        [&_table]:w-full [&_table]:text-xs [&_table]:mb-3
                        [&_table]:border-collapse [&_table]:rounded-lg [&_table]:overflow-hidden
                        [&_th]:bg-primary/20 [&_th]:text-foreground [&_th]:font-medium
                        [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:border-b [&_th]:border-border/50
                        [&_td]:px-2 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border/30 [&_td]:text-foreground/80
                        [&_tr:hover]:bg-primary/5
                        [&_hr]:border-border/50 [&_hr]:my-3
                        [&_a]:text-blue-400 [&_a]:no-underline hover:[&_a]:underline
                        [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
                    ">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                        </ReactMarkdown>
                    </div>
                )}

                {message.visualComponent && (
                    <VisualComponentRenderer type={message.visualComponent} />
                )}

                {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/30">
                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> 참고 자료
                        </p>
                        <div className="space-y-1">
                            {message.sources.map((source, idx) => (
                                <a
                                    key={idx}
                                    href={source.youtubeLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 rounded px-2 py-1 hover:bg-blue-500/20"
                                >
                                    {source.videoTitle} ({source.timestamp})
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});
ChatMessageBubble.displayName = 'ChatMessageBubble';

const SessionListItem = memo(({
    session,
    isActive,
    onClick,
}: {
    session: ChatSession;
    isActive: boolean;
    onClick: () => void;
}) => (
    <button
        onClick={onClick}
        className={cn(
            "w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 text-sm group",
            isActive
                ? "bg-gradient-to-r from-primary/20 to-violet-500/10 text-primary border border-primary/30 shadow-sm"
                : "hover:bg-secondary/70 text-muted-foreground hover:text-foreground border border-transparent"
        )}
    >
        <div className="flex items-center gap-2">
            <MessageSquare className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
            )} />
            <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{session.title}</p>
                <p className="text-[10px] opacity-60">
                    {session.createdAt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                </p>
            </div>
        </div>
    </button>
));
SessionListItem.displayName = 'SessionListItem';

const InsightChatSectionComponent = () => {
    const bootstrapQuery = useQuery({
        queryKey: ['admin-insight-chat-bootstrap'],
        queryFn: fetchChatBootstrap,
        staleTime: 1000 * 60 * 5,
    });

    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string>('');
    const [inputValue, setInputValue] = useState('');
    const [isSending, setIsSending] = useState(false);

    const didInitRef = useRef(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const bootstrapMessage = bootstrapQuery.data?.message;

    useEffect(() => {
        if (didInitRef.current) return;
        if (!bootstrapMessage) return;
        didInitRef.current = true;

        const initialAssistantMessage: ChatMessage = {
            id: makeId('bootstrap'),
            role: 'assistant',
            content: bootstrapMessage.content,
            sources: (bootstrapMessage.sources ?? []) as InsightChatSource[],
            visualComponent: bootstrapMessage.visualComponent,
            createdAt: new Date(),
        };

        const initialSession: ChatSession = {
            id: makeId('session'),
            title: '종합 인사이트',
            createdAt: new Date(),
            messages: [initialAssistantMessage],
        };

        setSessions([initialSession]);
        setActiveSessionId(initialSession.id);
    }, [bootstrapMessage]);

    const activeSession = useMemo(
        () => sessions.find((s) => s.id === activeSessionId),
        [activeSessionId, sessions],
    );

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [activeSession?.messages.length, scrollToBottom]);

    const handleNewSession = useCallback(() => {
        const initialAssistantMessage: ChatMessage | null = bootstrapMessage ? {
            id: makeId('bootstrap'),
            role: 'assistant',
            content: bootstrapMessage.content,
            sources: (bootstrapMessage.sources ?? []) as InsightChatSource[],
            visualComponent: bootstrapMessage.visualComponent,
            createdAt: new Date(),
        } : null;

        const newSession: ChatSession = {
            id: makeId('session'),
            title: '새 대화',
            createdAt: new Date(),
            messages: initialAssistantMessage ? [initialAssistantMessage] : [],
        };

        setSessions((prev) => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        setInputValue('');
        inputRef.current?.focus();
    }, [bootstrapMessage]);

    const handleSendMessage = useCallback(async () => {
        const content = inputValue.trim();
        if (!content || !activeSessionId || isSending) return;

        const userMessage: ChatMessage = {
            id: makeId('msg'),
            role: 'user',
            content,
            createdAt: new Date(),
        };

        setSessions((prev) => prev.map((session) => {
            if (session.id !== activeSessionId) return session;

            const hasUserMessage = session.messages.some((m) => m.role === 'user');
            const nextTitle = hasUserMessage
                ? session.title
                : (content.length > 20 ? `${content.slice(0, 20)}...` : content);

            return {
                ...session,
                title: session.title === '새 대화' ? nextTitle : session.title,
                messages: [...session.messages, userMessage],
            };
        }));

        setInputValue('');
        setIsSending(true);

        try {
            const data = await postChatMessage(content);

            const assistantMessage: ChatMessage = {
                id: makeId('msg'),
                role: 'assistant',
                content: data.content,
                sources: (data.sources ?? []) as InsightChatSource[],
                visualComponent: data.visualComponent,
                createdAt: new Date(),
            };

            setSessions((prev) => prev.map((session) =>
                session.id === activeSessionId
                    ? { ...session, messages: [...session.messages, assistantMessage] }
                    : session
            ));
        } catch {
            const assistantMessage: ChatMessage = {
                id: makeId('msg'),
                role: 'assistant',
                content: '응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
                createdAt: new Date(),
            };

            setSessions((prev) => prev.map((session) =>
                session.id === activeSessionId
                    ? { ...session, messages: [...session.messages, assistantMessage] }
                    : session
            ));
        } finally {
            setIsSending(false);
        }
    }, [activeSessionId, inputValue, isSending]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    }, [handleSendMessage]);

    const suggestions = [
        '인기 키워드 보여줘',
        '이번달 시즌 키워드 추천해줘',
        '히트맵 요약해줘',
        '운영 지표 요약',
    ];

    return (
        <Card className="h-full border-primary/20 bg-gradient-to-br from-card to-primary/5">
            <CardContent className="h-full p-4">
                <div className="flex gap-4 h-full">
                    <div className="w-56 shrink-0 border-r border-border pr-4 flex flex-col">
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full mb-3 gap-2"
                            onClick={handleNewSession}
                        >
                            <Plus className="h-4 w-4" />
                            새 대화
                        </Button>
                        <ScrollArea className="flex-1">
                            <div className="space-y-2">
                                {sessions.map((session) => (
                                    <SessionListItem
                                        key={session.id}
                                        session={session}
                                        isActive={session.id === activeSessionId}
                                        onClick={() => setActiveSessionId(session.id)}
                                    />
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    <div className="flex-1 flex flex-col min-w-0">
                        <ScrollArea className="flex-1 pr-4">
                            <div className="py-2">
                                {bootstrapQuery.isLoading && sessions.length === 0 ? (
                                    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        인사이트를 준비 중입니다...
                                    </div>
                                ) : activeSession?.messages?.length ? (
                                    activeSession.messages.map((message) => (
                                        <ChatMessageBubble key={message.id} message={message} />
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
                                        <div className="h-20 w-20 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-6">
                                            <MessageSquare className="h-10 w-10 text-primary/50" />
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2">인사이트 분석을 시작하세요</h3>
                                        <p className="text-muted-foreground text-sm mb-6">
                                            DB에 적재된 쯔양 자막/메타 데이터 기반으로<br />
                                            요약과 추천을 제공합니다.
                                        </p>
                                        <div className="flex flex-wrap gap-2 justify-center max-w-md">
                                            {suggestions.map((suggestion) => (
                                                <Button
                                                    key={suggestion}
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-xs"
                                                    onClick={() => {
                                                        setInputValue(suggestion);
                                                        inputRef.current?.focus();
                                                    }}
                                                >
                                                    {suggestion}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {isSending && (
                                    <div className="flex gap-3 mb-5">
                                        <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 shadow-lg bg-gradient-to-br from-violet-500 to-purple-600 ring-2 ring-violet-500/20">
                                            <Bot className="h-4 w-4 text-white" />
                                        </div>
                                        <div className="bg-gradient-to-br from-secondary/80 to-secondary/50 text-foreground border border-border/30 max-w-[85%] rounded-2xl px-4 py-3 shadow-md">
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                분석 중...
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </ScrollArea>

                        <div className="pt-3 border-t border-border/50">
                            <div className="flex gap-2">
                                <Input
                                    ref={inputRef}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="예: 인기 키워드 보여줘"
                                    disabled={!activeSessionId || isSending}
                                    className="h-11"
                                />
                                <Button
                                    onClick={handleSendMessage}
                                    disabled={!inputValue.trim() || !activeSessionId || isSending}
                                    className="h-11 px-4"
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const InsightChatSection = memo(InsightChatSectionComponent);
InsightChatSection.displayName = 'InsightChatSection';

export default InsightChatSection;
