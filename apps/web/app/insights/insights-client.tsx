'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hierarchy, treemap, treemapResquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { InsightTreemapPeriod, InsightTreemapResponse, InsightTreemapVideoRow } from '@/lib/insight/treemap';
import AdminInsightsClient from '@/app/admin/insight/insight-client';

type ViewMode = 'all' | 'cluster' | 'category';
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
    metricText: string;
    percent: number;
    percentText: string;
    color: string;
    children?: undefined;
};

type TreemapGroupNode = {
    name: string;
    children: TreemapLeafNode[];
    value: number;
};

type TreemapNode = TreemapLeafNode | TreemapGroupNode;
type TreemapRootNode = {
    name: string;
    children: TreemapNode[];
};

type TreemapCellLayout = {
    node: TreemapLeafNode;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
};

type TreemapTooltipState = {
    x: number;
    y: number;
    leaf: TreemapLeafNode;
};

const TREEMAP_COLORS = ['#414554', '#35764e', '#2f9e4f', '#30cc5a'];

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
    { value: 'all', label: '전체' },
    { value: 'cluster', label: '클러스터링' },
    { value: 'category', label: '카테고리' },
];

const METRIC_OPTIONS: { value: MetricMode; label: string }[] = [
    { value: 'views', label: '조회수' },
    { value: 'likes', label: '좋아요' },
    { value: 'comments', label: '댓글수' },
    { value: 'duration', label: '영상 길이' },
];

const PERIOD_OPTIONS: { value: InsightTreemapPeriod; label: string }[] = [
    { value: 'ALL', label: '전체' },
    { value: '1D', label: '1D' },
    { value: '1W', label: '1W' },
    { value: '1M', label: '1M' },
];

const CLUSTER_PRESET_STEPS: Record<MetricMode, number[]> = {
    views: [100_000, 300_000, 500_000, 1_000_000, 2_000_000, 5_000_000],
    likes: [50, 100, 300, 500, 1_000],
    comments: [50, 100, 300, 500, 1_000],
    duration: [30, 60, 120, 180, 300, 600],
};

let measureCanvasContext: CanvasRenderingContext2D | null = null;

async function fetchTreemapData(period: InsightTreemapPeriod): Promise<InsightTreemapResponse> {
    const response = await fetch(`/api/insights/treemap?period=${period}`);
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

function getColorByPercent(percent: number): string {
    if (percent <= 0) return TREEMAP_COLORS[0];
    if (percent <= 1) return TREEMAP_COLORS[1];
    if (percent <= 2) return TREEMAP_COLORS[2];
    return TREEMAP_COLORS[3];
}

function parseClusterStep(input: string, metricMode: MetricMode): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const raw = trimmed.split(/\s+/)[0] ?? '';
    const normalized = raw.toLowerCase().replace(/,/g, '').trim();

    if (!normalized) return null;

    if (metricMode === 'duration') {
        if (/\d+분$/.test(normalized)) {
            return Number.parseFloat(normalized.slice(0, -1).trim()) * 60;
        }

        if (/\d+초$/.test(normalized)) {
            return Number.parseFloat(normalized.slice(0, -1).trim());
        }
    }

    if (metricMode === 'views') {
        if (/\d+(\.\d+)?k$/.test(normalized)) {
            return Number.parseFloat(normalized.slice(0, -1)) * 1_000;
        }
        if (/\d+(\.\d+)?m$/.test(normalized)) {
            return Number.parseFloat(normalized.slice(0, -1)) * 1_000_000;
        }
    }

    if ((metricMode === 'likes' || metricMode === 'comments') && /개$/.test(normalized)) {
        return Number.parseFloat(normalized.slice(0, -1));
    }

    const numeric = Number.parseFloat(normalized);
    if (!Number.isFinite(numeric)) return null;

    if (metricMode === 'duration') return numeric * 60;
    return numeric;
}

function getClusterStepValue(input: string, metricMode: MetricMode): number | null {
    const parsed = parseClusterStep(input, metricMode);
    if (!Number.isFinite(parsed) || !parsed || parsed <= 0) return null;
    return Math.floor(parsed);
}

