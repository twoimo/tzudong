'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { hierarchy, treemap, treemapResquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { InsightTreemapPeriod, InsightTreemapResponse, InsightTreemapVideoRow } from '@/lib/insight/treemap';
import AdminInsightsClient from '@/app/admin/insight/insight-client';
import { useDeviceType } from '@/hooks/useDeviceType';

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

type ChartDimensions = {
    width: number;
    height: number;
};

type TreemapTileInteraction = (leaf: TreemapLeafNode, event: MouseEvent<HTMLDivElement>) => void;

type TreemapCellRenderInput = {
    leaf: TreemapLeafNode;
    x: number;
    y: number;
    width: number;
    height: number;
    metricText: string;
    metricFontSize: number;
    percentText: string;
    percentFontSize: number;
    canShowBoth: boolean;
    canShowOneLine: boolean;
    canShowEllipsis: boolean;
};

type TreemapTilesProps = {
    cells: TreemapCellLayout[];
    onCellEnter: TreemapTileInteraction;
    onCellMove: TreemapTileInteraction;
    onCellLeave: () => void;
};

const TREEMAP_TEXT_CACHE_LIMIT = 3_000;
const treemapTextFitCache = new Map<string, { text: string; fontSize: number }>();

const TREEMAP_COLORS = ['#414554', '#35764e', '#2f9e4f', '#30cc5a'];

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
    disabled?: boolean;
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

let measureCanvasContext: CanvasRenderingContext2D | null = null;

