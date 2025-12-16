'use client';

import { memo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart2, Map, Cloud, TrendingUp, TrendingDown, Youtube, Users, Play, CalendarDays } from 'lucide-react';

// [OPTIMIZATION] 각 섹션 컴포넌트를 동적 임포트로 코드 스플리팅
const HeatmapSection = dynamic(
    () => import('@/components/insight/HeatmapSection'),
    {
        ssr: false,
        loading: () => <SectionSkeleton title="유튜브 히트맵 분석" />,
    }
);

const MapSection = dynamic(
    () => import('@/components/insight/MapSection'),
    {
        ssr: false,
        loading: () => <SectionSkeleton title="맛집 지도" />,
    }
);

const WordCloudSection = dynamic(
    () => import('@/components/insight/WordCloudSection'),
    {
        ssr: false,
        loading: () => <SectionSkeleton title="리뷰 워드 클라우드" />,
    }
);

const SeasonCalendarSection = dynamic(
    () => import('@/components/insight/SeasonCalendarSection'),
    {
        ssr: false,
        loading: () => <SectionSkeleton title="시즌 캘린더 알림" />,
    }
);

// [COMPONENT] 압축된 통계 카드 (헤더용)
const CompactStatCard = memo(({
    icon: Icon,
    title,
    value,
    trend
}: {
    icon: React.ElementType;
    title: string;
    value: string | number;
    trend?: 'up' | 'down';
}) => (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50 shrink-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <div className="flex items-center gap-1">
                <p className="text-sm font-bold">{value}</p>
                {trend === 'up' && <TrendingUp className="h-3 w-3 text-green-500" />}
                {trend === 'down' && <TrendingDown className="h-3 w-3 text-red-500" />}
            </div>
        </div>
    </div>
));
CompactStatCard.displayName = 'CompactStatCard';

const YoutubeSubscriberCard = memo(() => {
    const { data: subscriberCount, isLoading, error } = useQuery({
        queryKey: ['youtube-subscriber-count'],
        queryFn: async () => {
            const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
            if (!apiKey) throw new Error('API Key missing');

            // fetch using handle
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=@tzuyang6145&key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error('Youtube API fetch failed');
            }

            const data = await response.json();
            return data.items?.[0]?.statistics?.subscriberCount;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const displayValue = isLoading
        ? '로딩중...'
        : error
            ? '-'
            : subscriberCount
                ? parseInt(subscriberCount).toLocaleString()
                : '-';

    return (
        <CompactStatCard
            icon={Youtube}
            title="쯔양 구독자수"
            value={displayValue}
            trend="up"
        />
    );
});
YoutubeSubscriberCard.displayName = 'YoutubeSubscriberCard';

// [COMPONENT] 유튜브 동영상 개수 카드
const YoutubeVideoCountCard = memo(() => {
    const { data: videoCount, isLoading, error } = useQuery({
        queryKey: ['youtube-video-count'],
        queryFn: async () => {
            const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
            if (!apiKey) throw new Error('API Key missing');

            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=@tzuyang6145&key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error('Youtube API fetch failed');
            }

            const data = await response.json();
            return data.items?.[0]?.statistics?.videoCount;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const displayValue = isLoading
        ? '로딩중...'
        : error
            ? '-'
            : videoCount
                ? parseInt(videoCount).toLocaleString() + '개'
                : '-';

    return (
        <CompactStatCard
            icon={Play}
            title="쯔양 동영상 수"
            value={displayValue}
        />
    );
});
YoutubeVideoCountCard.displayName = 'YoutubeVideoCountCard';


// [COMPONENT] 섹션 로딩 스켈레톤
const SectionSkeleton = memo(({ title }: { title: string }) => (
    <Card className="h-full">
        <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center min-h-[400px]">
            <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        </CardContent>
    </Card>
));
SectionSkeleton.displayName = 'SectionSkeleton';

// [MAIN] 인사이트 클라이언트 컴포넌트
const InsightClientComponent = () => {
    const { isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState('heatmap');

    // [OPTIMIZATION] 탭 변경 핸들러 메모이제이션
    const handleTabChange = useCallback((value: string) => {
        setActiveTab(value);
    }, []);

    // 관리자가 아닌 경우 접근 거부
    if (!isAdmin) {
        return (
            <div className="flex flex-col h-full bg-background">
                <div className="flex-1 flex items-center justify-center">
                    <Card className="max-w-md">
                        <CardContent className="p-8 text-center">
                            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                                <BarChart2 className="h-8 w-8 text-destructive" />
                            </div>
                            <h2 className="text-xl font-bold mb-2">접근 권한이 없습니다</h2>
                            <p className="text-muted-foreground">관리자만 인사이트 페이지에 접근할 수 있습니다.</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between gap-4">
                    {/* 좌측: 타이틀 */}
                    <div className="flex-shrink-0">
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <BarChart2 className="h-6 w-6 text-primary" />
                            쯔동여지도 인사이트
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            유튜브 영상 분석, 맛집 제보 현황, 리뷰 키워드 트렌드를 한눈에 확인하세요.
                        </p>
                    </div>

                    {/* 우측: 압축된 통계 카드 */}
                    <div className="flex items-center gap-3 overflow-x-auto">
                        <YoutubeSubscriberCard />
                        <YoutubeVideoCountCard />
                        <CompactStatCard icon={Youtube} title="유튜브 히트맵" value="127" trend="up" />
                        <CompactStatCard icon={Map} title="구독자 제보 맛집" value="48" />
                        <CompactStatCard icon={Users} title="타 유튜버 맛집" value="312" trend="up" />
                        <CompactStatCard icon={Cloud} title="워드 클라우드" value="1,024" />
                    </div>
                </div>
            </div>

            {/* [TABS] 메인 콘텐츠 */}
            <div className="flex-1 min-h-0 p-4">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
                    <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid mb-3 shrink-0 bg-secondary/50">
                        <TabsTrigger value="heatmap" className="flex items-center gap-2">
                            <Youtube className="h-4 w-4" />
                            <span className="hidden sm:inline">유튜브 히트맵</span>
                            <span className="sm:hidden">히트맵</span>
                        </TabsTrigger>
                        <TabsTrigger value="map" className="flex items-center gap-2">
                            <Map className="h-4 w-4" />
                            <span className="hidden sm:inline">맛집 지도</span>
                            <span className="sm:hidden">지도</span>
                        </TabsTrigger>
                        <TabsTrigger value="wordcloud" className="flex items-center gap-2">
                            <Cloud className="h-4 w-4" />
                            <span className="hidden sm:inline">워드 클라우드</span>
                            <span className="sm:hidden">키워드</span>
                        </TabsTrigger>
                        <TabsTrigger value="season" className="flex items-center gap-2">
                            <CalendarDays className="h-4 w-4" />
                            <span className="hidden sm:inline">시즌 캘린더</span>
                            <span className="sm:hidden">시즌</span>
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex-1 min-h-0">
                        <TabsContent value="heatmap" className="mt-0 h-full">
                            <HeatmapSection />
                        </TabsContent>

                        <TabsContent value="map" className="mt-0 h-full">
                            <MapSection />
                        </TabsContent>

                        <TabsContent value="wordcloud" className="mt-0 h-full">
                            <WordCloudSection />
                        </TabsContent>

                        <TabsContent value="season" className="mt-0 h-full">
                            <SeasonCalendarSection />
                        </TabsContent>
                    </div>
                </Tabs>
            </div>
        </div>
    );
};

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const InsightClient = memo(InsightClientComponent);
InsightClient.displayName = 'InsightClient';

export default InsightClient;
