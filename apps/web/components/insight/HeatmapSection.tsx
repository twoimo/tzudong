'use client';

import { memo, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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

// [TYPE] 히트맵 데이터 타입
interface HeatmapDataPoint {
    position: number; // 0-100 (영상 진행률 %)
    engagement: number; // 0-1 (정규화된 참여도)
    views?: number;
}

interface VideoHeatmapData {
    videoId: string;
    title: string;
    thumbnail: string;
    publishedAt: string;
    totalViews: number;
    duration: string;
    heatmapData: HeatmapDataPoint[];
    peakSegment: { start: number; end: number; engagement: number };
    lowestSegment: { start: number; end: number; engagement: number };
    weeklyChange: number; // 이전 주 대비 변화율 (%)
}

// [MOCK] 모의 데이터 - 추후 실제 API로 대체
const MOCK_VIDEOS: VideoHeatmapData[] = [
    {
        videoId: 'abc123',
        title: '[쯔양] 서울 최고의 삼겹살 맛집 탐방기',
        thumbnail: '/placeholder-video.jpg',
        publishedAt: '2025-12-01',
        totalViews: 1250000,
        duration: '15:32',
        heatmapData: Array.from({ length: 100 }, (_, i) => ({
            position: i,
            engagement: Math.sin(i * 0.1) * 0.3 + 0.5 + (i > 40 && i < 60 ? 0.3 : 0),
        })),
        peakSegment: { start: 42, end: 58, engagement: 0.95 },
        lowestSegment: { start: 85, end: 100, engagement: 0.25 },
        weeklyChange: 15.3,
    },
    {
        videoId: 'def456',
        title: '[쯔양] 부산 해운대 횟집 먹방 ASMR',
        thumbnail: '/placeholder-video.jpg',
        publishedAt: '2025-11-28',
        totalViews: 980000,
        duration: '22:15',
        heatmapData: Array.from({ length: 100 }, (_, i) => ({
            position: i,
            engagement: Math.cos(i * 0.08) * 0.25 + 0.55 + (i > 60 && i < 80 ? 0.25 : 0),
        })),
        peakSegment: { start: 62, end: 78, engagement: 0.88 },
        lowestSegment: { start: 0, end: 10, engagement: 0.32 },
        weeklyChange: -5.2,
    },
    {
        videoId: 'ghi789',
        title: '[쯔양] 대전 성심당 빵 대량 구매!',
        thumbnail: '/placeholder-video.jpg',
        publishedAt: '2025-11-25',
        totalViews: 2100000,
        duration: '18:45',
        heatmapData: Array.from({ length: 100 }, (_, i) => ({
            position: i,
            engagement: 0.4 + Math.random() * 0.4 + (i > 20 && i < 40 ? 0.35 : 0),
        })),
        peakSegment: { start: 22, end: 38, engagement: 0.92 },
        lowestSegment: { start: 70, end: 85, engagement: 0.28 },
        weeklyChange: 28.7,
    },
];

// [COMPONENT] 개별 비디오 히트맵 카드
const VideoHeatmapCard = memo(({ video, isSelected, onClick }: {
    video: VideoHeatmapData;
    isSelected: boolean;
    onClick: () => void;
}) => (
    <div
        onClick={onClick}
        className={`
            p-3 rounded-lg cursor-pointer transition-all duration-200 border
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
                        {(video.totalViews / 10000).toFixed(1)}만
                    </span>
                    <span>•</span>
                    <span>{video.duration}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                    {video.weeklyChange >= 0 ? (
                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 text-xs">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            +{video.weeklyChange}%
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 text-xs">
                            <TrendingDown className="h-3 w-3 mr-1" />
                            {video.weeklyChange}%
                        </Badge>
                    )}
                </div>
            </div>
        </div>
    </div>
));
VideoHeatmapCard.displayName = 'VideoHeatmapCard';

// [COMPONENT] 히트맵 차트
const HeatmapChart = memo(({ data, peakSegment, lowestSegment }: {
    data: HeatmapDataPoint[];
    peakSegment: VideoHeatmapData['peakSegment'];
    lowestSegment: VideoHeatmapData['lowestSegment'];
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
        <div className="h-[300px] w-full">
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
                        label={{ value: '↑ Peak', position: 'top', fontSize: 10 }}
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
                        label={{ value: '↓ Low', position: 'top', fontSize: 10 }}
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

    // [OPTIMIZATION] 선택된 비디오 메모이제이션
    const selectedVideo = useMemo(() => MOCK_VIDEOS[selectedVideoIndex], [selectedVideoIndex]);

    // [OPTIMIZATION] 비디오 선택 핸들러 메모이제이션
    const handleVideoSelect = useCallback((index: number) => {
        setSelectedVideoIndex(index);
    }, []);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 좌측: 비디오 목록 */}
            <Card className="lg:col-span-1">
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
                <CardContent className="p-0">
                    <ScrollArea className="h-[400px] px-4 pb-4">
                        <div className="space-y-2">
                            {MOCK_VIDEOS.map((video, index) => (
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
            <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base truncate max-w-md">
                                {selectedVideo.title}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-2 mt-1 text-xs">
                                <Calendar className="h-3 w-3" />
                                {selectedVideo.publishedAt}
                                <span>•</span>
                                <Eye className="h-3 w-3" />
                                {(selectedVideo.totalViews / 10000).toFixed(1)}만 회
                            </CardDescription>
                        </div>
                        <Button variant="outline" size="sm" className="text-xs">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            유튜브에서 보기
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {/* 히트맵 차트 */}
                    <HeatmapChart
                        data={selectedVideo.heatmapData}
                        peakSegment={selectedVideo.peakSegment}
                        lowestSegment={selectedVideo.lowestSegment}
                    />

                    {/* 분석 요약 */}
                    <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-1">
                                <TrendingUp className="h-4 w-4" />
                                <span className="font-medium text-sm">가장 많이 본 구간</span>
                            </div>
                            <p className="text-lg font-bold text-green-800 dark:text-green-300">
                                {selectedVideo.peakSegment.start}% - {selectedVideo.peakSegment.end}%
                            </p>
                            <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                                참여도 {(selectedVideo.peakSegment.engagement * 100).toFixed(0)}%
                            </p>
                        </div>
                        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 mb-1">
                                <TrendingDown className="h-4 w-4" />
                                <span className="font-medium text-sm">가장 적게 본 구간</span>
                            </div>
                            <p className="text-lg font-bold text-red-800 dark:text-red-300">
                                {selectedVideo.lowestSegment.start}% - {selectedVideo.lowestSegment.end}%
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                                참여도 {(selectedVideo.lowestSegment.engagement * 100).toFixed(0)}%
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const HeatmapSection = memo(HeatmapSectionComponent);
HeatmapSection.displayName = 'HeatmapSection';

export default HeatmapSection;
