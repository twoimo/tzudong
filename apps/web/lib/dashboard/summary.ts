import { createHash } from 'node:crypto';
import type {
    DashboardRestaurantItem,
    DashboardRestaurantsResponse,
    DashboardSummaryResponse,
    DashboardVideoDetailResponse,
    DashboardVideoSummary,
} from '@/types/dashboard';
import { extractVideoIdFromYoutubeLink, parseYoutubeMeta, toDisplayAddress, toFirstCategory } from './helpers';
import {
    getDashboardRestaurantRowsPage,
    getRestaurantRows,
    type DashboardRestaurantRow,
} from '@/lib/dashboard/supabase';

const SUMMARY_CACHE_TTL_MS = Math.max(0, Number(process.env.DASHBOARD_SUMMARY_CACHE_TTL_MS) || 60_000);
const SUMMARY_CACHE_ENABLED = process.env.DASHBOARD_SUMMARY_CACHE_ENABLED !== '0';
const SUMMARY_VIDEO_LIMIT = Math.min(Math.max(Number(process.env.DASHBOARD_SUMMARY_VIDEO_LIMIT) || 40, 1), 80);

type DashboardSummaryCacheEntry = {
    expiresAt: number;
    response: DashboardSummaryResponse;
};

let dashboardSummaryCache: DashboardSummaryCacheEntry | null = null;
let dashboardSummaryInFlight: Promise<DashboardSummaryResponse> | null = null;
type RestaurantsFilter = {
    q?: string;
    category?: string;
    sourceType?: string;
    status?: string;
    onlyWithCoordinates?: boolean;
    limit?: number;
    offset?: number;
};

function normalizeRestaurantItem(row: DashboardRestaurantRow): DashboardRestaurantItem {
    const normalizedName =
        row.name?.trim() ||
        extractVideoIdFromYoutubeLink(row.youtube_link) ||
        '미승인 맛집';

    return {
        id: row.id,
        name: normalizedName,
        category: toFirstCategory(row.categories),
        address: toDisplayAddress(row.road_address, row.jibun_address, row.origin_address),
        lat: row.lat,
        lng: row.lng,
        youtubeLink: row.youtube_link,
        videoId: extractVideoIdFromYoutubeLink(row.youtube_link),
        sourceType: row.source_type,
        status: row.status,
        geocodingSuccess: row.geocoding_success,
        isNotSelected: row.is_not_selected,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
    };
}

function sortByUpdatedDesc<T extends { updatedAt: string | null }>(items: T[]): T[] {
    return [...items].sort((a, b) => {
        const aMs = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bMs = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bMs - aMs;
    });
}

function sortRowsByUpdatedDesc(rows: DashboardRestaurantRow[]): DashboardRestaurantRow[] {
    return [...rows].sort((a, b) => {
        const aMs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bMs - aMs;
    });
}

function buildDashboardSummaryChecksum(rows: DashboardRestaurantRow[]): string {
    const hash = createHash('sha256');
    for (const row of sortRowsByUpdatedDesc(rows)) {
        const meta = parseYoutubeMeta(row.youtube_meta);
        hash.update(JSON.stringify({
            id: row.id,
            updatedAt: row.updated_at || null,
            status: row.status || null,
            name: row.name || null,
            categories: [...(row.categories || [])].sort(),
            hasCoordinates: typeof row.lat === 'number' && typeof row.lng === 'number',
            youtubeLink: row.youtube_link || null,
            youtubeTitle: meta.title || null,
            youtubePublishedAt: meta.publishedAt || null,
            isNotSelected: row.is_not_selected,
            geocodingSuccess: row.geocoding_success,
        }));
        hash.update('\n');
    }
    return hash.digest('hex').slice(0, 24);
}

function withDashboardSummaryFreshness(
    response: DashboardSummaryResponse,
    options: {
        generatedAt: string;
        source: 'row-derived' | 'row-derived-cache';
        cacheStatus: NonNullable<DashboardSummaryResponse['freshness']>['cacheStatus'];
        ttlMs: number;
        videoLimit: number;
        expiresAt: string | null;
        checksum: string;
        rowCount: number;
    },
): DashboardSummaryResponse {
    return {
        ...response,
        freshness: {
            generatedAt: options.generatedAt,
            source: options.source,
            approvedOnly: true,
            rowCount: options.rowCount,
            checksum: options.checksum,
            ttlMs: options.ttlMs,
            videoLimit: options.videoLimit,
            expiresAt: options.expiresAt,
            cacheStatus: options.cacheStatus,
        },
    };
}

function copyDashboardSummaryWithCacheStatus(
    response: DashboardSummaryResponse,
    cacheStatus: NonNullable<DashboardSummaryResponse['freshness']>['cacheStatus'],
): DashboardSummaryResponse {
    if (!response.freshness) return response;
    return {
        ...response,
        freshness: {
            ...response.freshness,
            cacheStatus,
        },
    };
}

export function clearDashboardSummaryCache() {
    dashboardSummaryCache = null;
    dashboardSummaryInFlight = null;
}

