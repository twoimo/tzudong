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
    analysis: {
        peakReason: string;
        lowestReason: string;
        overallSummary: string;
        keywords: string[];
    };
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
        analysis: {
            peakReason: "삼겹살이 구워지는 소리와 함께 육즙이 터지는 클로즈업 장면이 시청자들의 식욕을 강하게 자극했습니다. 특히 '한 입만' 도전 구간에서의 긴장감이 몰입도를 극대화했습니다.",
            lowestReason: "식사가 끝난 후 다소 길어진 마무리 멘트와 다음 장소로 이동하는 과정이 포함되어 있어, 핵심 먹방 콘텐츠를 기대한 시청자들의 이탈이 발생했습니다.",
            overallSummary: "이 영상의 핵심 성공 요인은 '시청각 자극의 극대화'입니다. 삼겹살이 지글지글 구워지는 ASMR 사운드와 육즙이 터지는 클로즈업 영상은 시청자의 오감을 자극하는 황금 조합입니다. 특히 42%~58% 구간에서 진행된 '한 입만 도전'은 긴장감과 성취감을 동시에 제공하여 시청 지속 시간을 크게 끌어올렸습니다.\n\n개선이 필요한 부분은 엔딩 구간입니다. 85% 이후의 급격한 이탈은 핵심 콘텐츠(먹방) 종료 후 부가적인 내용이 길어졌기 때문입니다. 다음 촬영 장소 이동이나 마무리 멘트는 30초 이내로 압축하고, 대신 다음 영상 예고나 하이라이트 리캡을 배치하는 것이 효과적입니다.\n\n향후 전략: 도입부(0~10%)에 오늘의 '한 입 도전' 티저를 삽입하여 초반 이탈을 방지하고, 본 콘텐츠로의 기대감을 높이세요.",
            keywords: ["육즙 클로즈업", "ASMR", "한입만 도전", "빠른 전개 필요"]
        }
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
        analysis: {
            peakReason: "다양한 해산물을 한 번에 쌓아 먹는 '해물 탑' 먹방 구간이 시각적 만족감을 주었습니다. 바다 배경음과 씹는 소리가 조화롭게 어우러져 ASMR 효과가 극대화되었습니다.",
            lowestReason: "초반 인트로에서 식당을 찾아가는 과정이 2분 이상 지속되면서, 바로 먹방을 보기를 원하는 시청자들이 초반에 이탈했습니다.",
            overallSummary: "ASMR 먹방 콘텐츠의 특성을 200% 활용한 영상입니다. 해산물의 아삭한 식감과 바다 배경음의 조합은 청각적 몰입감을 극대화했고, '해물 탑' 비주얼은 트렌드에 부합하는 SNS 공유 유도 요소입니다.\n\n그러나 초반 10% 구간에서 32%라는 낮은 유지율은 심각한 문제입니다. 시청자는 썸네일과 제목을 보고 '즉각적인 먹방'을 기대하고 클릭했는데, 2분 넘게 식당을 찾아가는 브이로그 형식의 인트로가 기대를 저버렸습니다.\n\n권장 개선안: 영상 시작 5초 이내에 '오늘의 하이라이트(해물 탑 먹는 장면)'를 먼저 보여주고, '이게 궁금하시죠? 어떻게 여기까지 왔는지 보여드릴게요'라는 후킹 멘트로 인트로를 자연스럽게 연결하세요. 이 방식은 초반 이탈을 50% 이상 줄일 수 있습니다.",
            keywords: ["해물 탑", "바다 배경음", "인트로 단축", "하이라이트 선공개"]
        }
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
        analysis: {
            peakReason: "유명한 '튀김소보로'를 포함해 인기 메뉴들을 트레이 가득 담는 장면에서 대리 만족감을 느낀 시청자들의 반응이 폭발적이었습니다.",
            lowestReason: "구매한 빵을 하나씩 소개하는 과정에서 설명이 길어지며, 실제 시식까지의 텀이 길어져 지루함을 느낀 시청자가 발생했습니다.",
            overallSummary: "210만 조회수가 증명하듯, '성심당 대량 구매'는 그 자체로 강력한 콘텐츠입니다. 시청자들은 쯔양이 트레이 가득 빵을 담는 모습에서 대리 만족을 느끼고, 본인이 성심당에 갔을 때 무엇을 사야 할지 참고하기 위해 시청합니다.\n\n피크 구간(22%~38%)의 성공 요인은 '시각적 풍요로움'입니다. 빵을 하나씩 집을 때마다 화면에 메뉴명과 가격이 자막으로 표시되어 정보 전달력을 높였습니다. 반면 70%~85% 구간에서 이탈이 발생한 것은 구매한 빵을 하나씩 설명하는 '리뷰' 파트가 너무 길었기 때문입니다.\n\n최적화 제안: 빵 소개는 '베스트 3'만 깊게 다루고 나머지는 자막과 함께 빠르게 몽타주로 처리하세요. 시식과 설명의 비율을 현재 3:7에서 6:4로 조정하면 후반부 리텐션이 크게 개선될 것입니다.",
            keywords: ["대리 쇼핑", "빵지순례", "설명 최소화", "시식 비중 확대"]
        }
    },
    {
        videoId: 'jkl012',
        title: '[쯔양] 전주 한옥마을 비빔밥 투어',
        thumbnail: '/placeholder-video.jpg',
        publishedAt: '2025-11-22',
        totalViews: 1580000,
        duration: '20:10',
        heatmapData: Array.from({ length: 100 }, (_, i) => ({
            position: i,
            engagement: Math.sin(i * 0.12) * 0.2 + 0.6 + (i > 30 && i < 50 ? 0.28 : 0),
        })),
        peakSegment: { start: 32, end: 48, engagement: 0.91 },
        lowestSegment: { start: 90, end: 100, engagement: 0.30 },
        weeklyChange: 12.1,
        analysis: {
            peakReason: "거대 양푼 비빔밥을 비비는 역동적인 장면과 붉은 색감이 식욕을 자극했습니다. 숟가락 가득 비빔밥을 떠먹는 첫 입 장면에서 최고 시청 지속 시간을 기록했습니다.",
            lowestReason: "식사 후반부 배부름을 호소하며 먹는 속도가 현저히 느려지는 구간에서 긴장감이 떨어져 이탈이 발생했습니다.",
            overallSummary: "비빔밥 먹방의 핵심은 '비비는 순간'과 '첫 입'입니다. 이 영상은 두 요소를 모두 완벽하게 포착했습니다. 특히 붉은 고추장과 노란 계란, 초록 야채의 색 대비가 만들어내는 비주얼은 음식 콘텐츠의 정석입니다.\n\n91%라는 높은 피크 참여도는 '대왕 양푼 비빔밥'이라는 스케일의 힘을 보여줍니다. 시청자들은 일상에서 접하기 어려운 거대한 양의 음식을 보며 경이로움과 대리 만족을 동시에 느낍니다.\n\n아쉬운 점은 후반부 페이스 조절입니다. 먹방 특성상 포만감이 차면 먹는 속도가 느려지는 것은 자연스럽지만, 이 구간이 너무 길어지면 시청자도 함께 지칩니다. 후반 20%는 배속 편집이나 '남은 양 도전' 같은 새로운 미션을 추가하여 긴장감을 유지하세요.",
            keywords: ["거대 양푼", "색감 자극", "속도감 유지", "편집 리듬"]
        }
    },
    {
        videoId: 'mno345',
        title: '[쯔양] 인천 차이나타운 짜장면 도전!',
        thumbnail: '/placeholder-video.jpg',
        publishedAt: '2025-11-19',
        totalViews: 890000,
        duration: '16:45',
        heatmapData: Array.from({ length: 100 }, (_, i) => ({
            position: i,
            engagement: Math.cos(i * 0.09) * 0.3 + 0.5 + (i > 50 && i < 70 ? 0.32 : 0),
        })),
        peakSegment: { start: 52, end: 68, engagement: 0.89 },
        lowestSegment: { start: 5, end: 15, engagement: 0.22 },
        weeklyChange: -2.8,
        analysis: {
            peakReason: "탕수육을 짜장면 소스에 찍어 먹는 독특한 조합을 시도할 때 댓글 반응과 함께 몰입도가 상승했습니다. '부먹 vs 찍먹' 논쟁을 유도한 점이 주효했습니다.",
            lowestReason: "가게 내부 인테리어와 메뉴판을 보여주는 초반 도입부가 1분 30초 이상 지속되어 지루함을 유발했습니다.",
            overallSummary: "이 영상의 MVP는 '짜장면 소스에 탕수육 찍어 먹기'라는 예상치 못한 조합입니다. 댓글창에서 '부먹 vs 찍먹' 논쟁이 자연스럽게 발생했고, 이는 알고리즘이 좋아하는 '높은 댓글 참여율'로 이어졌습니다.\n\n그러나 22%라는 초반 이탈률은 심각한 수준입니다. 인천 차이나타운의 분위기를 전달하려는 의도는 이해하지만, 1분 30초의 인테리어/메뉴판 촬영은 현대 시청자의 인내심을 시험합니다.\n\n핵심 개선 포인트: '논쟁 유발 콘텐츠'를 초반에 배치하세요. 영상 시작 10초 안에 '오늘 제가 짜장면 소스에 탕수육을 찍어 먹어볼 건데요, 여러분은 이거 부먹? 찍먹?'이라고 물으면 시청자는 정답을 확인하기 위해 영상을 끝까지 시청할 확률이 높아집니다. 이것이 바로 '호기심 갭(Curiosity Gap)' 전략입니다.",
            keywords: ["이색 조합", "시청자 참여", "도입부 간소화", "논쟁 유도"]
        }
    },
    {
        videoId: 'pqr678',
        title: '[쯔양] 제주도 흑돼지 ASMR 먹방',
        thumbnail: '/placeholder-video.jpg',
        publishedAt: '2025-11-16',
        totalViews: 3200000,
        duration: '25:30',
        heatmapData: Array.from({ length: 100 }, (_, i) => ({
            position: i,
            engagement: 0.45 + Math.sin(i * 0.15) * 0.25 + (i > 15 && i < 35 ? 0.35 : 0),
        })),
        peakSegment: { start: 18, end: 33, engagement: 0.97 },
        lowestSegment: { start: 75, end: 90, engagement: 0.26 },
        weeklyChange: 35.4,
        analysis: {
            peakReason: "멜젓에 두툼한 흑돼지를 푹 찍어 먹는 장면에서 시각적 쾌감이 극대화되었습니다. 숯불에 고기 굽는 소리가 배경음처럼 깔려 현장감을 높였습니다.",
            lowestReason: "사이드 메뉴로 주문한 냉면이 늦게 나와 고기 흐름이 끊기는 구간에서 시청 지속 시간이 일시적으로 하락했습니다.",
            overallSummary: "320만 조회수와 97%의 피크 참여도는 이 영상이 '고기 먹방의 교과서'임을 증명합니다. 성공의 핵심은 '흐름(Flow)'입니다. 숯불 위에서 고기가 익는 소리, 젓가락으로 뒤집는 타이밍, 멜젓에 찍어 입으로 가져가는 동작까지 모든 것이 끊김 없이 이어집니다.\n\n18%~33% 구간이 황금 구간인 이유는 '첫 고기'의 힘입니다. 시청자들은 처음 구워진 고기가 어떤 맛일지 궁금해하며 집중하고, 쯔양의 리액션을 통해 대리 만족을 경험합니다.\n\n리텐션 저하 구간(75%~90%)의 원인은 명확합니다. 냉면 주문 후 기다리는 동안 고기 먹방의 '흐름'이 끊겼습니다. 이런 대기 시간은 과감히 편집하거나, 대기 중 '오늘 먹은 고기 리뷰' 같은 보조 콘텐츠로 채우세요.\n\n프로 팁: 사이드 메뉴는 미리 주문하여 메인과 동시에 도착하도록 조율하면 흐름 단절을 예방할 수 있습니다.",
            keywords: ["멜젓 소스", "현장감", "흐름 유지", "과감한 편집"]
        }
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
            <Card className="lg:col-span-2 flex flex-col min-h-0 overflow-hidden">
                <CardHeader className="pb-3 flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="min-w-0">
                            <CardTitle className="text-base truncate">
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
                        <Button variant="outline" size="sm" className="text-xs shrink-0 ml-2">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            유튜브에서 보기
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 pt-0">
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
                                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
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
                                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
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
                </CardContent>
            </Card>
        </div>
    );
};

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const HeatmapSection = memo(HeatmapSectionComponent);
HeatmapSection.displayName = 'HeatmapSection';

export default HeatmapSection;