function formatClusterStepInput(metricMode: MetricMode, step: number): string {
    if (!Number.isFinite(step) || step <= 0) return '';

    if (metricMode === 'duration') {
        return `${Math.max(0, Math.round(step / 60)).toLocaleString()}분`;
    }

    return Math.round(step).toLocaleString();
}

function buildStepCutsFromValue(values: number[], step: number): number[] {
    return buildStepBasedCuts(values, step);
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

function buildDynamicStepPresets(values: number[], mode: MetricMode): number[] {
    const numeric = [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0))].sort((a, b) => a - b);
    if (numeric.length <= 1) return [];

    const max = numeric[numeric.length - 1];
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
        candidateSet.add(step);
    });

    const rawSteps = [...candidateSet]
        .filter((step) => step > 0 && step < max)
        .filter((step) => buildStepBasedCuts(numeric, step).length >= 2)
        .sort((a, b) => a - b);

    if (rawSteps.length === 0) return [];

    const filtered = rawSteps.filter((step, index, all) => {
        if (index === 0) return true;
        return step / all[index - 1] >= 1.35;
    });

    return filtered.slice(0, 6);
}

function buildClusterPresetSteps(values: number[], mode: MetricMode): { step: number; cuts: number[]; label: string; input: string }[] {
    const metricValues = values.map((value) => Math.max(0, value));

    return buildDynamicStepPresets(metricValues, mode).map((step) => {
        const cuts = buildStepBasedCuts(metricValues, step);
        return {
            step,
            cuts,
            label: formatClusterStepLabel(mode, step),
            input: formatClusterStepInput(mode, step),
        };
    });
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

function formatClusterStepLabel(mode: MetricMode, step: number): string {
    return formatClusterValueByMode(mode, step);
}

function canTextFitInWidth(text: string, fontPx: number, width: number): boolean {
    if (!text) return true;
    if (width <= 0 || !Number.isFinite(fontPx) || fontPx <= 0) return false;

    const availableWidth = Math.floor(width);

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        const estimateChars = Math.max(1, Math.floor(availableWidth / Math.max(fontPx * 0.7, 1)));
        return text.length <= estimateChars;
    }

    if (!measureCanvasContext) {
        const canvas = document.createElement('canvas');
        measureCanvasContext = canvas.getContext('2d');
    }

    if (!measureCanvasContext) {
        const estimateChars = Math.max(1, Math.floor(availableWidth / Math.max(fontPx * 0.7, 1)));
        return text.length <= estimateChars;
    }

    measureCanvasContext.font = `${Math.ceil(fontPx)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    return measureCanvasContext.measureText(text).width <= Math.max(2, availableWidth);
}

function fitMetricTextToCellWidth(
    text: string,
    width: number,
    maxFontPx: number,
    minFontPx: number,
): { text: string; fontSize: number } {
    if (!text) return { text: '', fontSize: minFontPx };

    const safeWidth = Math.max(0, width - 8);
    const maxFont = Math.max(minFontPx, Math.floor(maxFontPx));

    for (let fontSize = maxFont; fontSize >= minFontPx; fontSize -= 1) {
        if (canTextFitInWidth(text, fontSize, safeWidth)) {
            return { text, fontSize };
        }
    }

    if (safeWidth <= 2) {
        return { text: '...', fontSize: minFontPx };
    }

    const avgCharWidth = Math.max(5, Math.floor(minFontPx * 0.58));
    const maxChars = Math.max(1, Math.floor(safeWidth / avgCharWidth));
    if (text.length <= maxChars) {
        return { text, fontSize: minFontPx };
    }

    if (maxChars === 1) {
        return { text: text.slice(0, 1), fontSize: minFontPx };
    }

    if (maxChars === 2) {
        return { text: `${text[0]}…`, fontSize: minFontPx };
    }

    return { text: `${text.slice(0, maxChars - 1)}…`, fontSize: minFontPx };
}

function areCutsSame(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

function getClusterInputPlaceholder(metricMode: MetricMode): string {
    if (metricMode === 'views') {
        return '직접 구간 입력 (예: 500,000 또는 500k / 1m)';
    }

    if (metricMode === 'likes' || metricMode === 'comments') {
        return '직접 구간 입력 (예: 1,000 또는 1,000개)';
    }

    return '직접 구간 입력 (분 단위, 예: 5 또는 5분)';
}

function isGroupNode(node: TreemapNode): node is TreemapGroupNode {
    return 'children' in node && Array.isArray(node.children);
}

function getNodeValue(node: TreemapNode): number {
    if (isGroupNode(node) && node.children.length > 0) {
        return node.value;
    }
    return node.value;
}

function normalizeTreemapNode(node: TreemapNode): TreemapNode | null {
    if (isGroupNode(node)) {
        const children: TreemapLeafNode[] = [];
        for (const rawChild of node.children) {
            const normalizedChild = normalizeTreemapNode(rawChild);
            if (!normalizedChild || isGroupNode(normalizedChild)) continue;
            children.push(normalizedChild);
        }

        if (children.length === 0) return null;

        const nodeValue = children.reduce((acc, child) => acc + getNodeValue(child), 0);
        if (!Number.isFinite(nodeValue) || nodeValue <= 0) return null;

        return {
            name: node.name,
            children,
            value: nodeValue,
        };
    }

    if (!Number.isFinite(node.value) || node.value <= 0) return null;

        return node;
    }

function isLeafNode(node: TreemapNode | TreemapRootNode): node is TreemapLeafNode {
    return !('children' in node);
}

function buildTreemapLayout(
    nodes: TreemapNode[],
    width: number,
    height: number,
): TreemapCellLayout[] {
    if (nodes.length === 0 || width <= 0 || height <= 0) {
        return [];
    }

    const source: TreemapRootNode = { name: 'root', children: nodes };

    const hierarchyRoot = hierarchy<TreemapNode | TreemapRootNode>(source, (entry) =>
        isLeafNode(entry) ? undefined : entry.children,
    );

    const root = hierarchyRoot.sum((entry) => {
        if (isLeafNode(entry)) {
            return Math.max(entry.value, 0.25);
        }
        return 0;
    });

    const layoutGenerator = treemap<TreemapNode | TreemapRootNode>()
        .size([width, height])
        .paddingInner(2)
        .round(true)
        .tile(treemapResquarify);

    const laidOut = layoutGenerator(root) as HierarchyRectangularNode<TreemapNode | TreemapRootNode>;

    const leafEntries = laidOut
        .descendants()
        .filter((entry) => entry.depth > 0 && isLeafNode(entry.data));

    return leafEntries
        .map((entry): TreemapCellLayout | null => {
            if (!isLeafNode(entry.data)) {
                return null;
            }

            return {
                node: entry.data,
                x0: entry.x0,
                y0: entry.y0,
                x1: entry.x1,
                y1: entry.y1,
            };
        })
        .filter((entry): entry is TreemapCellLayout => !!entry)
        .filter((entry) => entry.x1 > entry.x0 && entry.y1 > entry.y0);
}

export default function InsightsClient() {
    const { isLoading: isAuthLoading, isAdmin } = useAuth();

    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [metricMode, setMetricMode] = useState<MetricMode>('views');
    const [period, setPeriod] = useState<InsightTreemapPeriod>('ALL');
    const [clusterCutsInput, setClusterCutsInput] = useState('');
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [chartWidth, setChartWidth] = useState(() =>
        typeof window === 'undefined' ? 1200 : Math.max(320, Math.floor(window.innerWidth - 64)),
    );
    const [tooltip, setTooltip] = useState<TreemapTooltipState | null>(null);
    const tooltipRafRef = useRef<number | null>(null);

    const treemapQuery = useQuery({
        queryKey: ['insight-treemap', period],
        queryFn: () => fetchTreemapData(period),
        staleTime: 1000 * 60 * 5,
    });

    const rawRows = treemapQuery.data?.videos ?? [];
    const renderWidth = useMemo(() => Math.max(320, chartWidth), [chartWidth]);

    const chartHeight = useMemo(() => {
        const leafCount = Math.max(rawRows.length, 1);
        const widthScale = Math.max(0.6, Math.min(1.45, renderWidth / 1024));
        const baseHeight = Math.round((Math.sqrt(leafCount) * 58 + 260) * widthScale);
        return Math.max(520, Math.min(2500, baseHeight));
    }, [rawRows.length, renderWidth]);

    useEffect(() => {
        const container = chartContainerRef.current;
        if (!container) return undefined;

        const updateWidth = () => {
            const nextWidth = Math.max(320, Math.floor(container.clientWidth));
            setChartWidth((prev) => (prev === nextWidth ? prev : nextWidth));
        };

        const scheduleUpdateWidth = () => {
            if (typeof window === 'undefined') return;
            window.requestAnimationFrame(updateWidth);
        };

        scheduleUpdateWidth();

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => {
                scheduleUpdateWidth();
            });
            observer.observe(container);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', scheduleUpdateWidth);
        }
        return () => {
            if (observer) {
                observer.disconnect();
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', scheduleUpdateWidth);
            }
        };
    }, []);

    const setTooltipThrottled = useCallback((next: TreemapTooltipState | null) => {
        if (typeof window === 'undefined') {
            setTooltip(next);
            return;
        }

        if (next === null) {
            if (tooltipRafRef.current !== null) {
                window.cancelAnimationFrame(tooltipRafRef.current);
                tooltipRafRef.current = null;
            }
            setTooltip(null);
            return;
        }

        if (tooltipRafRef.current !== null) {
            return;
        }

        tooltipRafRef.current = window.requestAnimationFrame(() => {
            tooltipRafRef.current = null;
            setTooltip(next);
        });
    }, []);

    useEffect(() => {
        return () => {
            if (tooltipRafRef.current !== null && typeof window !== 'undefined') {
                window.cancelAnimationFrame(tooltipRafRef.current);
                tooltipRafRef.current = null;
            }
        };
    }, []);

    const leafRows = useMemo(() => {
        const rows = rawRows.map((row) => ({
            row,
            metricRaw: getMetricValue(row, metricMode),
        }));

        const totalMetric = rows.reduce((acc, item) => acc + item.metricRaw, 0);

        return rows
            .map<TreemapLeafNode>((item) => {
                const metricRaw = Math.max(item.metricRaw, 0);
                const percent = totalMetric > 0 ? (metricRaw / totalMetric) * 100 : 0;
                return {
                    id: item.row.id,
                    name: item.row.title,
                    title: item.row.title,
                    category: item.row.category,
                    viewCount: item.row.viewCount,
                    likeCount: item.row.likeCount,
                    commentCount: item.row.commentCount,
                    duration: item.row.duration,
                    publishedAt: item.row.publishedAt,
                    value: Math.max(metricRaw, 0.25),
                    metricRaw,
                    metricText: formatMetricText(metricMode, metricRaw),
                    percent,
                    percentText: formatPercent(percent),
                    color: getColorByPercent(percent),
                };
            })
            .sort((a, b) => b.metricRaw - a.metricRaw);
    }, [rawRows, metricMode]);

    const metricValues = leafRows.map((item) => item.metricRaw);
    const stepClusterPresets = useMemo(() => buildClusterPresetSteps(metricValues, metricMode), [metricValues, metricMode]);

    const fallbackStep = useMemo(() => {
        if (stepClusterPresets.length > 0) return stepClusterPresets[0].step;

        const positiveValues = metricValues.filter((value) => value > 0).sort((a, b) => a - b);
        if (positiveValues.length === 0) return 0;
        const max = positiveValues[positiveValues.length - 1];
        return Math.max(1, Math.floor(max / 5));
    }, [stepClusterPresets, metricValues]);

    const selectedStep = useMemo(() => {
        const parsed = getClusterStepValue(clusterCutsInput, metricMode);
        return parsed ?? fallbackStep;
    }, [clusterCutsInput, metricMode, fallbackStep]);

    const clusterCuts = useMemo(() => buildStepCutsFromValue(metricValues, selectedStep), [metricValues, selectedStep]);

    useEffect(() => {
        if (viewMode !== 'cluster') return;

        const nextInput = formatClusterStepInput(metricMode, selectedStep);
        setClusterCutsInput((prev) => {
            if (prev === nextInput) return prev;
            return nextInput;
        });
    }, [selectedStep, metricMode, viewMode]);

    const treeData = useMemo<TreemapNode[]>(() => {
        if (leafRows.length === 0) return [];

        if (viewMode === 'all') return leafRows;
        const total = Math.max(leafRows.reduce((acc, item) => acc + item.metricRaw, 0), 0);

        if (viewMode === 'category') {
            const grouped = new Map<string, TreemapLeafNode[]>();
            for (const item of leafRows) {
                const bucket = grouped.get(item.category) ?? [];
                bucket.push(item);
                grouped.set(item.category, bucket);
            }

            return [...grouped.entries()]
                .map(([name, children]) => ({
                    name,
                    value: Math.max(children.reduce((acc, item) => acc + Math.max(item.metricRaw, 0), 0), 0.25),
                    children: [...children].sort((a, b) => b.metricRaw - a.metricRaw),
                }))
                .sort((a, b) => {
                    const aSum = a.children.reduce((acc, item) => acc + item.metricRaw, 0);
                    const bSum = b.children.reduce((acc, item) => acc + item.metricRaw, 0);
                    return bSum - aSum;
                });
        }

        const grouped = new Map<number, TreemapLeafNode[]>();
        for (const item of leafRows) {
            const index = getClusterIndex(item.metricRaw, clusterCuts);
            const bucket = grouped.get(index) ?? [];
            bucket.push(item);
            grouped.set(index, bucket);
        }

        const clusters = [...grouped.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([index, children]) => {
                const sum = children.reduce((acc, item) => acc + Math.max(item.metricRaw, 0), 0);
                const bucketCount = children.length;
                const bucketPercent = total > 0 ? (sum / total) * 100 : 0;
                const label = clusterLabel(metricMode, clusterCuts, index);
                const metricText = `${formatMetricText(metricMode, sum)} (${bucketCount.toLocaleString()}개)`;
                const bucketViewSum = children.reduce((acc, item) => acc + Math.max(item.viewCount, 0), 0);
                const bucketLikeSum = children.reduce((acc, item) => acc + Math.max(item.likeCount, 0), 0);
                const bucketCommentSum = children.reduce((acc, item) => acc + Math.max(item.commentCount, 0), 0);
                const bucketDurationSum = children.reduce((acc, item) => acc + Math.max(item.duration, 0), 0);

                return {
                    id: `cluster-${metricMode}-${index}-${label}`,
                    name: `${label} (${bucketCount.toLocaleString()}개)`,
                    title: label,
                    category: `클러스터 (${bucketCount.toLocaleString()}개)`,
                    viewCount: bucketViewSum,
                    likeCount: bucketLikeSum,
                    commentCount: bucketCommentSum,
                    duration: bucketDurationSum,
                    publishedAt: null,
                    value: Math.max(sum, 0.25),
                    metricRaw: Math.max(sum, 0),
                    metricText,
                    percent: bucketPercent,
                    percentText: formatPercent(bucketPercent),
                    color: getColorByPercent(bucketPercent),
                    children: undefined,
                };
            });

        return clusters;
    }, [leafRows, viewMode, metricMode, clusterCuts]);

    const safeTreeData = useMemo<TreemapNode[]>(() => {
        const normalized = treeData
            .map((node) => normalizeTreemapNode(node))
            .filter((node): node is TreemapNode => {
                if (!node) return false;
                if (isGroupNode(node)) {
                    return node.children.length > 0;
                }
                return true;
            });

        if (normalized.length === 0) return [];

        return normalized;
    }, [treeData]);

    const treemapCells = useMemo<TreemapCellLayout[]>(() => {
        if (safeTreeData.length === 0) return [];
        return buildTreemapLayout(safeTreeData, renderWidth, chartHeight);
    }, [safeTreeData, renderWidth, chartHeight]);

    const selectedCount = treemapQuery.data?.totalVideos ?? 0;

    const isLoading = isAuthLoading || treemapQuery.isLoading;

    const handleResetFilters = () => {
        setViewMode('all');
        setMetricMode('views');
        setPeriod('ALL');
        setClusterCutsInput('');
        treemapQuery.refetch();
    };

    if (isAuthLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">사용자 권한을 확인하는 중입니다.</div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    인사이트를 불러오는 중입니다.
                </div>
            </div>
        );
    }

    if (treemapQuery.isError || !treemapQuery.data) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-xl">
                    <CardContent className="space-y-4 pt-6">
                        <p className="text-sm text-muted-foreground">트리맵 데이터를 불러오지 못했습니다.</p>
                        <div className="flex items-center justify-end">
                            <Button variant="secondary" onClick={handleResetFilters}>
                                다시 조회
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (isAdmin) {
        return <AdminInsightsClient />;
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-y-auto">
            <div className="p-4 md:p-6 flex-1">
                <Card className="overflow-hidden border border-border">
                    <div className="p-3 md:p-4 border-b border-border">
                        <div className="flex flex-wrap items-center gap-2 md:gap-3">
                            <p className="text-xs md:text-sm text-muted-foreground whitespace-nowrap">전체 {selectedCount.toLocaleString()}개</p>

                            <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                {VIEW_MODE_OPTIONS.map((option) => (
                                    <Button
                                        key={option.value}
                                        size="sm"
                                        variant={viewMode === option.value ? 'default' : 'ghost'}
                                        onClick={() => setViewMode(option.value)}
                                        className="rounded-none h-8 px-3"
                                    >
                                        {option.label}
                                    </Button>
                                ))}
                            </div>

                            <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                {METRIC_OPTIONS.map((option) => (
                                    <Button
                                        key={option.value}
                                        size="sm"
                                        variant={metricMode === option.value ? 'default' : 'ghost'}
                                        onClick={() => setMetricMode(option.value)}
                                        className="rounded-none h-8 px-3"
                                    >
                                        {option.label}
                                    </Button>
                                ))}
                            </div>

                            <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                {PERIOD_OPTIONS.map((option) => (
                                    <Button
                                        key={option.value}
                                        size="sm"
                                        variant={period === option.value ? 'default' : 'ghost'}
                                        onClick={() => setPeriod(option.value)}
                                        className="rounded-none h-8 px-3"
                                    >
                                        {option.label}
                                    </Button>
                                ))}
                            </div>

                            {viewMode === 'cluster' ? (
                                <div className="inline-flex flex-wrap items-center gap-2">
                                    <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                        {stepClusterPresets.map((preset) => (
                                            <Button
                                                key={`${metricMode}-${preset.step}`}
                                                size="sm"
                                                variant={areCutsSame(clusterCuts, preset.cuts) ? 'default' : 'ghost'}
                                                onClick={() => setClusterCutsInput(preset.input)}
                                                className="rounded-none h-8 px-3"
                                            >
                                                {preset.label}
                                            </Button>
                                        ))}
                                    </div>
                                    <Input
                                        className="h-8 min-w-[96px] w-[108px] max-w-[124px] text-sm"
                                        value={clusterCutsInput}
                                        onChange={(e) => setClusterCutsInput(e.target.value)}
                                        placeholder={getClusterInputPlaceholder(metricMode)}
                                    />
                                </div>
                            ) : null}

                            <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
                                <span className="text-[11px] text-muted-foreground">색상</span>
                                <div className="inline-flex overflow-hidden rounded-md border border-border">
                                    <div
                                        className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                        style={{
                                            background: TREEMAP_COLORS[0],
                                            minWidth: 50,
                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                        }}
                                    >
                                        0%
                                    </div>
                                    <div
                                        className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                        style={{
                                            background: TREEMAP_COLORS[1],
                                            minWidth: 50,
                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                        }}
                                    >
                                        +1%
                                    </div>
                                    <div
                                        className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                        style={{
                                            background: TREEMAP_COLORS[2],
                                            minWidth: 50,
                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                        }}
                                    >
                                        +2%
                                    </div>
                                    <div
                                        className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                        style={{
                                            background: TREEMAP_COLORS[3],
                                            minWidth: 50,
                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                        }}
                                    >
                                        +3%
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <CardContent className="p-0">
                        <div
                            ref={chartContainerRef}
                            style={{
                                position: 'relative',
                                width: '100%',
                                height: `${chartHeight}px`,
                            }}
                        >
                            {safeTreeData.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">대상 데이터가 없습니다.</div>
                            ) : (
                                <div className="relative h-full w-full">
                                    {treemapCells.map((cell) => {
                                        const leaf = cell.node;
                                        const width = Math.max(0, cell.x1 - cell.x0);
                                        const height = Math.max(0, cell.y1 - cell.y0);
                                        const canShowBoth = width >= 52 && height >= 34;
                                        const canShowOneLine = width >= 20 && height >= 14;
                                        const canShowEllipsis = width >= 12 && height >= 12;
                                        const shortSide = Math.max(0, Math.min(width, height));
                                        const metricFont = Math.max(10, Math.min(24, shortSide * 0.25));
                                        const percentFont = Math.max(8, Math.min(14, shortSide * 0.17));
                                        const miniFont = Math.max(9, Math.min(14, shortSide * 0.45));

                                        const metricDisplay = fitMetricTextToCellWidth(leaf.metricText, width, metricFont, Math.max(7, miniFont - 2));
                                        const fallbackDisplay = fitMetricTextToCellWidth(leaf.metricText, width, miniFont, 7);

                                        const percentCanFit = canTextFitInWidth(leaf.percentText, percentFont, width - 10);

                                        return (
                                            <div
                                                key={`${leaf.id}-${leaf.title}-${leaf.value}-${cell.x0}-${cell.y0}`}
                                                className="absolute flex items-center justify-center border border-white/30"
                                                style={{
                                                    left: cell.x0,
                                                    top: cell.y0,
                                                    width,
                                                    height,
                                                    backgroundColor: leaf.color,
                                                    overflow: 'hidden',
                                                    boxSizing: 'border-box',
                                                }}
                                                onMouseEnter={(event) => {
                                                    setTooltipThrottled({
                                                        leaf,
                                                        x: event.clientX + 12,
                                                        y: event.clientY + 12,
                                                    });
                                                }}
                                                onMouseMove={(event) => {
                                                    setTooltipThrottled({
                                                        leaf,
                                                        x: event.clientX + 12,
                                                        y: event.clientY + 12,
                                                    });
                                                }}
                                                onMouseLeave={() => {
                                                    setTooltipThrottled(null);
                                                }}
                                                    >
                                                {canShowBoth ? (
                                                    <div
                                                        className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center"
                                                        style={{
                                                            color: '#ffffff',
                                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                                        }}
                                                    >
                                                        <span
                                                            title={leaf.metricText}
                                                            className="w-full text-center overflow-hidden whitespace-nowrap leading-tight font-semibold"
                                                            style={{ fontSize: `${metricDisplay.fontSize}px` }}
                                                        >
                                                            {metricDisplay.text}
                                                        </span>
                                                        <span
                                                            title={leaf.percentText}
                                                            className="w-full text-center overflow-hidden whitespace-nowrap leading-tight"
                                                            style={{ fontSize: `${percentFont}px` }}
                                                        >
                                                            {percentCanFit ? leaf.percentText : '...'}
                                                        </span>
                                                    </div>
                                                ) : canShowOneLine ? (
                                                    <div
                                                        className="flex h-full w-full items-center justify-center px-1 text-center"
                                                        style={{
                                                            color: '#ffffff',
                                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                                        }}
                                                    >
                                                        <span
                                                        className="w-full overflow-hidden whitespace-nowrap font-semibold leading-tight"
                                                            style={{ fontSize: `${fallbackDisplay.fontSize}px` }}
                                                        >
                                                            {fallbackDisplay.text}
                                                        </span>
                                                    </div>
                                                ) : canShowEllipsis ? (
                                                    <div
                                                        className="flex h-full w-full items-center justify-center px-1 text-center"
                                                        style={{
                                                            color: '#ffffff',
                                                            textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                                            fontSize: `${fallbackDisplay.fontSize}px`,
                                                            lineHeight: 1,
                                                            fontWeight: 700,
                                                        }}
                                                    >
                                                        {fallbackDisplay.text}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {tooltip ? (
                                <div
                                    className="pointer-events-none fixed z-20 rounded-md border border-border bg-card p-2 text-xs text-card-foreground shadow-lg"
                                    style={{ left: tooltip.x, top: tooltip.y }}
                                >
                                    <p className="font-semibold">{tooltip.leaf.title}</p>
                                    <p>카테고리: {tooltip.leaf.category}</p>
                                    <p>조회수: {formatTooltipMetric('views', tooltip.leaf.viewCount)}</p>
                                    <p>좋아요: {formatTooltipMetric('likes', tooltip.leaf.likeCount)}</p>
                                    <p>댓글수: {formatTooltipMetric('comments', tooltip.leaf.commentCount)}</p>
                                    <p>영상 길이: {formatTooltipMetric('duration', tooltip.leaf.duration)}</p>
                                    <p>전체 기준: {tooltip.leaf.percentText}</p>
                                </div>
                            ) : null}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
