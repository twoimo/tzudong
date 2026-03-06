'use client';

import { type KeyboardEvent as ReactKeyboardEvent, memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import type { AdminInsightWordcloudResponse, AdminInsightWordcloudVideosResponse, InsightKeywordData, InsightVideoWithKeyword } from '@/types/insight';
import { toKoreanKeywordLabel } from '@/lib/insight/keyword-label';
import {
    Search,
    Play,
    ExternalLink,
    TrendingUp,
    Calendar,
    Eye,
    Star
} from 'lucide-react';
import cloud from 'd3-cloud';

// [TYPES] API 응답 타입 별칭 (기존 컴포넌트 시그니처 유지)
type KeywordData = InsightKeywordData;
type VideoWithKeyword = InsightVideoWithKeyword;

const EMPTY_KEYWORDS: KeywordData[] = [];

async function fetchWordcloudKeywords(): Promise<AdminInsightWordcloudResponse> {
    const response = await fetch('/api/admin/insight/wordcloud');
    if (!response.ok) {
        throw new Error('워드클라우드 키워드 데이터를 가져오지 못했습니다');
    }
    return response.json() as Promise<AdminInsightWordcloudResponse>;
}

async function fetchWordcloudVideos(keyword: string): Promise<AdminInsightWordcloudVideosResponse> {
    const params = new URLSearchParams({ keyword });
    const response = await fetch(`/api/admin/insight/wordcloud?${params.toString()}`);
    if (!response.ok) {
        throw new Error('워드클라우드 영상 데이터를 가져오지 못했습니다');
    }
    return response.json() as Promise<AdminInsightWordcloudVideosResponse>;
}

function formatViewsKorean(views: number | null): string {
    if (views == null) return '-';
    if (views >= 10000) return `${(views / 10000).toFixed(1)}만 회`;
    return `${views.toLocaleString()}회`;
}

function buildYoutubeLinkWithTimestamp(link: string | null, timestampSec: number | null | undefined): string | null {
    if (!link) return null;
    if (typeof timestampSec !== 'number' || !Number.isFinite(timestampSec) || timestampSec <= 0) return link;

    try {
        const url = new URL(link);
        url.searchParams.set('t', `${Math.floor(timestampSec)}s`);
        return url.toString();
    } catch {
        return link;
    }
}

// [COMPONENT] d3-cloud 기반 워드 클라우드
interface WordCloudWord {
    text: string;
    size: number;
    x?: number;
    y?: number;
    rotate?: number;
    font?: string;
    category: string;
    label: string;
}

// 애니메이션용 인터페이스
interface AnimatedWord extends WordCloudWord {
    delay: number;
    floatPhase: number;
}

const RiceBowlWordCloud = memo(({
    keywords,
    selectedKeyword,
    onKeywordClick,
    getDisplayKeyword
}: {
    keywords: KeywordData[];
    selectedKeyword: string | null;
    onKeywordClick: (keyword: string) => void;
    getDisplayKeyword: (keyword: string) => string;
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [words, setWords] = useState<AnimatedWord[]>([]);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [hoveredWord, setHoveredWord] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);

    // 카테고리별 색상
    const getColor = useCallback((category: string, isSelected: boolean, isHovered: boolean) => {
        if (isSelected) return '#dc2626';
        if (isHovered) return '#f97316';

        const colors: Record<string, string> = {
            '고기': '#ef4444',
            '면류': '#f59e0b',
            '해산물': '#3b82f6',
            '치킨': '#f97316',
            '중식': '#ec4899',
            '일식': '#8b5cf6',
            '분식': '#eab308',
            '양식': '#a855f7',
            '패스트푸드': '#22c55e',
            '한식': '#14b8a6',
        };
        return colors[category] || '#6b7280';
    }, []);

    // 컨테이너 크기 감지
    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDimensions({ width, height });
                }
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // d3-cloud 레이아웃 계산
    useEffect(() => {
        if (keywords.length === 0 || dimensions.width === 0 || dimensions.height === 0) return;

        const readyResetRaf = requestAnimationFrame(() => {
            setIsReady(false);
        });

        const maxCount = Math.max(...keywords.map(k => k.count));
        const minCount = Math.min(...keywords.map(k => k.count));

        const minFontSize = 12;
        const maxFontSize = 48;

        const wordData = keywords.map(k => ({
            text: k.keyword,
            size: minFontSize + ((k.count - minCount) / (maxCount - minCount || 1)) * (maxFontSize - minFontSize),
            category: k.category,
            label: getDisplayKeyword(k.keyword),
        }));

        const layout = cloud<WordCloudWord>()
            .size([dimensions.width, dimensions.height])
            .words(wordData)
            .padding(6)
            .rotate(() => 0)
            .font('Pretendard, Noto Serif KR, "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif')
            .fontSize((d: WordCloudWord) => d.size || 14)
            .spiral('archimedean')
            .on('end', (computedWords: WordCloudWord[]) => {
                setWords(computedWords as AnimatedWord[]);
                setIsReady(true);
            });

        layout.start();

        return () => {
            cancelAnimationFrame(readyResetRaf);
        };
    }, [getDisplayKeyword, keywords, dimensions]);

    const handleWordKeyDown = useCallback((event: ReactKeyboardEvent<SVGTextElement>, word: string) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        onKeywordClick(word);
    }, [onKeywordClick]);

    // 준비되지 않았으면 로딩 표시
    if (!isReady || dimensions.width === 0) {
        return (
            <div className="relative h-full w-full flex items-center justify-center" ref={containerRef}>
                <div className="h-8 w-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="relative h-full w-full flex items-center justify-center" ref={containerRef}>
            <svg
                width={dimensions.width}
                height={dimensions.height}
                className="w-full h-full"
            >
                <g transform={`translate(${dimensions.width / 2}, ${dimensions.height / 2})`}>
                    {words.map((word) => {
                        const isSelected = selectedKeyword === word.text;
                        const isHovered = hoveredWord === word.text;
                        const scale = isHovered ? 1.15 : isSelected ? 1.05 : 1;

                        return (
                            <text
                                key={word.text}
                                x={word.x}
                                y={word.y}
                                fontSize={(word.size || 14) * scale}
                                fontWeight={isSelected ? 'bold' : word.size && word.size > 30 ? '600' : '400'}
                                fill={getColor(word.category, isSelected, isHovered)}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="wordcloud-keyword cursor-pointer"
                                role="button"
                                tabIndex={0}
                                aria-pressed={isSelected}
                                aria-label={`${word.label} 키워드 선택`}
                                onClick={() => onKeywordClick(word.text)}
                                onKeyDown={(event) => handleWordKeyDown(event, word.text)}
                                onMouseEnter={() => setHoveredWord(word.text)}
                                onMouseLeave={() => setHoveredWord(null)}
                                style={{
                                    fontFamily: 'Pretendard, Noto Serif KR, "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
                                    transition: 'font-size 0.15s ease-out, fill 0.15s ease-out',
                                }}
                            >
                                {word.label}
                            </text>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
});
RiceBowlWordCloud.displayName = 'RiceBowlWordCloud';

// [COMPONENT] 관련 영상 및 리뷰 카드
const VideoReviewCard = memo(({ video }: { video: VideoWithKeyword }) => {
    const videoLink = buildYoutubeLinkWithTimestamp(video.youtubeLink ?? null, video.timestampSec);

    return (
        <div className="p-4 border rounded-lg hover:bg-muted/50 transition-colors space-y-3">
            <div className="flex items-start gap-3">
            {/* 썸네일 플레이스홀더 */}
            <div className="relative w-24 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                {video.thumbnail ? (
                    <Image
                        src={video.thumbnail}
                        alt="영상 썸네일"
                        fill
                        unoptimized
                        sizes="96px"
                        className="object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <Play className="h-5 w-5 text-muted-foreground" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm line-clamp-2">{video.title}</h4>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>{video.publishedAt ?? '-'}</span>
                    <span>•</span>
                    <Eye className="h-3 w-3" />
                    <span>{formatViewsKorean(video.views)}</span>
                </div>
            </div>
            {videoLink ? (
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" asChild>
                    <a
                        href={videoLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="유튜브에서 보기"
                    >
                        <ExternalLink className="h-4 w-4" />
                    </a>
                </Button>
            ) : (
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" disabled aria-label="연결된 영상 링크 없음">
                    <ExternalLink className="h-4 w-4" />
                </Button>
            )}
        </div>

        {/* 쯔양의 리뷰 */}
        {video.review && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-current" />
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">쯔양의 리뷰</span>
                </div>
                <p className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
                    {video.review}
                </p>
            </div>
        )}

        {/* 언급 맥락 */}
        <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
            {video.mentionContext}
        </p>
    </div>
    );
});
VideoReviewCard.displayName = 'VideoReviewCard';

// [MAIN] 워드 클라우드 섹션 메인 컴포넌트
const WordCloudSectionComponent = () => {
    const [searchQuery, setSearchQuery] = useState('');
    // 기본으로 가장 많이 언급된 키워드 선택
    const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

    const {
        data: keywordResponse,
        isLoading: isKeywordsLoading,
        error: keywordsError,
    } = useQuery({
        queryKey: ['admin-insight-wordcloud'],
        queryFn: fetchWordcloudKeywords,
        staleTime: 1000 * 60 * 5,
    });

    const keywords = keywordResponse?.keywords ?? EMPTY_KEYWORDS;
    const getDisplayKeyword = useCallback((keyword: string) => toKoreanKeywordLabel(keyword), []);
    const activeSelectedKeyword = selectedKeyword ?? keywords[0]?.keyword ?? null;

    const {
        data: videosResponse,
        isLoading: isVideosLoading,
        error: videosError,
    } = useQuery({
        queryKey: ['admin-insight-wordcloud-videos', activeSelectedKeyword],
        queryFn: () => fetchWordcloudVideos(activeSelectedKeyword as string),
        enabled: Boolean(activeSelectedKeyword),
        staleTime: 1000 * 60 * 5,
    });

    // [OPTIMIZATION] 필터링된 키워드 메모이제이션
    const filteredKeywords = useMemo(() => {
        if (!searchQuery.trim()) return keywords;

        const query = searchQuery.toLowerCase();
        return keywords.filter(k =>
            k.keyword.toLowerCase().includes(query) ||
            getDisplayKeyword(k.keyword).toLowerCase().includes(query) ||
            k.category.toLowerCase().includes(query)
        );
    }, [getDisplayKeyword, keywords, searchQuery]);

    const relatedVideos = videosResponse?.videos ?? [];

    // 선택된 키워드 정보
    const selectedKeywordData = useMemo(() => {
        if (!activeSelectedKeyword) return undefined;
        return keywords.find(k => k.keyword === activeSelectedKeyword);
    }, [activeSelectedKeyword, keywords]);

    // [OPTIMIZATION] 핸들러 메모이제이션
    const handleKeywordClick = useCallback((keyword: string) => {
        setSelectedKeyword(keyword);
    }, []);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full min-h-0">
            {/* 좌측: 밥그릇 모양 워드 클라우드 */}
            <Card className="lg:col-span-3 flex flex-col min-h-0">
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                자막/캡셔닝 키워드 분석
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                                쯔양 영상의 자막/캡셔닝에서 추출한 키워드입니다. 클릭하면 관련 영상을 확인할 수 있습니다.
                            </CardDescription>
                        </div>
                        <div className="relative w-48">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="키워드 검색..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 text-sm"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 pt-0 overflow-hidden">
                    {isKeywordsLoading ? (
                        <div className="relative h-full w-full flex items-center justify-center">
                            <div className="h-8 w-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                        </div>
                    ) : keywordsError ? (
                        <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                            키워드 데이터를 불러오지 못했습니다.
                        </div>
                    ) : (
                        <RiceBowlWordCloud
                            keywords={filteredKeywords}
                            selectedKeyword={activeSelectedKeyword}
                            onKeywordClick={handleKeywordClick}
                            getDisplayKeyword={getDisplayKeyword}
                        />
                    )}
                </CardContent>
            </Card>

            {/* 우측: 관련 영상 및 리뷰 목록 */}
            <Card className="lg:col-span-2 flex flex-col min-h-0">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                {activeSelectedKeyword && (
                                    <Badge variant="default" className="text-sm">
                                        {getDisplayKeyword(activeSelectedKeyword)}
                                    </Badge>
                                )}
                                관련 영상
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                                {selectedKeywordData && (
                                    <>
                                        {isVideosLoading ? '불러오는 중...' : `${relatedVideos.length}개의 영상에서 ${selectedKeywordData.count}회 언급됨`}
                                        {selectedKeywordData.trend === 'up' && (
                                            <TrendingUp className="inline h-3 w-3 ml-1 text-green-500" />
                                        )}
                                    </>
                                )}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                    <ScrollArea className="h-full px-4 pb-4">
                        {videosError ? (
                            <div className="text-center py-12 text-muted-foreground text-sm">
                                관련 영상을 불러오지 못했습니다.
                            </div>
                        ) : !activeSelectedKeyword ? (
                            <div className="text-center py-12 text-muted-foreground text-sm">
                                키워드를 선택해 주세요.
                            </div>
                        ) : relatedVideos.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground text-sm">
                                <div className="text-4xl mb-3">🔍</div>
                                <p>키워드를 선택하면</p>
                                <p>관련 영상과 리뷰가 표시됩니다</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {relatedVideos.map((video) => (
                                    <VideoReviewCard key={video.videoId} video={video} />
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
};

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const WordCloudSection = memo(WordCloudSectionComponent);
WordCloudSection.displayName = 'WordCloudSection';

export default WordCloudSection;