function normalizeRestaurantsFilter(filter: RestaurantsFilter) {
    const q = filter.q?.trim();
    return {
        q,
        queryText: q?.toLowerCase(),
        category: filter.category?.trim(),
        sourceType: filter.sourceType?.trim(),
        status: filter.status?.trim(),
        onlyWithCoordinates: filter.onlyWithCoordinates ?? true,
        limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
        offset: Math.max(filter.offset ?? 0, 0),
    };
}

function canUseDirectRestaurantPageQuery(filter: ReturnType<typeof normalizeRestaurantsFilter>): boolean {
    return !filter.queryText && !filter.category && (!filter.status || filter.status === 'approved');
}

function getSearchableRestaurantName(row: DashboardRestaurantRow): string {
    return row.name?.trim() || extractVideoIdFromYoutubeLink(row.youtube_link) || '미승인 맛집';
}

function matchesDashboardRestaurantFilter(row: DashboardRestaurantRow, filter: ReturnType<typeof normalizeRestaurantsFilter>): boolean {
    if (filter.onlyWithCoordinates && (row.lat == null || row.lng == null)) return false;
    if (filter.sourceType && row.source_type !== filter.sourceType) return false;
    if (filter.status && row.status !== filter.status) return false;

    const needsCategory = Boolean(filter.category || filter.queryText);
    const rowCategory = needsCategory ? toFirstCategory(row.categories) : null;
    if (filter.category && rowCategory !== filter.category) return false;

    const queryText = filter.queryText;
    if (queryText) {
        const videoId = extractVideoIdFromYoutubeLink(row.youtube_link);
        const haystacks = [
            getSearchableRestaurantName(row),
            rowCategory || '',
            toDisplayAddress(row.road_address, row.jibun_address, row.origin_address) || '',
            videoId || '',
        ].map((value) => value.toLowerCase());

        if (!haystacks.some((value) => value.includes(queryText))) {
            return false;
        }
    }

    return true;
}

function makeVideoList(rows: DashboardRestaurantRow[]): DashboardVideoSummary[] {
    const map = new Map<string, DashboardVideoSummary>();

    for (const row of rows) {
        const videoId = extractVideoIdFromYoutubeLink(row.youtube_link);
        if (!videoId) continue;

        const meta = parseYoutubeMeta(row.youtube_meta);
        const existing = map.get(videoId);

        if (!existing) {
            map.set(videoId, {
                videoId,
                youtubeLink: row.youtube_link,
                title: meta.title || videoId,
                publishedAt: meta.publishedAt,
                restaurantCount: 1,
                notSelectedCount: row.is_not_selected ? 1 : 0,
                geocodingFailedCount: row.geocoding_success ? 0 : 1,
                updatedAt: row.updated_at,
            });
            continue;
        }

        existing.restaurantCount += 1;
        if (row.is_not_selected) existing.notSelectedCount += 1;
        if (!row.geocoding_success) existing.geocodingFailedCount += 1;

        if (!existing.title || existing.title === existing.videoId) {
            if (meta.title) existing.title = meta.title;
        }
        if (!existing.publishedAt && meta.publishedAt) {
            existing.publishedAt = meta.publishedAt;
        }
        if (!existing.youtubeLink && row.youtube_link) {
            existing.youtubeLink = row.youtube_link;
        }

        const currentUpdatedMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const candidateMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        if (candidateMs > currentUpdatedMs) {
            existing.updatedAt = row.updated_at;
        }
    }

    return [...map.values()].sort((a, b) => {
        if (b.restaurantCount !== a.restaurantCount) {
            return b.restaurantCount - a.restaurantCount;
        }
        const aMs = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bMs = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bMs - aMs;
    });
}

export function buildDashboardSummaryFromRows(
    rows: DashboardRestaurantRow[],
    now: Date = new Date(),
): DashboardSummaryResponse {
    const categories = new Map<string, number>();
    const videoIds = new Set<string>();

    let withCoordinates = 0;
    let latestUpdatedAt: string | null = null;

    for (const row of rows) {
        if (typeof row.lat === 'number' && typeof row.lng === 'number') {
            withCoordinates += 1;
        }

        for (const category of row.categories || []) {
            if (!category) continue;
            categories.set(category, (categories.get(category) || 0) + 1);
        }

        const videoId = extractVideoIdFromYoutubeLink(row.youtube_link);
        if (videoId) videoIds.add(videoId);

        if (row.updated_at) {
            if (!latestUpdatedAt || new Date(row.updated_at).getTime() > new Date(latestUpdatedAt).getTime()) {
                latestUpdatedAt = row.updated_at;
            }
        }
    }

    const topCategories = [...categories.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => ({ name, count }));

    const videos = makeVideoList(rows).slice(0, SUMMARY_VIDEO_LIMIT);

    const generatedAt = now.toISOString();
    return withDashboardSummaryFreshness(
        {
            asOf: latestUpdatedAt || generatedAt,
            totals: {
                restaurants: rows.length,
                videos: videoIds.size,
                categories: categories.size,
                withCoordinates,
            },
            topCategories,
            videos,
        },
        {
            generatedAt,
            source: 'row-derived',
            cacheStatus: 'bypass',
            ttlMs: 0,
            expiresAt: null,
            checksum: buildDashboardSummaryChecksum(rows),
            videoLimit: videos.length,
            rowCount: rows.length,
        },
    );
}

