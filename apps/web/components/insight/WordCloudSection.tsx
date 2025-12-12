'use client';

import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
    Search,
    X,
    Play,
    ExternalLink,
    TrendingUp,
    Calendar,
    Eye,
    Star
} from 'lucide-react';
import { cn } from '@/lib/utils';

// [TYPE] 키워드 데이터 타입
interface KeywordData {
    keyword: string;
    count: number;
    trend: 'up' | 'down' | 'stable';
    category: string;
}

interface VideoWithKeyword {
    videoId: string;
    title: string;
    publishedAt: string;
    views: number;
    thumbnail: string;
    mentionContext: string;
    review?: string;
}

// [MOCK] 키워드 데이터 - 실제로는 리뷰 데이터에서 추출
const MOCK_KEYWORDS: KeywordData[] = [
    { keyword: '삼겹살', count: 89, trend: 'up', category: '고기' },
    { keyword: '냉면', count: 67, trend: 'stable', category: '면류' },
    { keyword: '횟집', count: 54, trend: 'up', category: '해산물' },
    { keyword: '곱창', count: 48, trend: 'down', category: '고기' },
    { keyword: '치킨', count: 45, trend: 'stable', category: '치킨' },
    { keyword: '짜장면', count: 42, trend: 'up', category: '중식' },
    { keyword: '돈까스', count: 38, trend: 'stable', category: '일식' },
    { keyword: '떡볶이', count: 35, trend: 'up', category: '분식' },
    { keyword: '순대', count: 32, trend: 'stable', category: '분식' },
    { keyword: '갈비', count: 30, trend: 'down', category: '고기' },
    { keyword: '초밥', count: 28, trend: 'up', category: '일식' },
    { keyword: '파스타', count: 25, trend: 'stable', category: '양식' },
    { keyword: '햄버거', count: 23, trend: 'up', category: '패스트푸드' },
    { keyword: '마라탕', count: 21, trend: 'up', category: '중식' },
    { keyword: '김치찌개', count: 19, trend: 'stable', category: '한식' },
    { keyword: '부대찌개', count: 17, trend: 'down', category: '한식' },
    { keyword: '족발', count: 15, trend: 'stable', category: '고기' },
    { keyword: '보쌈', count: 14, trend: 'stable', category: '고기' },
    { keyword: '라멘', count: 12, trend: 'up', category: '일식' },
    { keyword: '스테이크', count: 10, trend: 'stable', category: '양식' },
    { keyword: '칼국수', count: 9, trend: 'stable', category: '면류' },
    { keyword: '비빔밥', count: 8, trend: 'up', category: '한식' },
    { keyword: '국밥', count: 7, trend: 'stable', category: '한식' },
    { keyword: '피자', count: 6, trend: 'stable', category: '양식' },
];

