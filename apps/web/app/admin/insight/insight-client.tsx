'use client';

import Link from 'next/link';
import { memo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DashboardFailuresResponse, DashboardFunnelResponse, DashboardQualityResponse, DashboardSummaryResponse } from '@/types/dashboard';
import { BarChart2, Map, Cloud, TrendingUp, TrendingDown, Youtube, Users, Play, Sparkles, AlertTriangle } from 'lucide-react';

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

const InsightChatSection = dynamic(
    () => import('@/components/insight/InsightChatSection'),
    {
        ssr: false,
        loading: () => <SectionSkeleton title="AI 인사이트" />,
    }
);

async function fetchDashboardJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`요청에 실패했습니다: ${url}`);
    }
    return response.json() as Promise<T>;
}

function formatPercent(value: number | null): string {
    if (value == null) return '-';
    return `${value.toFixed(2)}%`;
}

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
            if (!apiKey) throw new Error('YouTube API 키가 없습니다');

            // fetch using handle
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=@tzuyang6145&key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error('YouTube API 응답을 가져오지 못했습니다');
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
            if (!apiKey) throw new Error('YouTube API 키가 없습니다');

            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=@tzuyang6145&key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error('YouTube API 응답을 가져오지 못했습니다');
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

const AdminOpsSection = memo(({
    funnel,
    failures,
    quality,
    isLoading,
}: {
    funnel?: DashboardFunnelResponse;
    failures?: DashboardFailuresResponse;
    quality?: DashboardQualityResponse;
    isLoading: boolean;
}) => {
    if (isLoading) {
        return <SectionSkeleton title="운영 지표" />;
    }

    if (!funnel || !failures || !quality) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">운영 지표</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                    운영 지표를 불러오지 못했습니다.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="grid gap-3 lg:grid-cols-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">퍼널</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>수집 개수</span><span className="font-semibold">{funnel.counts.crawling.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>선정·비선정 합계</span><span className="font-semibold">{funnel.counts.selectionUnion.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>규칙 통과</span><span className="font-semibold">{funnel.counts.rule.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>LAAJ 통과</span><span className="font-semibold">{funnel.counts.laaj.toLocaleString()}</span></div>
                    <div className="pt-2 border-t border-border space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between"><span>선정율</span><span>{formatPercent(funnel.conversion.selectionRate)}</span></div>
                        <div className="flex justify-between"><span>규칙 통과율</span><span>{formatPercent(funnel.conversion.ruleRate)}</span></div>
                        <div className="flex justify-between"><span>LAAJ 통과율</span><span>{formatPercent(funnel.conversion.laajRate)}</span></div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">비선정 사유 상위</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {failures.notSelectionReasons.slice(0, 6).map((item) => (
                        <Link
                            key={item.label}
                            href={{ pathname: '/admin/evaluations', query: { issue: 'notSelection', reason: item.label } }}
                            className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40"
                        >
                            <span className="text-muted-foreground truncate">{item.label}</span>
                            <Badge variant="secondary">{item.count}</Badge>
                        </Link>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">규칙 실패 + LAAJ 누락</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    {failures.ruleFalseMessages.slice(0, 5).map((item) => (
                        <Link
                            key={item.label}
                            href={{ pathname: '/admin/evaluations', query: { issue: 'ruleFalse', reason: item.label } }}
                            className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40"
                        >
                            <span className="text-muted-foreground truncate">{item.label}</span>
                            <Badge variant="outline">{item.count}</Badge>
                        </Link>
                    ))}
                    <div className="pt-2 border-t border-border">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">LAAJ 누락</span>
                            <div className="flex items-center gap-2">
                                <Badge variant="destructive">{failures.laajGaps.count}</Badge>
                                <Link
                                    href={{ pathname: '/admin/evaluations', query: { issue: 'laajGap' } }}
                                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                >
                                    전체 보기
                                </Link>
                            </div>
                        </div>
                        {failures.laajGaps.videoIds.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {failures.laajGaps.videoIds.slice(0, 6).map((id) => (
                                    <Link key={id} href={{ pathname: '/admin/evaluations', query: { issue: 'laajGap', video_id: id } }}>
                                        <Badge variant="secondary" className="text-[10px] hover:bg-muted cursor-pointer">{id}</Badge>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">품질 지표</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">위치 일치(T/F)</span>
                        <span className="font-semibold">
                            T {quality.locationMatch.trueCount.toLocaleString()} / F {quality.locationMatch.falseCount.toLocaleString()}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">카테고리 유효성(T/F)</span>
                        <span className="font-semibold">
                            T {quality.categoryValidity.trueCount.toLocaleString()} / F {quality.categoryValidity.falseCount.toLocaleString()}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">카테고리 판별(T/F)</span>
                        <span className="font-semibold">
                            T {quality.categoryTF.trueCount.toLocaleString()} / F {quality.categoryTF.falseCount.toLocaleString()}
                        </span>
                    </div>
                    <div className="pt-2 border-t border-border space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                            <span>리뷰 신뢰도(평균/중앙값)</span>
                            <span>
                                {quality.reviewFaithfulness.average ?? '-'} / {quality.reviewFaithfulness.median ?? '-'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>커버리지(규칙/LAAJ)</span>
                            <span>
                                {quality.totals.withRuleMetrics.toLocaleString()} / {quality.totals.withLaajMetrics.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
});
AdminOpsSection.displayName = 'AdminOpsSection';

// [MAIN] 인사이트 클라이언트 컴포넌트
const InsightClientComponent = () => {
    const { isAdmin, isLoading } = useAuth();
    const [activeTab, setActiveTab] = useState('chat');

    const { data: dashboardSummary } = useQuery({
        queryKey: ['dashboard-summary-admin-insight'],
        queryFn: () => fetchDashboardJson<DashboardSummaryResponse>('/api/dashboard/summary'),
        staleTime: 1000 * 60 * 5,
    });

    const { data: dashboardFunnel, isLoading: isFunnelLoading } = useQuery({
        queryKey: ['dashboard-funnel-admin-insight'],
        queryFn: () => fetchDashboardJson<DashboardFunnelResponse>('/api/dashboard/funnel'),
        staleTime: 1000 * 60 * 5,
    });

    const { data: dashboardFailures, isLoading: isFailuresLoading } = useQuery({
        queryKey: ['dashboard-failures-admin-insight'],
        queryFn: () => fetchDashboardJson<DashboardFailuresResponse>('/api/dashboard/failures'),
        staleTime: 1000 * 60 * 5,
    });

    const { data: dashboardQuality, isLoading: isQualityLoading } = useQuery({
        queryKey: ['dashboard-quality-admin-insight'],
        queryFn: () => fetchDashboardJson<DashboardQualityResponse>('/api/dashboard/quality'),
        staleTime: 1000 * 60 * 5,
    });

    const ruleFailureTotal = (dashboardFailures?.ruleFalseMessages || []).reduce((acc, item) => acc + item.count, 0);

    // [OPTIMIZATION] 탭 변경 핸들러 메모이제이션
    const handleTabChange = useCallback((value: string) => {
        setActiveTab(value);
    }, []);

    // 인증 로딩 중일 때 표시
    if (isLoading) {
        return (
            <div className="flex flex-col h-full bg-background items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm text-muted-foreground">권한 확인 중...</p>
                </div>
            </div>
        );
    }

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
                        <CompactStatCard icon={Map} title="좌표 보유 식당" value={dashboardSummary?.totals.withCoordinates?.toLocaleString() || '-'} />
                        <CompactStatCard icon={Users} title="선정·비선정 합계" value={dashboardFunnel?.counts.selectionUnion?.toLocaleString() || '-'} />
                        <CompactStatCard icon={Cloud} title="규칙 실패 건수" value={ruleFailureTotal.toLocaleString()} trend="down" />
                        <CompactStatCard icon={AlertTriangle} title="LAAJ 누락" value={dashboardFailures?.laajGaps.count?.toLocaleString() || '-'} trend="down" />
                    </div>
                </div>
            </div>

            {/* [TABS] 메인 콘텐츠 */}
            <div className="flex-1 min-h-0 p-4">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
                    <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid mb-3 shrink-0 bg-secondary/50">
                        <TabsTrigger value="chat" className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4" />
                            <span className="hidden sm:inline">AI 인사이트</span>
                            <span className="sm:hidden">AI</span>
                        </TabsTrigger>
                        <TabsTrigger value="ops" className="flex items-center gap-2">
                            <BarChart2 className="h-4 w-4" />
                            <span className="hidden sm:inline">운영지표</span>
                            <span className="sm:hidden">운영</span>
                        </TabsTrigger>
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
                    </TabsList>

                    <div className="flex-1 min-h-0">
                        <TabsContent value="chat" className="mt-0 h-full">
                            <InsightChatSection />
                        </TabsContent>

                        <TabsContent value="ops" className="mt-0 h-full">
                            <AdminOpsSection
                                funnel={dashboardFunnel}
                                failures={dashboardFailures}
                                quality={dashboardQuality}
                                isLoading={isFunnelLoading || isFailuresLoading || isQualityLoading}
                            />
                        </TabsContent>

                        <TabsContent value="heatmap" className="mt-0 h-full">
                            <HeatmapSection />
                        </TabsContent>

                        <TabsContent value="map" className="mt-0 h-full">
                            <MapSection />
                        </TabsContent>

                        <TabsContent value="wordcloud" className="mt-0 h-full">
                            <WordCloudSection />
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
