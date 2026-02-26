import type { DashboardFailuresResponse, DashboardFunnelResponse } from '@/types/dashboard';
import { extractVideoIdFromYoutubeLink, toPercent } from './helpers';
import { getLocationMatchFalseMessage, hasLaajMetrics, hasRuleMetrics, toNotSelectionReason } from './classifiers';
import { getRestaurantRows, type DashboardRestaurantRow } from '@/lib/dashboard/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
    expiresAt: number;
    value: T;
} | null;

let funnelCache: CacheEntry<DashboardFunnelResponse> = null;
let failuresCache: CacheEntry<DashboardFailuresResponse> = null;

function getVideoId(row: DashboardRestaurantRow): string | null {
    return extractVideoIdFromYoutubeLink(row.youtube_link);
}

function buildVideoIdSet(rows: DashboardRestaurantRow[], predicate?: (row: DashboardRestaurantRow) => boolean): Set<string> {
    const set = new Set<string>();
    for (const row of rows) {
        if (predicate && !predicate(row)) continue;
        const videoId = getVideoId(row);
        if (!videoId) continue;
        set.add(videoId);
    }
    return set;
}

function toFailureReason(row: DashboardRestaurantRow): string {
    return toNotSelectionReason({
        is_not_selected: row.is_not_selected,
        is_missing: row.is_missing,
        geocoding_false_stage: row.geocoding_false_stage,
        geocoding_success: row.geocoding_success,
    });
}

function sortBuckets(input: Map<string, number>) {
    return [...input.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count }));
}

async function loadRows() {
    return getRestaurantRows(false, 'service');
}

export function buildDashboardFunnelFromRows(
    rows: DashboardRestaurantRow[],
    now: Date = new Date(),
): DashboardFunnelResponse {
    const pipelineRows = rows.filter((row) => row.source_type === 'geminiCLI' || row.source_type === 'perplexity');
    const crawlingVideoIds = buildVideoIdSet(pipelineRows);

    const selectionVideoIds = buildVideoIdSet(pipelineRows, (row) => row.is_not_selected !== true);
    const notSelectionVideoIds = buildVideoIdSet(pipelineRows, (row) => row.is_not_selected === true);
    const unionVideoIds = buildVideoIdSet(pipelineRows);

    let overlap = 0;
    for (const id of selectionVideoIds) {
        if (notSelectionVideoIds.has(id)) overlap += 1;
    }

    const ruleVideoIds = buildVideoIdSet(pipelineRows, (row) => hasRuleMetrics(row.evaluation_results));
    const laajVideoIds = buildVideoIdSet(pipelineRows, (row) => hasLaajMetrics(row.evaluation_results));

    return {
        asOf: now.toISOString(),
        source: 'supabase:public.restaurants',
        counts: {
            crawling: crawlingVideoIds.size,
            selection: selectionVideoIds.size,
            notSelection: notSelectionVideoIds.size,
            selectionUnion: unionVideoIds.size,
            selectionOverlap: overlap,
            rule: ruleVideoIds.size,
            laaj: laajVideoIds.size,
        },
        conversion: {
            selectionRate: toPercent(unionVideoIds.size, crawlingVideoIds.size),
            ruleRate: toPercent(ruleVideoIds.size, unionVideoIds.size),
            laajRate: toPercent(laajVideoIds.size, ruleVideoIds.size),
        },
    };
}

export function buildDashboardFailuresFromRows(
    rows: DashboardRestaurantRow[],
    now: Date = new Date(),
): DashboardFailuresResponse {
    const pipelineRows = rows.filter((row) => row.source_type === 'geminiCLI' || row.source_type === 'perplexity');

    const notSelectionReasonMap = new Map<string, number>();
    const ruleFalseMessageMap = new Map<string, number>();

    for (const row of pipelineRows) {
        if (row.is_not_selected) {
            const reason = toFailureReason(row);
            notSelectionReasonMap.set(reason, (notSelectionReasonMap.get(reason) || 0) + 1);
        }

        const message = getLocationMatchFalseMessage(row.evaluation_results);
        if (message) {
            ruleFalseMessageMap.set(message, (ruleFalseMessageMap.get(message) || 0) + 1);
        }
    }

    const ruleVideoIds = buildVideoIdSet(pipelineRows, (row) => hasRuleMetrics(row.evaluation_results));
    const laajVideoIds = buildVideoIdSet(pipelineRows, (row) => hasLaajMetrics(row.evaluation_results));
    const missingLaajVideoIds: string[] = [];

    for (const videoId of ruleVideoIds) {
        if (!laajVideoIds.has(videoId)) {
            missingLaajVideoIds.push(videoId);
        }
    }

    missingLaajVideoIds.sort();

    return {
        asOf: now.toISOString(),
        source: 'supabase:public.restaurants',
        notSelectionReasons: sortBuckets(notSelectionReasonMap),
        ruleFalseMessages: sortBuckets(ruleFalseMessageMap),
        laajGaps: {
            count: missingLaajVideoIds.length,
            videoIds: missingLaajVideoIds,
        },
    };
}

async function buildFunnel(): Promise<DashboardFunnelResponse> {
    const rows = await loadRows();
    return buildDashboardFunnelFromRows(rows);
}

async function buildFailures(): Promise<DashboardFailuresResponse> {
    const rows = await loadRows();
    return buildDashboardFailuresFromRows(rows);
}

export async function getDashboardFunnel(forceRefresh = false): Promise<DashboardFunnelResponse> {
    if (!forceRefresh && funnelCache && funnelCache.expiresAt > Date.now()) {
        return funnelCache.value;
    }

    const value = await buildFunnel();
    funnelCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value,
    };

    return value;
}

export async function getDashboardFailures(forceRefresh = false): Promise<DashboardFailuresResponse> {
    if (!forceRefresh && failuresCache && failuresCache.expiresAt > Date.now()) {
        return failuresCache.value;
    }

    const value = await buildFailures();
    failuresCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value,
    };

    return value;
}
