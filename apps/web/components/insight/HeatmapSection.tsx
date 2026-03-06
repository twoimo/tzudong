'use client';

import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AdminInsightHeatmapResponse, InsightHeatmapDataPoint, InsightHeatmapVideo } from '@/types/insight';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';
import { TrendingUp, TrendingDown, Play, ExternalLink, Calendar, Eye } from 'lucide-react';

async function fetchInsightHeatmap(): Promise<AdminInsightHeatmapResponse> {
    const response = await fetch('/api/admin/insight/heatmap');
    if (!response.ok) {
        throw new Error('인사이트 히트맵을 가져오지 못했습니다');
    }
    return response.json() as Promise<AdminInsightHeatmapResponse>;
}

const EMPTY_VIDEOS: InsightHeatmapVideo[] = [];

// [COMPONENT] 개별 비디오 히트맵 카드
const VideoHeatmapCard = memo(({ video, isSelected, onClick }: {
    video: InsightHeatmapVideo;
    isSelected: boolean;
    onClick: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        aria-label={`${video.title} 영상 선택`}
        className={`
            w-full p-3 rounded-lg cursor-pointer transition-all duration-200 border text-left
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
            ${isSelected
                ? 'bg-primary/10 border-primary shadow-sm'
                : 'bg-card hover:bg-muted/50 border-transparent'
            }
        `}
    >
        <div className="flex items-start gap-3">
            {/* 썸네일 플레이스홀더 */}
            <div className="w-24 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
                <Play className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm truncate">{video.title}</h4>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {typeof video.totalViews === 'number'
                            ? `${(video.totalViews / 10000).toFixed(1)}만`
                            : '-'
                        }
                    </span>
                    <span>•</span>
                    <span>{video.duration}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                    {typeof video.weeklyChange === 'number' ? (
                        video.weeklyChange >= 0 ? (
                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 text-xs">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            +{video.weeklyChange}%
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 text-xs">
                            <TrendingDown className="h-3 w-3 mr-1" />
                            {video.weeklyChange}%
                        </Badge>
                        )
                    ) : (
                        <Badge variant="outline" className="text-muted-foreground border-border bg-background text-xs">
                            -
                        </Badge>
                    )}
                </div>
            </div>
        </div>
    </button>
));
VideoHeatmapCard.displayName = 'VideoHeatmapCard';

// [COMPONENT] 히트맵 차트
const HeatmapChart = memo(({ data, peakSegment, lowestSegment }: {
    data: InsightHeatmapDataPoint[];
    peakSegment: InsightHeatmapVideo['peakSegment'];
    lowestSegment: InsightHeatmapVideo['lowestSegment'];
}) => {
    // [OPTIMIZATION] 데이터 정규화 메모이제이션
    const chartData = useMemo(() =>
        data.map(d => ({
            ...d,
            engagement: Math.min(1, Math.max(0, d.engagement)) * 100,
        })),
        [data]
    );

    return (
        <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="heatmapGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                        dataKey="position"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => `${v}%`}
                        className="text-muted-foreground"
                    />
                    <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => `${v}%`}
                        domain={[0, 100]}
                        className="text-muted-foreground"
                    />
                    <Tooltip
                        content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                    <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                                        <p className="font-medium">진행률: {data.position}%</p>
                                        <p className="text-muted-foreground">참여도: {data.engagement.toFixed(1)}%</p>
                                    </div>
                                );
                            }
                            return null;
                        }}
                    />
                    {/* 가장 많이 본 구간 하이라이트 */}
                    <ReferenceLine
                        x={peakSegment.start}
                        stroke="hsl(var(--chart-1))"
                        strokeDasharray="3 3"
                        label={{ value: '최고 구간', position: 'top', fontSize: 10 }}
                    />
                    <ReferenceLine
                        x={peakSegment.end}
                        stroke="hsl(var(--chart-1))"
                        strokeDasharray="3 3"
                    />
                    {/* 가장 적게 본 구간 하이라이트 */}
                    <ReferenceLine
                        x={lowestSegment.start}
                        stroke="hsl(var(--destructive))"
                        strokeDasharray="3 3"
                        label={{ value: '최저 구간', position: 'top', fontSize: 10 }}
                    />
                    <ReferenceLine
                        x={lowestSegment.end}
                        stroke="hsl(var(--destructive))"
                        strokeDasharray="3 3"
                    />
                    <Area
                        type="monotone"
                        dataKey="engagement"
                        stroke="hsl(var(--primary))"
                        fill="url(#heatmapGradient)"
                        strokeWidth={2}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
});
HeatmapChart.displayName = 'HeatmapChart';