// [MOCK] 키워드별 관련 영상 데이터
const MOCK_VIDEOS_BY_KEYWORD: Record<string, VideoWithKeyword[]> = {
    '삼겹살': [
        {
            videoId: 'v1',
            title: '[쯔양] 서울 최고의 삼겹살 맛집 탐방',
            publishedAt: '2025-12-01',
            views: 1250000,
            thumbnail: '',
            mentionContext: '"이 삼겹살 진짜 맛있다! 껍데기도 바삭하고..."',
            review: '삼겹살이 두툼하고 육즙이 살아있어요. 숯불에 구우면 특유의 향이 나서 더 맛있어요. 특히 목살 부분이 부드럽고 고소해서 강추!'
        },
        {
            videoId: 'v2',
            title: '[쯔양] 대전 문쪽 삼겹살 먹방',
            publishedAt: '2025-11-15',
            views: 980000,
            thumbnail: '',
            mentionContext: '"삼겹살에 소금 찍어서 먹으면 최고야"',
            review: '문쪽 삼겹살 특유의 방식으로 구워주시는데, 겉바속촉 그 자체! 밥도둑이에요.'
        },
        {
            videoId: 'v3',
            title: '[쯔양] 제주 흑돼지 삼겹살 대결',
            publishedAt: '2025-10-28',
            views: 1450000,
            thumbnail: '',
            mentionContext: '"제주 흑돼지 삼겹살은 역시 다르네요"',
            review: '제주 흑돼지는 일반 삼겹살보다 더 쫄깃하고 고소해요. 가격은 좀 있지만 그만한 가치가 있어요!'
        },
    ],
    '냉면': [
        {
            videoId: 'v4',
            title: '[쯔양] 평양냉면 맛집 투어',
            publishedAt: '2025-11-20',
            views: 890000,
            thumbnail: '',
            mentionContext: '"물냉면 육수가 정말 시원하고 깊은 맛이 나요"',
            review: '육수가 맑고 담백해요. 면발이 쫄깃쫄깃하고 고명도 정갈하게 올라와 있어요. 진짜 냉면 맛집!'
        },
        {
            videoId: 'v5',
            title: '[쯔양] 여름에 먹는 비빔냉면',
            publishedAt: '2025-08-10',
            views: 1100000,
            thumbnail: '',
            mentionContext: '"냉면에 식초 듬뿍 넣으면 진짜 맛있어요"',
            review: '비빔냉면 양념이 새콤달콤 매콤해서 입맛 돋워요. 계란 반개랑 같이 비벼먹으면 최고!'
        },
    ],
    '횟집': [
        {
            videoId: 'v6',
            title: '[쯔양] 부산 자갈치 횟집 탐방',
            publishedAt: '2025-09-25',
            views: 1320000,
            thumbnail: '',
            mentionContext: '"부산 횟집은 역시 신선도가 다르네요"',
            review: '자갈치 시장에서 바로 잡은 광어, 우럭이 탱글탱글해요. 회 두께도 두껍고 신선해서 최고의 맛!'
        },
    ],
};

