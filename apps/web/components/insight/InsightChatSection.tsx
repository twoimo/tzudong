'use client';

import { KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, Loader2, Send, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

async function fetchChatBootstrap(): Promise<AdminInsightChatBootstrapResponse> {
    const response = await fetch('/api/admin/insight/chat/bootstrap');
    if (!response.ok) {
        throw new Error('인사이트 채팅 초기 데이터를 가져오지 못했습니다');
    }
    return response.json() as Promise<AdminInsightChatBootstrapResponse>;
}

async function postChatMessage(message: string): Promise<AdminInsightChatResponse> {
    const response = await fetch('/api/admin/insight/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
    });

    if (!response.ok) {
        const fallback = await response.json().catch(() => null);
        if (fallback && typeof fallback.content === 'string') {
            return fallback as AdminInsightChatResponse;
        }
        throw new Error('메시지를 전송하지 못했습니다');
    }

    return response.json() as Promise<AdminInsightChatResponse>;
}

function mapSources(rawSources: InsightChatSource[] | undefined): InsightChatSource[] {
    return (rawSources ?? []).filter((source) => Boolean(source.videoTitle || source.youtubeLink || source.timestamp || source.text));
}

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
                        {source.text ? <span className="text-[#374151] line-clamp-1">: {source.text}</span> : null}
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
            <div className={cn(
                'h-8 w-8 rounded-full grid place-items-center text-white text-xs shrink-0',
                isUser ? 'bg-[#ef4444]' : 'bg-[#111827]',
            )}>
                {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            </div>

            <div className={cn(
                'max-w-[84%] rounded-xl px-3.5 py-2.5 border border-[#e5e7eb]',
                isUser ? 'bg-[#fde68a] text-[#111827]' : 'bg-white text-[#111827]',
            )}>
                <p className="whitespace-pre-wrap text-sm leading-6">
                    {message.content}
                </p>
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

const InsightChatSectionComponent = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isBooting, setIsBooting] = useState(true);
    const [bootstrapFailed, setBootstrapFailed] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const loadBootstrap = useCallback(async (isCancelled: () => boolean): Promise<void> => {
        setIsBooting(true);
        setBootstrapFailed(false);

        try {
            const bootstrap = await fetchChatBootstrap();
            if (isCancelled()) return;

            setMessages([
                {
                    id: makeId('bootstrap'),
                    role: 'assistant',
                    content: bootstrap.message.content,
                    sources: mapSources(bootstrap.message.sources),
                    createdAt: new Date(),
                },
            ]);
        } catch (error) {
            if (isCancelled()) return;
            setBootstrapFailed(true);
            setMessages([
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
            ]);
        } finally {
            if (!isCancelled()) setIsBooting(false);
        }
    }, []);

    useEffect(() => {
        let isDone = false;
        const isCancelled = () => isDone;
        void loadBootstrap(() => isDone);

        return () => {
            isDone = true;
        };
    }, [loadBootstrap]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    const appendMessage = useCallback((message: ChatMessage) => {
        setMessages((prev) => [...prev, message]);
    }, []);

    const handleSendMessage = useCallback(async () => {
        const content = inputValue.trim();
        if (!content || isSending) return;

        const userMessage: ChatMessage = {
            id: makeId('user'),
            role: 'user',
            content,
            createdAt: new Date(),
        };

        appendMessage(userMessage);
        setInputValue('');
        setIsSending(true);

        try {
            const response = await postChatMessage(content);
            appendMessage({
                id: makeId('assistant'),
                role: 'assistant',
                content: response.content,
                sources: mapSources(response.sources),
                createdAt: new Date(),
                meta: response.meta,
            });
        } catch (error) {
            appendMessage({
                id: makeId('assistant'),
                role: 'assistant',
                content: '응답을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
                createdAt: new Date(),
                meta: {
                    source: 'fallback',
                    fallbackReason: 'request_failed',
                },
            });
        } finally {
            setIsSending(false);
            inputRef.current?.focus();
        }
    }, [appendMessage, inputValue, isSending]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSendMessage();
        }
    }, [handleSendMessage]);

    return (
        <section className="flex h-full flex-col bg-white">
            <div className="flex-1 overflow-y-auto px-3 py-4">
                {isBooting ? (
                    <div className="mt-10 flex items-center justify-center text-sm text-[#6b7280]">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        대화를 준비 중입니다...
                    </div>
                ) : (
                    <>
                        {bootstrapFailed || messages.length === 0 ? (
                            <div className="min-h-[320px] flex flex-col items-center justify-center text-center px-4 gap-2">
                                <AlertCircle className="h-10 w-10 text-[#f59e0b]" />
                                <p className="text-sm text-[#374151]">현재 챗봇 준비 상태를 다시 확인 중입니다.</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                void loadBootstrap(() => false);
                            }}
                        >
                                    다시 불러오기
                                </Button>
                            </div>
                        ) : (
                            <>
                                {messages.map((message) => (
                                    <ChatBubble key={message.id} message={message} />
                                ))}

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
                    </>
                )}
            </div>

            {!isBooting && messages.length > 0 ? (
                <div className="border-t border-[#e5e7eb] px-3 py-3">
                    <div className="mb-2 flex flex-wrap gap-2">
                        {SUGGESTED_PROMPTS.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e5e7eb] bg-white text-[#374151] hover:bg-[#fff7ed] hover:border-[#fecaca] transition-colors"
                                onClick={() => setInputValue(prompt)}
                            >
                                {prompt}
                            </button>
                            )
                        )}
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
                            disabled={isSending}
                            className="h-11 border-[#e5e7eb] focus-visible:ring-[#f87171]"
                        />
                        <Button
                            type="submit"
                            className="h-11"
                            disabled={!inputValue.trim() || isSending}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
            ) : null}
        </section>
    );
};

const InsightChatSection = memo(InsightChatSectionComponent);
InsightChatSection.displayName = 'InsightChatSection';

export default InsightChatSection;
