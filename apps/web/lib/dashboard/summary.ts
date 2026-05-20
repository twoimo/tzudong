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

    const videos = makeVideoList(rows).slice(0, 80);

    return {
        asOf: latestUpdatedAt || now.toISOString(),
        totals: {
            restaurants: rows.length,
            videos: videoIds.size,
            categories: categories.size,
            withCoordinates,
        },
        topCategories,
        videos,
    };
}

export async function getDashboardSummary(forceRefresh = false): Promise<DashboardSummaryResponse> {
    const rows = await getRestaurantRows(forceRefresh, 'anon');
    return buildDashboardSummaryFromRows(rows);
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