// [COMPONENT] 밥그릇 모양 워드 클라우드
const RiceBowlWordCloud = memo(({
    keywords,
    selectedKeyword,
    onKeywordClick
}: {
    keywords: KeywordData[];
    selectedKeyword: string | null;
    onKeywordClick: (keyword: string) => void;
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [positions, setPositions] = useState<Array<{ x: number; y: number; size: number; keyword: KeywordData }>>([]);

    // 사각형 영역 경계 체크 함수
    const isInsideRect = useCallback((x: number, y: number, width: number, height: number, textWidth: number, textHeight: number) => {
        const padding = 10;
        return x - textWidth / 2 >= padding &&
            x + textWidth / 2 <= width - padding &&
            y - textHeight / 2 >= padding &&
            y + textHeight / 2 <= height - padding;
    }, []);

    // 키워드 위치 계산
    useEffect(() => {
        if (!containerRef.current) return;

        const width = 500;
        const height = 400;
        const centerX = 250;
        const centerY = 200;
        const newPositions: typeof positions = [];
        const maxCount = Math.max(...keywords.map(k => k.count));

        // 키워드를 count 순으로 정렬 (큰 것부터)
        const sortedKeywords = [...keywords].sort((a, b) => b.count - a.count);

        sortedKeywords.forEach((keyword) => {
            const size = 14 + (keyword.count / maxCount) * 28;
            let placed = false;
            let attempts = 0;
            const maxAttempts = 500;

            while (!placed && attempts < maxAttempts) {
                // 중앙에서 시작하여 나선형으로 배치
                const angle = attempts * 0.3;
                const radius = Math.sqrt(attempts) * 12;

                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius * 0.9;

                const textWidth = keyword.keyword.length * size * 0.65;
                const textHeight = size * 1.1;

                // 사각형 영역 안에 있는지 확인
                if (isInsideRect(x, y, width, height, textWidth, textHeight)) {
                    // 다른 키워드와 겹치지 않는지 확인
                    const overlaps = newPositions.some(pos => {
                        const otherWidth = pos.keyword.keyword.length * pos.size * 0.65;
                        const otherHeight = pos.size * 1.1;

                        return Math.abs(x - pos.x) < (textWidth + otherWidth) / 2 + 3 &&
                            Math.abs(y - pos.y) < (textHeight + otherHeight) / 2 + 2;
                    });

                    if (!overlaps) {
                        newPositions.push({ x, y, size, keyword });
                        placed = true;
                    }
                }
                attempts++;
            }
        });

        setPositions(newPositions);
    }, [keywords, isInsideRect]);

    // 카테고리별 색상
    const getColor = (category: string, isSelected: boolean) => {
        if (isSelected) return '#dc2626'; // 선택된 경우 빨간색

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
    };

    return (
        <div className="relative h-full flex items-center justify-center" ref={containerRef}>
            {/* 키워드 워드 클라우드 */}
            <svg
                viewBox="0 0 500 400"
                className="w-full h-full"
                preserveAspectRatio="xMidYMid meet"
            >
                {/* 키워드 텍스트 */}
                {positions.map(({ x, y, size, keyword }) => {
                    const isSelected = selectedKeyword === keyword.keyword;
                    return (
                        <text
                            key={keyword.keyword}
                            x={x}
                            y={y}
                            fontSize={size}
                            fontWeight={isSelected ? 'bold' : keyword.count > 40 ? '600' : '400'}
                            fill={getColor(keyword.category, isSelected)}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="cursor-pointer transition-all duration-200 hover:opacity-80"
                            onClick={() => onKeywordClick(keyword.keyword)}
                            style={{
                                filter: isSelected ? 'drop-shadow(0 0 4px rgba(220, 38, 38, 0.5))' : 'none',
                            }}
                        >
                            {keyword.keyword}
                        </text>
                    );
                })}
            </svg>
        </div>
    );
});
RiceBowlWordCloud.displayName = 'RiceBowlWordCloud';

// [COMPONENT] 관련 영상 및 리뷰 카드
const VideoReviewCard = memo(({ video }: { video: VideoWithKeyword }) => (
    <div className="p-4 border rounded-lg hover:bg-muted/50 transition-colors space-y-3">
        <div className="flex items-start gap-3">
            {/* 썸네일 플레이스홀더 */}
            <div className="w-24 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
                <Play className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm line-clamp-2">{video.title}</h4>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>{video.publishedAt}</span>
                    <span>•</span>
                    <Eye className="h-3 w-3" />
                    <span>{(video.views / 10000).toFixed(1)}만 회</span>
                </div>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8">
                <ExternalLink className="h-4 w-4" />
            </Button>
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
));
VideoReviewCard.displayName = 'VideoReviewCard';

// [MAIN] 워드 클라우드 섹션 메인 컴포넌트
const WordCloudSectionComponent = () => {
    const [searchQuery, setSearchQuery] = useState('');
    // 기본으로 가장 많이 언급된 키워드 선택
    const [selectedKeyword, setSelectedKeyword] = useState<string>('삼겹살');

    // [OPTIMIZATION] 필터링된 키워드 메모이제이션
    const filteredKeywords = useMemo(() => {
        if (!searchQuery.trim()) return MOCK_KEYWORDS;

        const query = searchQuery.toLowerCase();
        return MOCK_KEYWORDS.filter(k =>
            k.keyword.toLowerCase().includes(query) ||
            k.category.toLowerCase().includes(query)
        );
    }, [searchQuery]);

    // [OPTIMIZATION] 선택된 키워드의 관련 영상 메모이제이션
    const relatedVideos = useMemo(() => {
        if (!selectedKeyword) return [];
        return MOCK_VIDEOS_BY_KEYWORD[selectedKeyword] || [];
    }, [selectedKeyword]);

    // 선택된 키워드 정보
    const selectedKeywordData = useMemo(() => {
        return MOCK_KEYWORDS.find(k => k.keyword === selectedKeyword);
    }, [selectedKeyword]);

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
                                리뷰 키워드 분석
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                                쯔양의 리뷰에서 가장 많이 언급된 음식 키워드입니다. 클릭하면 관련 영상을 확인할 수 있습니다.
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
                    <RiceBowlWordCloud
                        keywords={filteredKeywords}
                        selectedKeyword={selectedKeyword}
                        onKeywordClick={handleKeywordClick}
                    />
                </CardContent>
            </Card>

            {/* 우측: 관련 영상 및 리뷰 목록 */}
            <Card className="lg:col-span-2 flex flex-col min-h-0">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                {selectedKeyword && (
                                    <Badge variant="default" className="text-sm">
                                        {selectedKeyword}
                                    </Badge>
                                )}
                                관련 영상
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                                {selectedKeywordData && (
                                    <>
                                        {relatedVideos.length}개의 영상에서 {selectedKeywordData.count}회 언급됨
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
                        {relatedVideos.length === 0 ? (
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