async function fetchTreemapData(viewMode: ViewMode, period: InsightTreemapPeriod, metricMode: MetricMode): Promise<InsightTreemapResponse> {
    const params = new URLSearchParams({
        period,
        viewMode,
        metricMode,
    });
    const response = await fetch(`/api/insights/treemap?${params.toString()}`);
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

function formatNonNegativePercent(value: number): string {
    if (!Number.isFinite(value)) return '0%';
    return `${Math.max(0, value).toFixed(2)}%`;
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
        const estimateChars = Math.max(1, Math.floor((availableWidth * 0.94) / Math.max(fontPx * 0.7, 1)));
        return text.length <= estimateChars;
    }

    if (!measureCanvasContext) {
        const canvas = document.createElement('canvas');
        measureCanvasContext = canvas.getContext('2d');
    }

    if (!measureCanvasContext) {
        const estimateChars = Math.max(1, Math.floor((availableWidth * 0.94) / Math.max(fontPx * 0.7, 1)));
        return text.length <= estimateChars;
    }

    const safeAvailableWidth = Math.max(2, Math.floor(availableWidth * 0.94));
    measureCanvasContext.font = `${Math.ceil(fontPx)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    return measureCanvasContext.measureText(text).width <= safeAvailableWidth;
}

function fitMetricTextToCellWidth(
    text: string,
    width: number,
    height: number,
    maxFontPx: number,
    minFontPx: number,
): { text: string; fontSize: number } {
    if (!text) return { text: '', fontSize: minFontPx };

    const safeWidth = Math.max(1, width - 8);
    const safeHeight = Math.max(1, height - 4);
    const maxFontByHeight = Math.max(1, Math.floor(safeHeight * 0.92));
    const minFont = Math.max(1, Math.min(minFontPx, maxFontByHeight));
    const maxFont = Math.max(minFont, Math.min(maxFontPx, maxFontByHeight));

    if (!canTextFitInWidth('.', Math.max(1, minFont), safeWidth) || safeHeight < 2 || safeWidth < 4) {
        return { text: '', fontSize: minFont };
    }

    for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 1) {
        if (canTextFitInWidth(text, fontSize, safeWidth)) {
            return { text, fontSize };
        }
    }

    if (safeWidth <= 3 || safeHeight <= 2) {
        return { text: '', fontSize: minFont };
    }

    const avgCharWidth = Math.max(5, Math.floor(minFont * 0.58));
    const maxChars = Math.max(1, Math.floor(safeWidth / avgCharWidth));

    if (text.length <= maxChars && canTextFitInWidth(text, minFont, safeWidth)) {
        return { text, fontSize: minFont };
    }

    const fallbackEllipsis = canTextFitInWidth('...', minFont, safeWidth) ? '...' : '';

    if (maxChars === 1) {
        const single = text.slice(0, 1);
        return canTextFitInWidth(single, minFont, safeWidth)
            ? { text: single, fontSize: minFont }
            : { text: fallbackEllipsis, fontSize: minFont };
    }

    if (maxChars === 2) {
        const short = `${text[0]}…`;
        return canTextFitInWidth(short, minFont, safeWidth) ? { text: short, fontSize: minFont } : { text: fallbackEllipsis, fontSize: minFont };
    }

    const fallback = `${text.slice(0, maxChars - 1)}…`;
    return canTextFitInWidth(fallback, minFont, safeWidth) ? { text: fallback, fontSize: minFont } : { text: fallbackEllipsis, fontSize: minFont };
}

function fitMetricTextToCellWidthCached(
    text: string,
    width: number,
    height: number,
    maxFontPx: number,
    minFontPx: number,
): { text: string; fontSize: number } {
    const key = `${text}|${Math.round(width)}|${Math.round(height)}|${maxFontPx}|${minFontPx}`;
    const cached = treemapTextFitCache.get(key);
    if (cached) {
        return cached;
    }

    const result = fitMetricTextToCellWidth(text, width, height, maxFontPx, minFontPx);

    if (treemapTextFitCache.size >= TREEMAP_TEXT_CACHE_LIMIT) {
        treemapTextFitCache.clear();
    }

    treemapTextFitCache.set(key, result);
    return result;
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

const TreemapTiles = memo(function TreemapTiles({
    cells,
    onCellEnter,
    onCellMove,
    onCellLeave,
}: TreemapTilesProps) {
    const renderedTiles = useMemo<TreemapCellRenderInput[]>(() => {
        return cells.map((cell) => {
            const leaf = cell.node;
            const width = Math.max(0, cell.x1 - cell.x0);
            const height = Math.max(0, cell.y1 - cell.y0);
            const tileArea = Math.max(1, width * height);
            const tileInnerHeight = Math.max(6, height - 6);
            const tileBaseSize = Math.sqrt(tileArea);
            const metricFont = Math.max(10, Math.min(54, Math.floor(tileBaseSize * 0.19)));
            const percentFont = Math.max(8, Math.min(24, Math.floor(metricFont * 0.6)));
            const miniFont = Math.max(8, Math.min(20, Math.floor(metricFont * 0.86)));
            const tinyFont = Math.max(8, Math.floor(Math.min(width, height) * 0.38));

            if (width < 16 || height < 16) {
                return {
                    leaf,
                    x: Math.trunc(cell.x0),
                    y: Math.trunc(cell.y0),
                    width: Math.trunc(width),
                    height: Math.trunc(height),
                    metricText: '...',
                    metricFontSize: tinyFont,
                    percentText: leaf.percentText,
                    percentFontSize: 0,
                    canShowBoth: false,
                    canShowOneLine: false,
                    canShowEllipsis: true,
                };
            }

            const metricDisplay = fitMetricTextToCellWidthCached(
                leaf.metricText,
                width,
                Math.max(12, tileInnerHeight),
                metricFont,
                miniFont,
            );
            const fallbackDisplay = fitMetricTextToCellWidthCached(
                leaf.metricText,
                width,
                Math.max(12, tileInnerHeight),
                miniFont,
                Math.max(6, Math.min(12, Math.max(1, Math.floor(Math.min(width, height) * 0.4)))),
            );
            const percentDisplay = fitMetricTextToCellWidthCached(
                leaf.percentText,
                width,
                Math.max(6, Math.floor(Math.max(12, tileInnerHeight) * 0.3)),
                percentFont,
                7,
            );

            const bothLineContentHeight = metricDisplay.fontSize + percentDisplay.fontSize + 4;
            const canShowBoth = width >= 24 && tileArea >= 220 && bothLineContentHeight <= Math.max(10, tileInnerHeight - 2);
            const canShowOneLine = width >= 14 && tileArea >= 150 && fallbackDisplay.fontSize <= Math.max(10, tileInnerHeight - 2);
            const canShowEllipsis = width >= 12 && height >= 12;

            return {
                leaf,
                x: Math.trunc(cell.x0),
                y: Math.trunc(cell.y0),
                width: Math.trunc(width),
                height: Math.trunc(height),
                metricText: canShowBoth ? leaf.metricText : fallbackDisplay.text,
                metricFontSize: canShowBoth ? metricDisplay.fontSize : fallbackDisplay.fontSize,
                percentText: percentDisplay.text,
                percentFontSize: percentDisplay.fontSize,
                canShowBoth,
                canShowOneLine: canShowOneLine && !canShowBoth,
                canShowEllipsis,
            };
        });
    }, [cells]);

    if (renderedTiles.length === 0) {
        return null;
    }

    return (
        <div className="relative h-full w-full">
            {renderedTiles.map((tile) => (
                <div
                    key={`${tile.leaf.id}-${tile.x}-${tile.y}-${tile.leaf.value}`}
                    className="absolute flex items-center justify-center border border-white/30"
                    style={{
                        left: tile.x,
                        top: tile.y,
                        width: tile.width,
                        height: tile.height,
                        backgroundColor: tile.leaf.color,
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                    }}
                    onMouseEnter={(event) => onCellEnter(tile.leaf, event)}
                    onMouseMove={(event) => onCellMove(tile.leaf, event)}
                    onMouseLeave={onCellLeave}
                >
                    {tile.canShowBoth ? (
                        <div
                            className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center"
                            style={{
                                color: '#ffffff',
                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                            }}
                        >
                            <span
                                title={tile.leaf.metricText}
                                className="w-full truncate text-center overflow-hidden whitespace-nowrap leading-tight font-semibold"
                                style={{
                                    fontSize: `${tile.metricFontSize}px`,
                                    lineHeight: 1,
                                }}
                            >
                                {tile.metricText}
                            </span>
                            <span
                                title={tile.percentText}
                                className="w-full truncate text-center overflow-hidden whitespace-nowrap leading-tight"
                                style={{
                                    fontSize: `${tile.percentFontSize}px`,
                                    lineHeight: 1,
                                }}
                            >
                                {tile.percentText}
                            </span>
                        </div>
                    ) : tile.canShowOneLine ? (
                        <div
                            className="flex h-full w-full items-center justify-center px-1 text-center"
                            style={{
                                color: '#ffffff',
                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                            }}
                        >
                            <span
                                className="w-full truncate overflow-hidden whitespace-nowrap font-semibold leading-tight"
                                style={{
                                    fontSize: `${tile.metricFontSize}px`,
                                    lineHeight: 1,
                                }}
                            >
                                {tile.metricText}
                            </span>
                        </div>
                    ) : tile.canShowEllipsis ? (
                        <div
                            className="flex h-full w-full items-center justify-center px-1 text-center"
                            style={{
                                color: '#ffffff',
                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                fontSize: `${tile.metricFontSize}px`,
                                lineHeight: 1,
                                fontWeight: 700,
                            }}
                        >
                            {tile.metricText}
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
});

export default function InsightsClient() {
    const router = useRouter();
    const { isLoading: isAuthLoading, isAdmin, user } = useAuth();
    const { isMobile, isTablet } = useDeviceType();

    useEffect(() => {
        if (!isAuthLoading && !user) {
            router.replace('/');
        }
    }, [isAuthLoading, user, router]);

    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [metricMode, setMetricMode] = useState<MetricMode>('views');
    const [clusterStep, setClusterStep] = useState<number | null>(null);
    const [period, setPeriod] = useState<InsightTreemapPeriod>('ALL');
    const initialChartSize = useMemo(() => {
        return getInitialChartSize(isMobile, isTablet);
    }, [isMobile, isTablet]);

    const [chartSize, setChartSize] = useState<ChartDimensions>(() => getInitialChartSize(isMobile, isTablet));
    const chartWidth = chartSize.width;
    const chartHeight = chartSize.height;
    const [tooltip, setTooltip] = useState<TreemapTooltipState | null>(null);
    const tooltipStateRef = useRef<TreemapTooltipState | null>(null);
    const tooltipRafRef = useRef<number | null>(null);
    const layoutRafRef = useRef<number | null>(null);
    const chartAreaRef = useRef<HTMLDivElement>(null);

    const treemapQuery = useQuery({
        queryKey: ['insight-treemap', viewMode, period, metricMode],
        queryFn: () => fetchTreemapData(viewMode, period, metricMode),
        enabled: !isAuthLoading && !!user,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 20,
        placeholderData: (previousData) => previousData,
    });

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

    const rawRows = treemapQuery.data?.videos ?? [];
    const renderWidth = useMemo(() => Math.max(1, chartWidth), [chartWidth]);

    const leafRowsWithMetric = useMemo(
        () =>
            rawRows.map((row) => ({
                row,
                metricRaw: getMetricValue(row, metricMode),
                previousMetricRaw: getPreviousMetricValue(row, metricMode),
            })),
        [rawRows, metricMode],
    );

    const leafRows = useMemo(() => {
        if (leafRowsWithMetric.length === 0) return [] as TreemapLeafNode[];

        const isChangeMode = viewMode === 'change';
        const totalMetric = leafRowsWithMetric.reduce((acc, item) => acc + Math.max(item.metricRaw, 0), 0);

        return leafRowsWithMetric
            .map<TreemapLeafNode>((item) => {
                const metricRaw = Math.max(item.metricRaw, 0);
                const percent = isChangeMode ? calculateChangePercent(metricRaw, item.previousMetricRaw) : (totalMetric > 0 ? (metricRaw / totalMetric) * 100 : 0);
                const percentText = isChangeMode ? formatNonNegativePercent(percent) : formatPercent(percent);
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
                    previousMetricRaw: item.previousMetricRaw,
                    metricText: formatMetricText(metricMode, metricRaw),
                    percent,
                    percentText,
                    color: getColorByPercent(percent),
                };
            })
            .sort((a, b) => b.metricRaw - a.metricRaw);
    }, [leafRowsWithMetric, metricMode, viewMode]);

    const chartConstraints = useMemo(
        () => (isMobile
            ? { minWidth: 280, minHeight: 220 }
            : isTablet
                ? { minWidth: 360, minHeight: 300 }
                : { minWidth: 420, minHeight: 360 }),
        [isMobile, isTablet],
    );

    useEffect(() => {
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
    }, [chartConstraints]);

    useEffect(() => {
        setChartSize((prev) => {
            const nextWidth = Math.max(initialChartSize.width, chartConstraints.minWidth);
            const nextHeight = initialChartSize.height;
            if (prev.width === nextWidth && prev.height === nextHeight) return prev;
            return { width: nextWidth, height: nextHeight };
        });
    }, [chartConstraints.minWidth, initialChartSize.width, initialChartSize.height]);

    const setTooltipThrottled = useCallback((next: TreemapTooltipState | null) => {
        if (typeof window === 'undefined') {
            tooltipStateRef.current = next;
            setTooltip(next);
            return;
        }

        if (next === null) {
            if (tooltipRafRef.current !== null) {
                window.cancelAnimationFrame(tooltipRafRef.current);
                tooltipRafRef.current = null;
            }
            tooltipStateRef.current = null;
            setTooltip(null);
            return;
        }

        const prev = tooltipStateRef.current;
        if (prev && prev.leaf.id === next.leaf.id) {
            const dx = Math.abs(prev.x - next.x);
            const dy = Math.abs(prev.y - next.y);
            if (dx <= 24 && dy <= 16) {
                return;
            }
        }

        tooltipStateRef.current = next;

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

    const clusterStepOptions = useMemo(() => {
        if (leafRows.length === 0) return [];

        const values = leafRows.map((row) => row.metricRaw);
        const dynamic = buildDynamicStepPresets(values, metricMode);
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
    }, [leafRows, metricMode]);

    const leafTotalMetric = useMemo(() => leafRows.reduce((acc, item) => acc + item.metricRaw, 0), [leafRows]);

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
            const values = leafRows.map((row) => row.metricRaw);
            const cuts = buildStepBasedCuts(values, clusterStep);
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
                    const percentText = isChangeMode ? formatNonNegativePercent(percent) : formatPercent(percent);

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
                        color: getColorByPercent(percent),
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
    }, [leafRows, viewMode, metricMode, clusterStep]);

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
    const canRender = Boolean(treemapQuery.data);

    const handleCellEnter = useCallback(
        (leaf: TreemapLeafNode, event: MouseEvent<HTMLDivElement>) => {
            setTooltipThrottled({
                leaf,
                x: event.clientX + 12,
                y: event.clientY + 12,
            });
        },
        [setTooltipThrottled],
    );

    const handleCellMove = handleCellEnter;

    const handleCellLeave = useCallback(() => {
        setTooltipThrottled(null);
    }, [setTooltipThrottled]);

    const handleResetFilters = () => {
        setViewMode('all');
        setMetricMode('views');
        setPeriod('ALL');
        setClusterStep(null);
        treemapQuery.refetch();
    };

    if (isAuthLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">사용자 권한을 확인하는 중입니다.</div>
            </div>
        );
    }

    if (isLoading && !canRender) {
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
            <div className="flex min-h-0 items-center justify-center p-6 h-full">
                <div className="text-center max-w-md w-full px-4">
                    <div className="text-4xl mb-4">⚠️</div>
                    <h2 className="text-xl font-bold text-foreground mb-2">문제가 발생했습니다</h2>
                    <p className="text-sm text-muted-foreground mb-6">일시적인 오류가 발생했습니다. 다시 시도해 주세요.</p>
                    <div className="flex gap-3 justify-center flex-wrap">
                        <Button
                            onClick={handleResetFilters}
                            className="h-10 px-4 py-2"
                        >
                            다시 시도
                        </Button>
                        <Button
                            variant="outline"
                            className="h-10 px-4 py-2"
                            onClick={() => {
                                router.replace('/');
                            }}
                        >
                            홈으로 이동
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    if (isAdmin) {
        return <AdminInsightsClient />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-background overflow-hidden">
            <div className="p-2 md:p-4 flex-1 min-h-0 overflow-hidden">
                <Card className="overflow-hidden border border-border h-full flex flex-col min-h-0">
                    <div className="border-b border-border p-2 md:p-3">
                        <div className="overflow-x-auto pb-2">
                            <div className="flex w-full flex-wrap items-start md:items-center gap-2 md:gap-3 min-w-max">
                                <p className="text-xs md:text-sm text-muted-foreground whitespace-nowrap self-center">전체 {selectedCount.toLocaleString()}개</p>

                                <div className="inline-flex items-center gap-1 sm:gap-2 shrink-0">
                                    <span className="text-[11px] text-muted-foreground">모드</span>
                                    <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                        {VIEW_MODE_OPTIONS.map((option) => (
                                            <Button
                                                key={option.value}
                                                size="sm"
                                                variant={viewMode === option.value ? 'default' : 'ghost'}
                                                onClick={() => setViewMode(option.value)}
                                                className="rounded-none h-8 px-2.5 text-[11px] whitespace-nowrap"
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>

                                <div className="inline-flex items-center gap-1 sm:gap-2 shrink-0">
                                    <span className="text-[11px] text-muted-foreground">지표</span>
                                    <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                        {METRIC_OPTIONS.map((option) => (
                                            <Button
                                                key={option.value}
                                                size="sm"
                                                variant={metricMode === option.value ? 'default' : 'ghost'}
                                                onClick={() => setMetricMode(option.value)}
                                                className="rounded-none h-8 px-2.5 text-[11px] whitespace-nowrap"
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>

                                <div className="inline-flex items-center gap-1 sm:gap-2 shrink-0">
                                    <span className="text-[11px] text-muted-foreground">기준</span>
                                    <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                        {periodOptionsForView.map((option) => (
                                            <Button
                                                key={option.value}
                                                size="sm"
                                                variant={period === option.value ? 'default' : 'ghost'}
                                                onClick={() => setPeriod(option.value)}
                                                className="rounded-none h-8 px-2.5 text-[11px] whitespace-nowrap"
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>

                                <div className="inline-flex items-center gap-1 sm:gap-2 shrink-0">
                                    <span className="text-[11px] text-muted-foreground">클러스터</span>
                                    <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                                        <Button
                                            size="sm"
                                            variant={clusterStep === null ? 'default' : 'ghost'}
                                            onClick={() => setClusterStep(null)}
                                            className="rounded-none h-8 px-2.5 text-[11px] whitespace-nowrap"
                                        >
                                            전체
                                        </Button>
                                        {clusterStepOptions.map((step) => (
                                            <Button
                                                key={step}
                                                size="sm"
                                                variant={clusterStep === step ? 'default' : 'ghost'}
                                                onClick={() => setClusterStep(step)}
                                                className="rounded-none h-8 px-2.5 text-[11px] whitespace-nowrap"
                                            >
                                                {formatClusterValueByMode(metricMode, step)}
                                            </Button>
                                        ))}
                                    </div>
                                </div>

                                <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0 self-center order-99">
                                    <span className="text-[11px] text-muted-foreground">색상</span>
                                    <div className="inline-flex overflow-hidden rounded-md border border-border shrink-0">
                                        <div
                                            className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                            style={{
                                                background: TREEMAP_COLORS[0],
                                                minWidth: 42,
                                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                            }}
                                        >
                                            0%
                                        </div>
                                        <div
                                            className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                            style={{
                                                background: TREEMAP_COLORS[1],
                                                minWidth: 42,
                                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                            }}
                                        >
                                            +1%
                                        </div>
                                        <div
                                            className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                            style={{
                                                background: TREEMAP_COLORS[2],
                                                minWidth: 42,
                                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                            }}
                                        >
                                            +2%
                                        </div>
                                        <div
                                            className="flex items-center justify-center h-6 px-2 text-2xs text-white font-normal"
                                            style={{
                                                background: TREEMAP_COLORS[3],
                                                minWidth: 42,
                                                textShadow: 'rgba(0, 0, 0, 0.25) 0px 1px 0px',
                                            }}
                                        >
                                            +3%
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <CardContent
                        ref={chartAreaRef}
                        className="p-0 flex-1 min-h-0 overflow-hidden"
                        style={{ minHeight: 0, minWidth: 0 }}
                    >
                        <div className="relative h-full w-full">
                            {safeTreeData.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">대상 데이터가 없습니다.</div>
                            ) : (
                                <TreemapTiles
                                    cells={treemapCells}
                                    onCellEnter={handleCellEnter}
                                    onCellMove={handleCellMove}
                                    onCellLeave={handleCellLeave}
                                />
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
                                    <p>
                                        {viewMode === 'change'
                                            ? `${getPeriodLabel(period)} 증감률: ${tooltip.leaf.percentText}`
                                            : `비율: ${tooltip.leaf.percentText}`}
                                    </p>
                                    {viewMode === 'change' ? (
                                        <p>
                                            이전 {getMetricLabel(metricMode)}: {formatTooltipMetric(metricMode, tooltip.leaf.previousMetricRaw ?? tooltip.leaf.metricRaw)}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
