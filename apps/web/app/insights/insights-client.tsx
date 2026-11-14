'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, useTransition } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ThemeProvider, type ChartEvent } from 'ztd-charts';
import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AdminEmbeddedModuleShell } from '@/components/admin/AdminEmbeddedModuleShell';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingPreview } from '@/components/ui/loading-surface';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import type { InsightTreemapPeriod, InsightTreemapResponse, InsightTreemapVideoRow } from '@/lib/public-insights/treemap';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { adminQueryLastReadFailed } from '@/lib/admin/query-read-state';
import { InsightsTreemap } from './insights-treemap';


type ViewMode = 'all' | 'category' | 'change';
type MetricMode = 'views' | 'likes' | 'comments' | 'duration';

type TreemapLeafNode = {
    id: string;
    name: string;
    title: string;
    category: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    duration: number;
    publishedAt: string | null;
    value: number;
    metricRaw: number;
    previousMetricRaw: number | null;
    metricText: string;
    percent: number;
    percentText: string;
    children?: undefined;
};

type TreemapGroupNode = {
    name: string;
    children: TreemapLeafNode[];
    value: number;
};

type TreemapNode = TreemapLeafNode | TreemapGroupNode;

function isTreemapGroupNode(entry: TreemapNode): entry is TreemapGroupNode {
    return Array.isArray(entry.children);
}

type ChartDimensions = {
    width: number;
    height: number;
};

type LeafRowsData = {
    leafRows: TreemapLeafNode[];
    leafTotalMetric: number;
    leafMetricValuesSorted: number[];
};

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
    { value: 'all', label: '비율' },
    { value: 'change', label: '증감률' },
];

const METRIC_OPTIONS: { value: MetricMode; label: string }[] = [
    { value: 'views', label: '조회수' },
    { value: 'likes', label: '좋아요' },
    { value: 'comments', label: '댓글수' },
    { value: 'duration', label: '영상 길이' },
];

type PeriodOption = {
    value: InsightTreemapPeriod;
    label: string;
};

const PERIOD_OPTIONS: PeriodOption[] = [
    { value: 'ALL', label: '전체' },
    { value: '1D', label: '1D' },
    { value: '1W', label: '1W' },
    { value: '2W', label: '2W' },
    { value: '1M', label: '1M' },
    { value: '3M', label: '3M' },
    { value: '6M', label: '6M' },
    { value: '1Y', label: '1Y' },
];

const CLUSTER_PRESET_STEPS: Record<MetricMode, number[]> = {
    views: [100_000, 300_000, 500_000, 1_000_000, 2_000_000, 5_000_000],
    likes: [50, 100, 300, 500, 1_000],
    comments: [50, 100, 300, 500, 1_000],
    duration: [30, 60, 120, 180, 300, 600],
};

/**
 * Samsung Internet / iPhone Safari 대응:
 * 정적 초기값 대신 현재 뷰포트에서 실제 사용 가능한 크기를 계산한다.
 * 헤더(~56px), 컨트롤 패널(~80px), 하단 네비게이션(~60px), 여백(~16px) 등을 빼서 근사치를 구한다.
 */
function getInitialChartSize(isMobile: boolean, isTablet: boolean): ChartDimensions {
    if (typeof window === 'undefined') {
        if (isMobile) return { width: 360, height: 280 };
        if (isTablet) return { width: 640, height: 380 };
        return { width: 960, height: 480 };
    }

    const vw = window.innerWidth;
    // dvh 대응: visualViewport이 있으면 사용 (Samsung Internet/Safari에서 주소창 제외된 높이)
    const vh = window.visualViewport?.height ?? window.innerHeight;
    // 사용 불가 영역 추정: 헤더 56px + 컨트롤 패널 ~90px + 하단 네비 60px(모바일만) + 패딩 16px
    const chromeHeight = isMobile ? 222 : isTablet ? 162 : 132;
    const availableHeight = Math.max(200, Math.floor(vh - chromeHeight));
    const width = Math.max(280, Math.floor(vw - (isMobile ? 16 : isTablet ? 32 : 64)));

    return { width, height: availableHeight };
}

async function fetchTreemapData(
    viewMode: ViewMode,
    period: InsightTreemapPeriod,
    metricMode: MetricMode,
    signal?: AbortSignal,
): Promise<InsightTreemapResponse> {
    const params = new URLSearchParams({
        period,
        viewMode,
        metricMode,
    });
    const response = await fetch(`/api/insights/treemap?${params.toString()}`, {
        method: 'GET',
        signal,

    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `요청 실패: ${response.status}`);
    }
    return response.json() as Promise<InsightTreemapResponse>;
}
function getMetricValue(row: InsightTreemapVideoRow, mode: MetricMode): number {
    if (mode === 'views') return row.viewCount;
    if (mode === 'likes') return row.likeCount;
    if (mode === 'comments') return row.commentCount;
    return row.duration;
}

function getPreviousMetricValue(row: InsightTreemapVideoRow, mode: MetricMode): number | null {
    if (mode === 'views') return row.previousViewCount;
    if (mode === 'likes') return row.previousLikeCount;
    if (mode === 'comments') return row.previousCommentCount;
    return row.previousDuration;
}

function calculateChangePercent(current: number, previous: number | null): number {
    if (!Number.isFinite(current) || previous == null || previous <= 0) {
        return 0;
    }

    return ((current - previous) / previous) * 100;
}

function formatShortNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) {
        const v = Number.parseFloat((value / 1_000_000).toFixed(1));
        return `${v}M`;
    }

    if (value >= 1_000) {
        const v = Number.parseFloat((value / 1_000).toFixed(1));
        return `${v}k`;
    }

    return value.toLocaleString();
}