export async function getDashboardSummary(forceRefresh = false): Promise<DashboardSummaryResponse> {
    if (forceRefresh || !SUMMARY_CACHE_ENABLED || SUMMARY_CACHE_TTL_MS <= 0) {
        clearDashboardSummaryCache();
        const rows = await getRestaurantRows(forceRefresh, 'anon');
        return buildDashboardSummaryFromRows(rows);
    }

    const cached = dashboardSummaryCache;
    if (cached && cached.expiresAt > Date.now()) {
        return copyDashboardSummaryWithCacheStatus(cached.response, 'hit');
    }

    if (dashboardSummaryInFlight) {
        const response = await dashboardSummaryInFlight;
        return copyDashboardSummaryWithCacheStatus(response, 'shared');
    }

    dashboardSummaryInFlight = (async () => {
        const rows = await getRestaurantRows(forceRefresh, 'anon');
        const generatedAt = new Date();
        const expiresAt = generatedAt.getTime() + SUMMARY_CACHE_TTL_MS;
        const baseResponse = buildDashboardSummaryFromRows(rows, generatedAt);
        const response = withDashboardSummaryFreshness(
            baseResponse,
            {
                generatedAt: generatedAt.toISOString(),
                source: 'row-derived-cache',
                cacheStatus: 'miss',
                ttlMs: SUMMARY_CACHE_TTL_MS,
                expiresAt: new Date(expiresAt).toISOString(),
                checksum: buildDashboardSummaryChecksum(rows),
                videoLimit: baseResponse.videos.length,
                rowCount: rows.length,
            },
        );
        dashboardSummaryCache = { expiresAt, response };
        return response;
    })();

    try {
        return await dashboardSummaryInFlight;
    } finally {
        dashboardSummaryInFlight = null;
    }
}

export async function getDashboardRestaurants(
    filter: RestaurantsFilter,
): Promise<DashboardRestaurantsResponse> {
    const normalizedFilter = normalizeRestaurantsFilter(filter);

    if (normalizedFilter.status && normalizedFilter.status !== 'approved') {
        return buildDashboardRestaurantsPageFromRows([], 0, normalizedFilter);
    }

    if (canUseDirectRestaurantPageQuery(normalizedFilter)) {
        const page = await getDashboardRestaurantRowsPage({
            limit: normalizedFilter.limit,
            offset: normalizedFilter.offset,
            onlyWithCoordinates: normalizedFilter.onlyWithCoordinates,
            sourceType: normalizedFilter.sourceType,
        }, 'anon');
        return buildDashboardRestaurantsPageFromRows(page.rows, page.total, normalizedFilter);
    }

    const rows = await getRestaurantRows(false, 'anon');
    return buildDashboardRestaurantsFromRows(rows, filter);
}

export function buildDashboardRestaurantsPageFromRows(
    rows: DashboardRestaurantRow[],
    total: number,
    normalizedFilter: ReturnType<typeof normalizeRestaurantsFilter>,
    now: Date = new Date(),
): DashboardRestaurantsResponse {
    return {
        asOf: now.toISOString(),
        total,
        limit: normalizedFilter.limit,
        offset: normalizedFilter.offset,
        filters: {
            q: normalizedFilter.q,
            category: normalizedFilter.category,
            sourceType: normalizedFilter.sourceType,
            status: normalizedFilter.status,
            onlyWithCoordinates: normalizedFilter.onlyWithCoordinates,
        },
        items: rows.map(normalizeRestaurantItem),
    };
}

export function buildDashboardRestaurantsFromRows(
    rows: DashboardRestaurantRow[],
    filter: RestaurantsFilter,
    now: Date = new Date(),
): DashboardRestaurantsResponse {
    const normalizedFilter = normalizeRestaurantsFilter(filter);
    const filteredRows = rows.filter((row) => matchesDashboardRestaurantFilter(row, normalizedFilter));
    const sortedRows = sortRowsByUpdatedDesc(filteredRows);
    const paged = sortedRows.slice(normalizedFilter.offset, normalizedFilter.offset + normalizedFilter.limit);

    return buildDashboardRestaurantsPageFromRows(paged, sortedRows.length, normalizedFilter, now);
}

export async function getDashboardVideoDetail(
    videoId: string,
): Promise<DashboardVideoDetailResponse | null> {
    const rows = await getRestaurantRows(false, 'anon');
    const targetRows = rows.filter((row) => extractVideoIdFromYoutubeLink(row.youtube_link) === videoId);

    if (targetRows.length === 0) return null;

    const restaurants = sortByUpdatedDesc(targetRows.map(normalizeRestaurantItem));

    const first = targetRows[0];
    const meta = parseYoutubeMeta(first.youtube_meta);

    return {
        asOf: new Date().toISOString(),
        video: {
            videoId,
            youtubeLink: first.youtube_link,
            title: meta.title || videoId,
            publishedAt: meta.publishedAt,
            restaurantCount: restaurants.length,
        },
        restaurants,
    };
}
