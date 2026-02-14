'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import {
    BarChart3,
    MapPin,
    RefreshCw,
    Search,
    Video,
    Database,
    Compass,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
    DashboardRestaurantsResponse,
    DashboardSummaryResponse,
    DashboardVideoDetailResponse,
} from '@/types/dashboard';
import { useAuth } from '@/contexts/AuthContext';

const AdminInsightsClient = dynamic(
    () => import('@/app/admin/insight/insight-client'),
    {
        ssr: false,
        loading: () => <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">인사이트를 불러오는 중...</div>,
    }
);

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `요청 실패: ${response.status}`);
    }
    return response.json() as Promise<T>;
}

function StatCard({
    title,
    value,
    icon: Icon,
}: {
    title: string;
    value: string | number;
    icon: React.ElementType;
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground">{title}</p>
                        <p className="text-2xl font-bold mt-1">{value}</p>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-primary" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function UserInsightsClient() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

    const summaryQuery = useQuery({
        queryKey: ['dashboard-summary'],
        queryFn: () => fetchJson<DashboardSummaryResponse>('/api/dashboard/summary'),
        staleTime: 1000 * 60 * 5,
    });

    const restaurantsQueryString = useMemo(() => {
        const params = new URLSearchParams();
        params.set('limit', '120');
        params.set('offset', '0');
        params.set('onlyWithCoordinates', 'true');
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (category !== 'all') params.set('category', category);
        return params.toString();
    }, [searchQuery, category]);

    const restaurantsQuery = useQuery({
        queryKey: ['dashboard-restaurants', restaurantsQueryString],
        queryFn: () => fetchJson<DashboardRestaurantsResponse>(`/api/dashboard/restaurants?${restaurantsQueryString}`),
        staleTime: 1000 * 60 * 2,
    });

    useEffect(() => {
        if (!selectedVideoId && summaryQuery.data?.videos?.length) {
            setSelectedVideoId(summaryQuery.data.videos[0].videoId);
        }
    }, [selectedVideoId, summaryQuery.data]);

    const videoDetailQuery = useQuery({
        queryKey: ['dashboard-video-detail', selectedVideoId],
        queryFn: () => fetchJson<DashboardVideoDetailResponse>(`/api/dashboard/video/${selectedVideoId}`),
        enabled: Boolean(selectedVideoId),
        staleTime: 1000 * 60 * 2,
    });

    const topCategories = useMemo(() => summaryQuery.data?.topCategories ?? [], [summaryQuery.data?.topCategories]);
    const videos = summaryQuery.data?.videos ?? [];
    const categoryOptions = useMemo(() => {
        const set = new Set<string>();
        for (const item of topCategories) set.add(item.name);
        return ['all', ...[...set]];
    }, [topCategories]);

    const handleRefresh = async () => {
        await queryClient.invalidateQueries({
            predicate: (query) =>
                Array.isArray(query.queryKey) &&
                typeof query.queryKey[0] === 'string' &&
                query.queryKey[0].startsWith('dashboard-'),
        });
    };

    const isLoading = summaryQuery.isLoading || restaurantsQuery.isLoading;
    const hasError = summaryQuery.error || restaurantsQuery.error;

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    대시보드 데이터를 불러오는 중입니다.
                </div>
            </div>
        );
    }

    if (hasError || !summaryQuery.data || !restaurantsQuery.data) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-xl">
                    <CardHeader>
                        <CardTitle>대시보드를 불러오지 못했습니다</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            API 또는 데이터 소스를 확인해 주세요.
                        </p>
                        <Button onClick={handleRefresh}>다시 시도</Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="border-b border-border bg-card p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <BarChart3 className="h-6 w-6 text-primary" />
                            쯔양 데이터 대시보드
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            영상, 식당, 카테고리 트렌드를 실데이터 기반으로 탐색합니다.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary">기준 시각 {new Date(summaryQuery.data.asOf).toLocaleString()}</Badge>
                        <Button variant="outline" size="sm" onClick={handleRefresh}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            새로고침
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard title="식당 레코드" value={summaryQuery.data.totals.restaurants.toLocaleString()} icon={Database} />
                    <StatCard title="영상 수" value={summaryQuery.data.totals.videos.toLocaleString()} icon={Video} />
                    <StatCard title="카테고리 수" value={summaryQuery.data.totals.categories.toLocaleString()} icon={Compass} />
                    <StatCard title="좌표 보유 식당" value={summaryQuery.data.totals.withCoordinates.toLocaleString()} icon={MapPin} />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">상위 카테고리 분포</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={topCategories.slice(0, 10)} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="name"
                                            angle={-25}
                                            textAnchor="end"
                                            interval={0}
                                            height={56}
                                            tick={{ fontSize: 11 }}
                                        />
                                        <YAxis allowDecimals={false} />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">영상별 식당 분포</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 max-h-[340px] overflow-auto">
                            {videos.slice(0, 20).map((video) => (
                                <button
                                    key={video.videoId}
                                    type="button"
                                    onClick={() => setSelectedVideoId(video.videoId)}
                                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                        selectedVideoId === video.videoId
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:bg-accent/50'
                                    }`}
                                >
                                    <p className="text-sm font-medium line-clamp-1">{video.title}</p>
                                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>식당 {video.restaurantCount}개</span>
                                        <span>•</span>
                                        <span>지오코딩 실패 {video.geocodingFailedCount}</span>
                                    </div>
                                </button>
                            ))}
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">식당 목록 탐색</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-2 md:grid-cols-3">
                            <div className="relative md:col-span-2">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    className="pl-9"
                                    placeholder="식당명, 카테고리, 주소 검색"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger>
                                    <SelectValue placeholder="카테고리 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categoryOptions.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {option === 'all' ? '전체 카테고리' : option}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="mt-4 text-xs text-muted-foreground">
                            총 {restaurantsQuery.data.total.toLocaleString()}건 중 {restaurantsQuery.data.items.length}건 표시
                        </div>

                        <div className="mt-3 space-y-2 max-h-[420px] overflow-auto">
                            {restaurantsQuery.data.items.map((item) => (
                                <div key={item.id} className="rounded-lg border border-border p-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                            <p className="font-medium">{item.name}</p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {item.address || '주소 없음'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {item.category && <Badge variant="outline">{item.category}</Badge>}
                                            {item.videoId && <Badge variant="secondary">{item.videoId}</Badge>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">선택 영상 상세</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!selectedVideoId && (
                            <p className="text-sm text-muted-foreground">영상을 선택해 주세요.</p>
                        )}
                        {selectedVideoId && videoDetailQuery.isLoading && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                영상 상세를 불러오는 중입니다.
                            </div>
                        )}
                        {selectedVideoId && videoDetailQuery.data && (
                            <div className="space-y-3">
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="font-semibold">{videoDetailQuery.data.video.title}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            영상 ID: {videoDetailQuery.data.video.videoId} | 식당 {videoDetailQuery.data.video.restaurantCount}개
                                        </p>
                                    </div>
                                    {videoDetailQuery.data.video.youtubeLink && (
                                        <Link
                                            href={videoDetailQuery.data.video.youtubeLink}
                                            target="_blank"
                                            className="text-sm text-primary underline underline-offset-4"
                                        >
                                            유튜브 열기
                                        </Link>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    {videoDetailQuery.data.restaurants.map((item) => (
                                        <div key={item.id} className="rounded-lg border border-border p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="font-medium">{item.name}</p>
                                                {item.category && <Badge variant="outline">{item.category}</Badge>}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {item.address || '주소 없음'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function InsightsClient() {
    const { isLoading, isAdmin } = useAuth();

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-4 w-4 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    사용자 권한을 확인하는 중입니다.
                </div>
            </div>
        );
    }

    if (isAdmin) {
        return <AdminInsightsClient />;
    }

    return <UserInsightsClient />;
}