// [MAIN] 히트맵 섹션 메인 컴포넌트
const HeatmapSectionComponent = () => {
    const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);
    const [timeRange, setTimeRange] = useState('week');

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['admin-insight-heatmap'],
        queryFn: fetchInsightHeatmap,
        staleTime: 1000 * 60 * 5,
    });

    const videos = data?.videos ?? EMPTY_VIDEOS;

    useEffect(() => {
        if (selectedVideoIndex >= videos.length) {
            setSelectedVideoIndex(0);
        }
    }, [selectedVideoIndex, videos.length]);

    // [OPTIMIZATION] 선택된 비디오 메모이제이션
    const selectedVideo = useMemo(() => videos[selectedVideoIndex], [videos, selectedVideoIndex]);

    // [OPTIMIZATION] 비디오 선택 핸들러 메모이제이션
    const handleVideoSelect = useCallback((index: number) => {
        setSelectedVideoIndex(index);
    }, []);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full min-h-0">
            {/* 좌측: 비디오 목록 */}
            <Card className="lg:col-span-1 flex flex-col min-h-0">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base">영상 목록</CardTitle>
                        <Select value={timeRange} onValueChange={setTimeRange}>
                            <SelectTrigger className="w-24 h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="week">최근 1주</SelectItem>
                                <SelectItem value="month">최근 1달</SelectItem>
                                <SelectItem value="all">전체</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <CardDescription className="text-xs">
                        히트맵 변화가 큰 영상 순으로 정렬됩니다
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                    <ScrollArea className="h-full px-4 pb-4">
                        <div className="space-y-2">
                            {isLoading ? (
                                <div className="py-10 text-center text-sm text-muted-foreground">
                                    데이터를 불러오는 중...
                                </div>
                            ) : error ? (
                                <div className="py-10 text-center text-sm text-muted-foreground">
                                    데이터를 불러오지 못했습니다.
                                    <div className="mt-3">
                                        <Button variant="outline" size="sm" onClick={() => refetch()}>
                                            다시 시도
                                        </Button>
                                    </div>
                                </div>
                            ) : videos.length === 0 ? (
                                <div className="py-10 text-center text-sm text-muted-foreground">
                                    표시할 히트맵 데이터가 없습니다.
                                </div>
                            ) : videos.map((video, index) => (
                                <VideoHeatmapCard
                                    key={video.videoId}
                                    video={video}
                                    isSelected={index === selectedVideoIndex}
                                    onClick={() => handleVideoSelect(index)}
                                />
                            ))}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* 우측: 히트맵 차트 및 분석 */}
            <Card className="lg:col-span-2 flex flex-col min-h-0 overflow-hidden">
                <CardHeader className="pb-3 flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="min-w-0">
                            <CardTitle className="text-base truncate">
                                {selectedVideo?.title ?? '히트맵 데이터 없음'}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-2 mt-1 text-xs">
                                <Calendar className="h-3 w-3" />
                                {selectedVideo?.publishedAt ?? '-'}
                                <span>•</span>
                                <Eye className="h-3 w-3" />
                                {typeof selectedVideo?.totalViews === 'number'
                                    ? `${(selectedVideo.totalViews / 10000).toFixed(1)}만 회`
                                    : '-'
                                }
                            </CardDescription>
                        </div>
                        <Button variant="outline" size="sm" className="text-xs shrink-0 ml-2">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            유튜브에서 보기
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 pt-0">
                    {!selectedVideo ? (
                        <div className="py-12 text-center text-sm text-muted-foreground">
                            히트맵 데이터를 불러오면 여기에 표시됩니다.
                        </div>
                    ) : (
                        <>
                    {/* 히트맵 차트 */}
                    <HeatmapChart
                        data={selectedVideo.heatmapData}
                        peakSegment={selectedVideo.peakSegment}
                        lowestSegment={selectedVideo.lowestSegment}
                    />

                    {/* [NEW] AI 심층 분석 섹션 */}
                    <div className="mt-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-white"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5c0-5.523 4.477-10 10-10Z" /></svg>
                            </div>
                            <h3 className="font-bold text-base bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-blue-600 dark:from-purple-400 dark:to-blue-400">
                                Gemini 심층 분석 리포트
                            </h3>
                        </div>

                        {/* Peak & Low 분석 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="p-3 rounded-lg bg-green-50/50 dark:bg-green-950/20 border border-green-200/60 dark:border-green-800/60">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                                        <TrendingUp className="h-4 w-4" />
                                        <span className="font-bold text-sm">가장 많이 본 구간 분석</span>
                                    </div>
                                    <Badge variant="outline" className="bg-white/50 dark:bg-black/20 text-green-700 border-green-200 text-xs">
                                        {selectedVideo.peakSegment.start}% - {selectedVideo.peakSegment.end}%
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground dark:text-muted-foreground leading-relaxed">
                                    {selectedVideo.analysis.peakReason}
                                </p>
                            </div>

                            <div className="p-3 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/60">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                                        <TrendingDown className="h-4 w-4" />
                                        <span className="font-bold text-sm">가장 적게 본 구간 분석</span>
                                    </div>
                                    <Badge variant="outline" className="bg-white/50 dark:bg-black/20 text-red-700 border-red-200 text-xs">
                                        {selectedVideo.lowestSegment.start}% - {selectedVideo.lowestSegment.end}%
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground dark:text-muted-foreground leading-relaxed">
                                    {selectedVideo.analysis.lowestReason}
                                </p>
                            </div>
                        </div>

                        {/* 종합 분석 및 키워드 */}
                        <div className="p-4 rounded-lg bg-secondary/30 border border-border">
                            <h4 className="font-semibold text-sm mb-1.5 flex items-center gap-2">
                                <span>💡 종합 인사이트</span>
                            </h4>
                            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                                {selectedVideo.analysis.overallSummary}
                            </p>

                             <div className="flex flex-wrap gap-1.5">
                                 {selectedVideo.analysis.keywords.map((keyword, idx) => (
                                     <Badge key={idx} variant="secondary" className="bg-background hover:bg-background/80 border-border text-xs">
                                         #{keyword}
                                     </Badge>
                                 ))}
                             </div>
                         </div>
                     </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const HeatmapSection = memo(HeatmapSectionComponent);
HeatmapSection.displayName = 'HeatmapSection';

export default HeatmapSection;