function formatDurationText(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatMetricText(mode: MetricMode, value: number): string {
    if (mode === 'duration') return formatDurationText(value);
    return formatShortNumber(value);
}

function formatTooltipMetric(mode: 'views' | 'likes' | 'comments' | 'duration', value: number): string {
    if (mode === 'duration') return formatDurationText(value);
    if (mode === 'likes' || mode === 'comments') {
        return `${Math.round(value).toLocaleString()}개`;
    }
    return `${Math.round(value).toLocaleString()}개`;
}

function formatPercent(value: number): string {
    return `${value.toFixed(2)}%`;
}

function getMetricLabel(mode: MetricMode): string {
    if (mode === 'views') return '조회수';
    if (mode === 'likes') return '좋아요';
    if (mode === 'comments') return '댓글수';
    return '영상 길이';
}

function getPeriodLabel(period: InsightTreemapPeriod): string {
    if (period === 'ALL') return '전체';
    if (period === '1D') return '전일';
    if (period === '1W') return '전주';
    if (period === '2W') return '2주전';
    if (period === '1M') return '전월';
    if (period === '3M') return '3개월전';
    if (period === '6M') return '6개월전';
    if (period === '1Y') return '1년전';
    return '1년전';
}

function formatSignedPercent(value: number): string {
    if (!Number.isFinite(value)) return '0%';
    return `${value.toFixed(2)}%`;
}

function getClusterIndex(value: number, cuts: number[]): number {
    if (cuts.length === 0) return 0;

    for (let i = 0; i < cuts.length; i += 1) {
        if (value <= cuts[i]) {
            return i;
        }
    }

    return cuts.length;
}

function clusterLabel(mode: MetricMode, cuts: number[], index: number): string {
    if (cuts.length === 0) {
        return '전체';
    }

    const start = index === 0 ? 0 : cuts[index - 1];
    const end = index >= cuts.length ? null : cuts[index];

    if (end == null) {
        return `${formatMetricText(mode, start)}+`;
    }

    return `${formatMetricText(mode, start)}~${formatMetricText(mode, end)}`;
}

function formatClusterValueByMode(mode: MetricMode, value: number): string {
    if (mode === 'duration') {
        const minutes = Math.max(0, Math.floor(value / 60));
        return `${minutes}분`;
    }

    if (mode === 'views') {
        return formatShortNumber(value);
    }

    return `${Math.round(value).toLocaleString()}개`;
}

function getNiceStep(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1;

    const magnitude = Math.floor(Math.log10(value));
    const unit = 10 ** magnitude;
    const normalized = value / unit;
    const stepBase = [1, 2, 5, 10].find((item) => normalized <= item) ?? 10;

    return stepBase * unit;
}

function buildDynamicStepPresets(valuesSorted: number[], mode: MetricMode): number[] {
    if (valuesSorted.length <= 1) return [];

    const max = valuesSorted[valuesSorted.length - 1];
    if (!Number.isFinite(max) || max <= 0) return [];

    const baseCountList = [3, 4, 5, 6, 8];
    const ratioList = [0.5, 1, 1.5, 2, 2.5];
    const candidateSet = new Set<number>();

    baseCountList.forEach((count) => {
        const approx = max / count;
        candidateSet.add(getNiceStep(approx));
        ratioList.forEach((ratio) => {
            candidateSet.add(getNiceStep(approx * ratio));
        });
    });

    CLUSTER_PRESET_STEPS[mode].forEach((step) => {
        if (step > 0) candidateSet.add(Math.floor(step));
    });

    const rawSteps = [...candidateSet]
        .filter((step) => step > 0 && step < max)
        .filter((step) => buildStepBasedCuts(valuesSorted, step).length >= 2)
        .sort((a, b) => a - b);

    if (rawSteps.length === 0) return [];

    const filtered = rawSteps.filter((step, index, all) => {
        if (index === 0) return true;
        return step > all[index - 1] * 1.35;
    });

    return filtered.slice(0, 6);
}

function buildStepBasedCuts(values: number[], step: number): number[] {
    if (!Number.isFinite(step) || step <= 0) return [];
    if (values.length === 0) return [];

    const max = Math.max(...values);
    const cuts: number[] = [];
    let current = step;

    while (current < max) {
        cuts.push(Math.floor(current));
        current += step;
    }

    return cuts;
}

function TreemapDetailContent({ leaf, viewMode, period, metricMode }: {
    leaf: TreemapLeafNode;
    viewMode: ViewMode;
    period: InsightTreemapPeriod;
    metricMode: MetricMode;
}) {
    return (
        <>
            <p className="font-semibold">{leaf.title}</p>
            <p>카테고리: {leaf.category}</p>
            <p>조회수: {formatTooltipMetric('views', leaf.viewCount)}</p>
            <p>좋아요: {formatTooltipMetric('likes', leaf.likeCount)}</p>
            <p>댓글수: {formatTooltipMetric('comments', leaf.commentCount)}</p>
            <p>영상 길이: {formatTooltipMetric('duration', leaf.duration)}</p>
            <p>{viewMode === 'change' ? `${getPeriodLabel(period)} 증감률: ${leaf.percentText}` : `비율: ${leaf.percentText}`}</p>
            {viewMode === 'change' ? (
                <p>이전 {getMetricLabel(metricMode)}: {formatTooltipMetric(metricMode, leaf.previousMetricRaw ?? leaf.metricRaw)}</p>
            ) : null}
        </>
    );
}

function InsightsClientLoadingSkeleton() {
    return (
        <div
            className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
            data-insights-client-loading="true"
            role="status"
            aria-busy="true"
            aria-label="영상 성과 분석 화면 로딩 중"
        >

            <span className="sr-only">영상 성과 분석 필터와 트리맵 영역을 불러오는 중입니다.</span>

            <div className="min-h-0 flex-1 overflow-hidden p-2 md:p-4">

                <Card className="flex h-full min-h-0 flex-col overflow-hidden border border-border">

                    <div className="border-b border-border p-2 md:p-3">

                        <LoadingPreview kind="navigation" compact showHeader={false} label="성과 분석 필터 로딩 중" />

                    </div>

                    <CardContent className="min-h-0 flex-1 overflow-hidden p-2">

                        <LoadingPreview kind="chart" label="영상 성과 분석 화면 로딩 중" className="h-full min-h-[360px]" />

                    </CardContent>

                </Card>

            </div>

        </div>
    );
}

export default function InsightsClient({ embedded = false }: { embedded?: boolean } = {}) {
    const router = useRouter();
    const { isLoading: isAuthLoading, user } = useAuth();
    const { isMobile, isTablet } = useDeviceType();

    useEffect(() => {
        if (!embedded && !isAuthLoading && !user) {
            router.replace('/');
        }
    }, [embedded, isAuthLoading, user, router]);

    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [metricMode, setMetricMode] = useState<MetricMode>('views');
    const [clusterStep, setClusterStep] = useState<number | null>(null);
    const [period, setPeriod] = useState<InsightTreemapPeriod>('ALL');
    const initialChartSize = useMemo(() => {
        return getInitialChartSize(isMobile, isTablet);
    }, [isMobile, isTablet]);

    const [chartSize, setChartSize] = useState<ChartDimensions>(() => getInitialChartSize(isMobile, isTablet));
    const [, startTransition] = useTransition();
    const chartWidth = chartSize.width;
    const chartHeight = chartSize.height;
    const [activeTileIndex, setActiveTileIndex] = useState(0);
    const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
    const [tileNavigatorFocused, setTileNavigatorFocused] = useState(false);
    const layoutRafRef = useRef<number | null>(null);
    const chartAreaRef = useRef<HTMLDivElement>(null);
    const tileNavigatorRef = useRef<HTMLButtonElement>(null);
    const treemapHelpRef = useRef<HTMLButtonElement>(null);
    const treemapHelpPanelRef = useRef<HTMLDivElement>(null);
    const tileDetailPanelRef = useRef<HTMLDivElement>(null);
    const treemapQuery = useQuery({
        queryKey: ['insight-treemap', viewMode, period, metricMode],
        queryFn: ({ signal }) => fetchTreemapData(viewMode, period, metricMode, signal),
        enabled: embedded || (!isAuthLoading && !!user),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 20,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        placeholderData: (previousData) => previousData,
        retry: 1,
    });
    const canRender = Boolean(treemapQuery.data);
    // Placeholder data from another period keeps the query in success while a failed period is refetched.
    const treemapReadFailed = adminQueryLastReadFailed(treemapQuery) || (treemapQuery.isPlaceholderData && treemapQuery.errorUpdatedAt > 0);
    const isRetryingTreemap = treemapReadFailed && treemapQuery.isFetching;
    const insightsCardRef = useRef<HTMLDivElement>(null);
    const treemapRetryButtonRef = useRef<HTMLButtonElement>(null);
    const treemapRetryHadFocusRef = useRef(false);
    const insightsCardHadFocusRef = useRef(false);

    const periodOptionsForView = useMemo(() => {
        if (viewMode === 'change') {
            return PERIOD_OPTIONS.filter((option) => option.value !== 'ALL');
        }

        if (viewMode === 'all') {
            return PERIOD_OPTIONS.filter((option) => option.value !== '1D' && option.value !== '1W');
        }

        return PERIOD_OPTIONS;
    }, [viewMode]);

    useEffect(() => {
        const hasCurrentPeriod = periodOptionsForView.some((option) => option.value === period);
        if (!hasCurrentPeriod) {
            setPeriod(periodOptionsForView[0]?.value ?? '1D');
        }
    }, [periodOptionsForView, period]);

    const rawRows = useMemo(() => treemapQuery.data?.videos ?? [], [treemapQuery.data?.videos]);

    const { leafRows, leafTotalMetric, leafMetricValuesSorted } = useMemo<LeafRowsData>(() => {
        if (rawRows.length === 0) {
            return {
                leafRows: [],
                leafTotalMetric: 0,
                leafMetricValuesSorted: [],
            };
        }

        const isChangeMode = viewMode === 'change';
        const rows: TreemapLeafNode[] = [];
        let totalMetric = 0;
        const metricValues: number[] = [];

        for (let i = 0; i < rawRows.length; i += 1) {
            const row = rawRows[i];
            const metricRaw = Math.max(getMetricValue(row, metricMode), 0);
            const previousMetricRaw = getPreviousMetricValue(row, metricMode);
            const rowPercent = isChangeMode ? calculateChangePercent(metricRaw, previousMetricRaw) : 0;

            rows.push({
                id: row.id,
                name: row.title,
                title: row.title,
                category: row.category,
                viewCount: row.viewCount,
                likeCount: row.likeCount,
                commentCount: row.commentCount,
                duration: row.duration,
                publishedAt: row.publishedAt,
                value: Math.max(metricRaw, 0.25),
                metricRaw,
                previousMetricRaw,
                metricText: formatMetricText(metricMode, metricRaw),
                percent: rowPercent,
                percentText: isChangeMode ? formatSignedPercent(rowPercent) : '0%',
            });

            totalMetric += metricRaw;
            metricValues.push(metricRaw);
        }

        if (!isChangeMode) {
            for (const row of rows) {
                row.percent = totalMetric > 0 ? (row.metricRaw / totalMetric) * 100 : 0;
                row.percentText = formatPercent(row.percent);
            }
        }

        rows.sort((a, b) => b.metricRaw - a.metricRaw);

        const sortedMetricValues = [...metricValues].sort((a, b) => a - b);
        const leafMetricValuesSorted: number[] = [];
        for (const value of sortedMetricValues) {
            if (!Number.isFinite(value) || value < 0) continue;
            if (leafMetricValuesSorted.length === 0 || leafMetricValuesSorted[leafMetricValuesSorted.length - 1] !== value) {
                leafMetricValuesSorted.push(value);
            }
        }

        return {
            leafRows: rows,
            leafTotalMetric: totalMetric,
            leafMetricValuesSorted,
        };
    }, [rawRows, metricMode, viewMode]);

    const chartConstraints = useMemo(
        () => (isMobile
            ? { minWidth: 280, minHeight: 220 }
            : isTablet
                ? { minWidth: 360, minHeight: 300 }
                : { minWidth: 420, minHeight: 360 }),
        [isMobile, isTablet],
    );
    useEffect(() => {
        if (!canRender) return undefined;
        const chartArea = chartAreaRef.current;
        if (!chartArea) return undefined;

        /**
         * Samsung Internet / iPhone Safari 대응 핵심 로직:
         *
         * 1) getBoundingClientRect()으로 요소의 실제 렌더링 크기를 측정
         * 2) 높이가 0이거나 비정상이면 뷰포트에서 요소의 top 좌표를 빼서 남은 공간을 계산
         *    → Safari에서 flex 레이아웃이 아직 해결되지 않은 경우 대비
         * 3) visualViewport.height를 상한으로 사용해 주소창/하단바 영역 침범 방지
         */
        const updateLayout = () => {
            if (typeof window === 'undefined') return;

            const nextRect = chartArea.getBoundingClientRect();
            const vvHeight = window.visualViewport?.height ?? window.innerHeight;
            const vvWidth = window.visualViewport?.width ?? window.innerWidth;

            const nextWidth = Math.max(
                chartConstraints.minWidth,
                Math.floor(nextRect.width > 0 ? nextRect.width : vvWidth),
            );

            // 높이 계산: rect.height가 유효하면 사용, 아니면 viewport에서 요소 상단까지의 거리를 빼서 산출
            let measuredHeight = Math.floor(nextRect.height);
            if (measuredHeight <= 0 || measuredHeight > vvHeight) {
                // fallback: 뷰포트 높이에서 요소의 top 오프셋을 빼면 남은 공간
                measuredHeight = Math.floor(vvHeight - Math.max(0, nextRect.top));
            }

            // 삼성 인터넷: 하단 네비게이션 바가 visualViewport에 반영 안 되는 경우 대비
            // vvHeight를 넘지 않도록 클램프
            const nextHeight = Math.max(
                chartConstraints.minHeight,
                Math.min(measuredHeight, Math.floor(vvHeight)),
            );

            setChartSize((prev) => (
                prev.width === nextWidth && prev.height === nextHeight
                    ? prev
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        const scheduleUpdateLayout = () => {
            if (typeof window === 'undefined') return;

            if (layoutRafRef.current !== null) {
                window.cancelAnimationFrame(layoutRafRef.current);
            }

            layoutRafRef.current = window.requestAnimationFrame(() => {
                layoutRafRef.current = null;
                updateLayout();
            });
        };

        // 즉시 1회 + 지연 재측정 (Samsung Internet에서 레이아웃 안정화 지연 대응)
        scheduleUpdateLayout();
        const delayedTimer = window.setTimeout(() => {
            scheduleUpdateLayout();
        }, 300);

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => {
                scheduleUpdateLayout();
            });
            observer.observe(chartArea);
        }
        const viewport = typeof window !== 'undefined' ? window.visualViewport : null;

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', scheduleUpdateLayout);
            window.addEventListener('orientationchange', scheduleUpdateLayout);
        }
        if (viewport) {
            viewport.addEventListener('resize', scheduleUpdateLayout);
            viewport.addEventListener('scroll', scheduleUpdateLayout);
        }
        return () => {
            window.clearTimeout(delayedTimer);
            if (observer) {
                observer.disconnect();
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', scheduleUpdateLayout);
                window.removeEventListener('orientationchange', scheduleUpdateLayout);
            }
            if (viewport) {
                viewport.removeEventListener('resize', scheduleUpdateLayout);
                viewport.removeEventListener('scroll', scheduleUpdateLayout);
            }
            if (layoutRafRef.current !== null) {
                window.cancelAnimationFrame(layoutRafRef.current);
                layoutRafRef.current = null;
            }
        };
    }, [chartConstraints, canRender]);

    useEffect(() => {
        setChartSize((prev) => {
            const nextWidth = Math.max(initialChartSize.width, chartConstraints.minWidth);
            const nextHeight = initialChartSize.height;
            if (prev.width === nextWidth && prev.height === nextHeight) return prev;
            return { width: nextWidth, height: nextHeight };
        });
    }, [chartConstraints.minWidth, initialChartSize.width, initialChartSize.height]);

    const clusterStepOptions = useMemo(() => {
        if (leafRows.length === 0) return [];

        const dynamic = buildDynamicStepPresets(leafMetricValuesSorted, metricMode);
        const candidates = new Set<number>();

        CLUSTER_PRESET_STEPS[metricMode].forEach((step) => {
            if (step > 0) candidates.add(Math.floor(step));
        });

        dynamic.forEach((step) => {
            if (step > 0) candidates.add(Math.floor(step));
        });

        return [...candidates]
            .sort((a, b) => a - b)
            .filter((step, index, all) => {
                if (index === 0) return true;
                return step > all[index - 1];
            })
            .slice(0, 7);
    }, [leafMetricValuesSorted, leafRows.length, metricMode]);

    useEffect(() => {
        if (clusterStep === null) return;
        if (!clusterStepOptions.includes(clusterStep)) {
            setClusterStep(null);
        }
    }, [clusterStep, clusterStepOptions]);

    const treeData = useMemo<TreemapNode[]>(() => {
        if (leafRows.length === 0) return [];

        if (clusterStep !== null && clusterStep > 0) {
            const isChangeMode = viewMode === 'change';
            const cuts = buildStepBasedCuts(leafMetricValuesSorted, clusterStep);
            const totalMetric = Math.max(leafTotalMetric, 0);
            const buckets = new Map<
                number,
                {
                    metricRaw: number;
                    previousMetricRaw: number | null;
                    viewCount: number;
                    likeCount: number;
                    commentCount: number;
                    duration: number;
                    hasPrevious: boolean;
                }
            >();

            for (const row of leafRows) {
                const index = getClusterIndex(row.metricRaw, cuts);
                const current = buckets.get(index);
                const next = current ?? {
                    metricRaw: 0,
                    previousMetricRaw: null,
                    viewCount: 0,
                    likeCount: 0,
                    commentCount: 0,
                    duration: 0,
                    hasPrevious: false,
                };

                next.metricRaw += row.metricRaw;
                next.viewCount += row.viewCount;
                next.likeCount += row.likeCount;
                next.commentCount += row.commentCount;
                next.duration += row.duration;

                if (row.previousMetricRaw != null && row.previousMetricRaw > 0) {
                    next.previousMetricRaw = (next.previousMetricRaw ?? 0) + row.previousMetricRaw;
                    next.hasPrevious = true;
                }

                buckets.set(index, next);
            }

            return [...buckets.entries()]
                .map(([index, bucket]) => {
                    const label = clusterLabel(metricMode, cuts, index);
                    const metricRaw = Math.max(bucket.metricRaw, 0);
                    const percent = isChangeMode
                        ? calculateChangePercent(metricRaw, bucket.hasPrevious ? bucket.previousMetricRaw : null)
                        : (totalMetric > 0 ? (metricRaw / totalMetric) * 100 : 0);
                    const percentText = isChangeMode ? formatSignedPercent(percent) : formatPercent(percent);

                    return {
                        id: `cluster-${clusterStep}-${metricMode}-${index}`,
                        name: label,
                        title: label,
                        category: '클러스터',
                        viewCount: Math.round(bucket.viewCount),
                        likeCount: Math.round(bucket.likeCount),
                        commentCount: Math.round(bucket.commentCount),
                        duration: Math.round(bucket.duration),
                        publishedAt: null,
                        value: Math.max(metricRaw, 0.25),
                        metricRaw,
                        previousMetricRaw: bucket.hasPrevious ? bucket.previousMetricRaw : null,
                        metricText: formatMetricText(metricMode, metricRaw),
                        percent,
                        percentText,
                    };
                })
                .sort((a, b) => b.metricRaw - a.metricRaw);
        }

        if (viewMode === 'all' || viewMode === 'change') return leafRows;

        if (viewMode === 'category') {
            const grouped = new Map<
                string,
                {
                    children: TreemapLeafNode[];
                    totalMetric: number;
                }
            >();
            for (const item of leafRows) {
                const bucket = grouped.get(item.category) ?? { children: [], totalMetric: 0 };
                bucket.children.push(item);
                bucket.totalMetric += item.metricRaw;
                grouped.set(item.category, bucket);
            }

            return [...grouped.entries()]
                .map(([name, group]) => ({
                    name,
                    value: Math.max(group.totalMetric, 0.25),
                    children: [...group.children].sort((a, b) => b.metricRaw - a.metricRaw),
                }))
                .sort((a, b) => b.value - a.value);
        }

        return leafRows;
    }, [leafRows, viewMode, metricMode, clusterStep, leafMetricValuesSorted, leafTotalMetric]);
    const chartRows = useMemo(() => treeData.flatMap((entry) => isTreemapGroupNode(entry) ? entry.children : [entry]), [treeData]);
    const selectedTileIndex = selectedTileId ? chartRows.findIndex((leaf) => leaf.id === selectedTileId) : -1;
    const boundedActiveTileIndex = selectedTileIndex >= 0 ? selectedTileIndex : Math.min(activeTileIndex, Math.max(0, chartRows.length - 1));
    const selectedTile = selectedTileIndex >= 0 ? chartRows[selectedTileIndex] ?? null : null;
    useEffect(() => {
        if (selectedTileId !== null && !selectedTile) setSelectedTileId(null);
    }, [selectedTile, selectedTileId]);

    const handleChartHover = useCallback((event: ChartEvent<TreemapLeafNode> | null) => {
        if (!event?.datum) return;
        const index = chartRows.findIndex((leaf) => leaf.id === event.datum?.id);
        if (index >= 0) setActiveTileIndex(index);
    }, [chartRows]);
    const handleChartActivate = useCallback((event: ChartEvent<TreemapLeafNode>) => {
        const leaf = event.datum;
        if (!leaf) return;
        const index = chartRows.findIndex((candidate) => candidate.id === leaf.id);
        setActiveTileIndex(Math.max(0, index));
        setSelectedTileId(leaf.id);
        tileNavigatorRef.current?.focus();
    }, [chartRows]);
    const handleTileNavigatorKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
        const lastIndex = chartRows.length - 1;
        if (lastIndex < 0) return;
        let nextIndex = boundedActiveTileIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = Math.min(lastIndex, nextIndex + 1);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = Math.max(0, nextIndex - 1);
        else if (event.key === 'PageDown') nextIndex = Math.min(lastIndex, nextIndex + 10);
        else if (event.key === 'PageUp') nextIndex = Math.max(0, nextIndex - 10);
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = lastIndex;
        else return;
        event.preventDefault();
        setActiveTileIndex(nextIndex);
        if (selectedTileId !== null) setSelectedTileId(chartRows[nextIndex]?.id ?? null);
    }, [boundedActiveTileIndex, chartRows, selectedTileId]);
    useEffect(() => {
        setActiveTileIndex(0);
        setSelectedTileId(null);
    }, [viewMode, metricMode, period, clusterStep]);

    const selectedCount = treemapQuery.data?.totalVideos ?? 0;
    const metricLabel = getMetricLabel(metricMode);
    const visiblePeriod = treemapQuery.data?.period ?? period;
    const periodLabel = visiblePeriod === 'ALL' ? '전체 기간' : getPeriodLabel(visiblePeriod);
    const modeLabel = viewMode === 'change' ? '증감률' : '비율';
    const clusterContextText = clusterStep === null
        ? '개별 영상'
        : `${formatClusterValueByMode(metricMode, clusterStep)} 단위 클러스터`;
    const treemapContextText = `트리맵 기준: ${metricLabel} · ${periodLabel} · ${selectedCount.toLocaleString()}개 영상 · ${modeLabel} · ${clusterContextText}`;
    const moduleSummaryText = `${selectedCount.toLocaleString()}개 영상 · ${metricLabel} · ${periodLabel} · ${modeLabel} · ${clusterContextText}`;

    const treemapLegendText = viewMode === 'change'
        ? `칸 크기는 ${metricLabel} 지표이며, 색상은 증감률과 무관합니다. 정확한 증감률은 칸을 선택해 확인하세요.`
        : `칸 크기는 전체 ${metricLabel} 비중입니다. 강조색은 현재 지표가 가장 큰 영상이며, 정확한 값은 칸을 선택해 확인하세요.`;
    const treemapSmallCellGuidance = '작은 칸은 이름이 생략될 수 있습니다. 칸에 마우스를 올리거나 키보드로 포커스하면 상세를 확인할 수 있습니다.';

    const isWaitingForAuthorizedQuery = !embedded && (
        isAuthLoading || (!!user && !canRender && !treemapReadFailed)
    );
    const isLoading = isWaitingForAuthorizedQuery || (treemapQuery.isLoading && !canRender && !treemapReadFailed);

    const handleSetViewMode = useCallback((nextViewMode: ViewMode) => {
        startTransition(() => {
            setViewMode(nextViewMode);
        });
    }, [startTransition]);

    const handleSetMetricMode = useCallback((nextMetricMode: MetricMode) => {
        startTransition(() => {
            setMetricMode(nextMetricMode);
        });
    }, [startTransition]);

    const handleSetPeriod = useCallback((nextPeriod: InsightTreemapPeriod) => {
        startTransition(() => {
            setPeriod(nextPeriod);
        });
    }, [startTransition]);

    const handleSetClusterStep = useCallback((nextClusterStep: number | null) => {
        startTransition(() => {
            setClusterStep(nextClusterStep);
        });
    }, [startTransition]);

    const handleRetry = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        if (isRetryingTreemap) return;
        treemapRetryHadFocusRef.current = document.activeElement === event.currentTarget;
        void treemapQuery.refetch();
    }, [isRetryingTreemap, treemapQuery]);

    useLayoutEffect(() => {
        if (document.activeElement !== document.body) return;
        if (treemapReadFailed) {
            if (insightsCardHadFocusRef.current) treemapRetryButtonRef.current?.focus();
            insightsCardHadFocusRef.current = false;
        } else if (treemapRetryHadFocusRef.current) {
            insightsCardRef.current?.focus();
        }
        if (!treemapReadFailed) treemapRetryHadFocusRef.current = false;
    }, [treemapReadFailed]);


    const renderEmbeddedShell = (children: ReactNode, summary: ReactNode = moduleSummaryText) => (
        <AdminEmbeddedModuleShell
            moduleId="insights"
            titleId="admin-insights-title"
            icon={Lightbulb}
            summary={summary}
            contentClassName="p-2"
        >
            {children}
        </AdminEmbeddedModuleShell>
    );

    if (isLoading && !canRender) {
        if (embedded) {
            return renderEmbeddedShell(
                <InsightsClientLoadingSkeleton />,
                '데이터를 불러오는 중입니다.',
            );
        }

        return <InsightsClientLoadingSkeleton />;
    }
    if (treemapReadFailed || !treemapQuery.data) {
        const errorContent = (
            <div className="flex min-h-0 items-center justify-center p-6 h-full">
                <div className="text-center max-w-md w-full px-4">
                    <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <h2 className="text-xl font-bold text-foreground mb-2">문제가 발생했습니다</h2>
                    <p className="text-sm text-muted-foreground mb-6">일시적인 오류가 발생했습니다. 다시 시도해 주세요.</p>
                    <div className="flex gap-3 justify-center flex-wrap">
                        <Button
                            ref={treemapRetryButtonRef}
                            onClick={handleRetry}
                            aria-disabled={isRetryingTreemap || undefined}
                            aria-busy={isRetryingTreemap || undefined}
                            className="h-10 px-4 py-2"
                        >
                            {isRetryingTreemap ? '다시 시도하는 중…' : '다시 시도'}
                        </Button>
                        {!embedded ? (
                            <Button
                                variant="outline"
                                className="h-10 px-4 py-2"
                                onClick={() => {
                                    router.replace('/');
                                }}
                            >
                                홈으로 이동
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div>
        );

        if (embedded) {
            return renderEmbeddedShell(errorContent, '데이터를 불러오지 못했습니다.');
        }

        return errorContent;
    }


    const insightsContent = (
                <Card
                    ref={insightsCardRef}
                    tabIndex={-1}
                    data-insights-card="true"
                    onFocus={() => { insightsCardHadFocusRef.current = true; }}
                    onBlur={(event) => {
                        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) insightsCardHadFocusRef.current = false;
                    }}
                    className="overflow-x-hidden overflow-y-auto border border-border h-full flex flex-col min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <div className="shrink-0 border-b border-border p-3 md:p-4 space-y-3">
                        <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-baseline gap-3">
                                <h2 className="truncate text-base font-semibold tracking-tight">영상 성과 인사이트</h2>
                                <p className="shrink-0 text-sm text-muted-foreground">전체 {selectedCount.toLocaleString()}개</p>
                            </div>
                            <Popover
                                open={selectedTile !== null}
                                onOpenChange={(open) => setSelectedTileId(open ? chartRows[boundedActiveTileIndex]?.id ?? null : null)}
                            >
                                <PopoverTrigger asChild>
                                    <Button
                                        ref={tileNavigatorRef} type="button" size="sm" variant="outline"
                                        className="h-11 md:h-9 px-3 text-xs" disabled={chartRows.length === 0}
                                        aria-describedby="insights-treemap-navigation-help"
                                        onFocus={() => setTileNavigatorFocused(true)} onBlur={() => setTileNavigatorFocused(false)}
                                        onKeyDown={handleTileNavigatorKeyDown}
                                    >영상 탐색</Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    ref={tileDetailPanelRef} aria-label={selectedTile ? `영상 상세: ${selectedTile.title}` : '영상 상세'}
                                    side="bottom" align="end" className="w-80 max-w-[calc(100vw-1rem)] max-h-[min(calc(100dvh-1rem),var(--radix-popover-content-available-height))] overflow-y-auto space-y-2 p-3 text-sm"
                                    onOpenAutoFocus={(event) => { event.preventDefault(); tileDetailPanelRef.current?.focus(); }}
                                    onCloseAutoFocus={(event) => {
                                        if (tileNavigatorRef.current?.disabled && treemapHelpRef.current?.isConnected) {
                                            event.preventDefault(); treemapHelpRef.current.focus();
                                        }
                                    }}
                                >
                                    {selectedTile ? <>
                                        <div className="flex items-center justify-between gap-1">
                                            <Button type="button" size="sm" variant="ghost" className="h-11 px-3" disabled={boundedActiveTileIndex === 0} onClick={() => {
                                                const nextIndex = boundedActiveTileIndex - 1;
                                                setActiveTileIndex(nextIndex); setSelectedTileId(chartRows[nextIndex]?.id ?? null);
                                            }}>이전</Button>
                                            <span className="text-muted-foreground">{boundedActiveTileIndex + 1} / {chartRows.length}</span>
                                            <Button type="button" size="sm" variant="ghost" className="h-11 px-3" disabled={boundedActiveTileIndex === chartRows.length - 1} onClick={() => {
                                                const nextIndex = boundedActiveTileIndex + 1;
                                                setActiveTileIndex(nextIndex); setSelectedTileId(chartRows[nextIndex]?.id ?? null);
                                            }}>다음</Button>
                                            <Button type="button" size="sm" variant="ghost" className="h-11 px-3" onClick={() => setSelectedTileId(null)}>닫기</Button>
                                        </div>
                                        <div role="status" aria-live="polite" className="space-y-1">
                                            <TreemapDetailContent leaf={selectedTile} viewMode={viewMode} period={visiblePeriod} metricMode={metricMode} />
                                        </div>
                                    </> : null}
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="pb-1">
                            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:gap-3">
                                <fieldset className="inline-flex min-w-0 max-w-full items-center gap-2">
                                    <legend className="sr-only">표시 방식</legend><span className="text-xs text-muted-foreground">모드</span>
                                    <div className="inline-flex max-w-full overflow-x-auto border border-border" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="insights-controls">
                                        {VIEW_MODE_OPTIONS.map((option) => <Button key={option.value} type="button" size="sm" variant={viewMode === option.value ? 'default' : 'ghost'} onClick={() => handleSetViewMode(option.value)} className="h-11 md:h-9 rounded-none px-3 text-xs whitespace-nowrap">{option.label}</Button>)}
                                    </div>
                                </fieldset>
                                <fieldset className="inline-flex min-w-0 max-w-full items-center gap-2">
                                    <legend className="sr-only">지표</legend><span className="text-xs text-muted-foreground">지표</span>
                                    <div className="inline-flex max-w-full overflow-x-auto border border-border" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="insights-controls">
                                        {METRIC_OPTIONS.map((option) => <Button key={option.value} type="button" size="sm" variant={metricMode === option.value ? 'default' : 'ghost'} onClick={() => handleSetMetricMode(option.value)} className="h-11 md:h-9 rounded-none px-3 text-xs whitespace-nowrap">{option.label}</Button>)}
                                    </div>
                                </fieldset>
                                <fieldset className="inline-flex min-w-0 max-w-full items-center gap-2">
                                    <legend className="sr-only">기간</legend><span className="text-xs text-muted-foreground">기간</span>
                                    <div className="inline-flex max-w-full overflow-x-auto border border-border" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="insights-controls">
                                        {periodOptionsForView.map((option) => <Button key={option.value} type="button" size="sm" variant={period === option.value ? 'default' : 'ghost'} onClick={() => handleSetPeriod(option.value)} className="h-11 md:h-9 rounded-none px-3 text-xs whitespace-nowrap">{option.label}</Button>)}
                                    </div>
                                </fieldset>
                                <fieldset className="inline-flex min-w-0 max-w-full items-center gap-2">
                                    <legend className="sr-only">클러스터 크기</legend><span className="text-xs text-muted-foreground">클러스터</span>
                                    <div className="inline-flex max-w-full overflow-x-auto border border-border" data-allow-horizontal-scroll="true" data-horizontal-scroll-owner="insights-controls">
                                        <Button type="button" size="sm" variant={clusterStep === null ? 'default' : 'ghost'} onClick={() => handleSetClusterStep(null)} className="h-11 md:h-9 rounded-none px-3 text-xs whitespace-nowrap">전체</Button>
                                        {clusterStepOptions.map((step) => <Button key={step} type="button" size="sm" variant={clusterStep === step ? 'default' : 'ghost'} onClick={() => handleSetClusterStep(step)} className="h-11 md:h-9 rounded-none px-3 text-xs whitespace-nowrap">{formatClusterValueByMode(metricMode, step)}</Button>)}
                                    </div>
                                </fieldset>
                                <div className="ml-auto flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                                    <span className="inline-block h-3 w-3 bg-primary" aria-hidden="true" />
                                    <span>{viewMode === 'change' ? '증감률 색상 분류 미사용' : '가장 큰 값 강조'}</span>
                                    <Popover>
                                        <PopoverTrigger asChild><Button ref={treemapHelpRef} type="button" size="icon" variant="ghost" className="h-11 w-11" aria-label="트리맵 읽는 법"><Info className="h-4 w-4" aria-hidden="true" /></Button></PopoverTrigger>
                                        <PopoverContent ref={treemapHelpPanelRef} aria-label="트리맵 읽는 법" side="bottom" align="end" className="w-72 max-w-[calc(100vw-1rem)] max-h-[min(calc(100dvh-1rem),var(--radix-popover-content-available-height))] overflow-y-auto p-3 text-sm" onOpenAutoFocus={(event) => { event.preventDefault(); treemapHelpPanelRef.current?.focus(); }}>
                                            <p>{treemapLegendText}</p><p className="mt-2">{treemapSmallCellGuidance}</p>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                        </div>
                        <div className="sr-only">
                            <p id="insights-treemap-legend">{treemapLegendText}</p>
                            <p id="insights-treemap-small-cell-guidance">{treemapSmallCellGuidance}</p>
                            <p id="insights-treemap-navigation-help">트리맵 칸은 Tab과 화살표 키로 이동하고 Enter 또는 Space로 상세를 엽니다. 별도 영상 탐색 버튼에서는 화살표, Page Up/Down, Home/End로 이동합니다.</p>
                            {tileNavigatorFocused && chartRows.length > 0 ? <div role="status" aria-live="polite">{boundedActiveTileIndex + 1} / {chartRows.length}: {chartRows[boundedActiveTileIndex]?.title ?? ''}</div> : null}
                        </div>
                    </div>

                    <CardContent
                        ref={chartAreaRef}
                        className="p-0 flex-1 shrink-0 overflow-hidden"
                        // Preserve a readable chart; the card scrolls when its
                        // controls and this minimum exceed the available panel.
                        style={{ minHeight: chartConstraints.minHeight, minWidth: 0 }}
                    >
                        <div className="relative h-full w-full" style={{ minHeight: chartConstraints.minHeight }} aria-describedby="insights-treemap-legend insights-treemap-small-cell-guidance">
                            {chartRows.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">대상 데이터가 없습니다.</div>
                            ) : (
                                <ThemeProvider locale="ko-KR" theme={{
                                    bg: 'hsl(var(--background))', panel: 'hsl(var(--card))', ink: 'hsl(var(--card-foreground))',
                                    muted: 'hsl(var(--muted-foreground))', dim: 'hsl(var(--muted-foreground))',
                                    accent: 'hsl(var(--primary))', accentText: 'hsl(var(--primary))', onAccent: 'hsl(var(--primary-foreground))',
                                    line: 'hsl(var(--border))', line2: 'hsl(var(--border))', neutral: 'hsl(var(--muted))',
                                    neutralStrong: 'hsl(var(--secondary))', onNeutralStrong: 'hsl(var(--secondary-foreground))',
                                    neutralSoft: 'hsl(var(--muted))', lift: 'hsl(var(--accent))', tint: 'hsl(var(--accent))',
                                    radius: 0, radiusCode: 0, radiusMark: 0,
                                }}>
                                    <InsightsTreemap
                                        data={chartRows} label="title" value="value"
                                        group={viewMode === 'category' ? 'category' : undefined}
                                        highlight="max" labelMode="value"
                                        format={(value) => formatMetricText(metricMode, value)} locale="ko-KR"
                                        height={chartHeight} sort animateOnView
                                        onHover={handleChartHover} onClick={handleChartActivate}
                                        previewDisabled={selectedTile !== null}
                                        previewContent={(leaf) => <TreemapDetailContent leaf={leaf} viewMode={viewMode} period={visiblePeriod} metricMode={metricMode} />}
                                        ariaLabel={treemapContextText}
                                        description={`${treemapLegendText} ${treemapSmallCellGuidance}`}
                                        className="w-full"
                                    />
                                </ThemeProvider>
                            )}
                        </div>
                    </CardContent>
                </Card>
    );

    if (embedded) {
        return renderEmbeddedShell(insightsContent);
    }

    return (
        <div
            className="flex h-full min-h-0 flex-col bg-background overflow-hidden"
            data-layout-primitives="card-grid stack"
            data-scroll-owner="insights-dashboard"
        >
            <div className="flex-1 min-h-0 overflow-hidden p-2 md:p-4">
                {insightsContent}
            </div>
        </div>
    );
}






