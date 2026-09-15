import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import {
    isYoutubeMetadataBackedHomeMapThemeFilterId,
    type HomeMapThemeFilterId,
} from '@/lib/home-map-theme-filters';
import type { Restaurant, YoutubeMeta } from '@/types/restaurant';

type HomeMapYouTubeKpiMetric = {
    videoId: string;
    title: string | null;
    publishedAt: string | null;
    duration: number;
    viewCount: number;
    likeCount: number;
    commentCount: number;
};

type HomeMapYouTubeKpiResponse = {
    metrics?: HomeMapYouTubeKpiMetric[];
};

function collectRestaurantYoutubeLinks(restaurant: Restaurant): string[] {
    return [
        restaurant.youtube_link,
        ...(restaurant.mergedYoutubeLinks ?? []),
        ...(restaurant.mergedRestaurants ?? []).map((mergedRestaurant) => mergedRestaurant.youtube_link),
    ].filter((link): link is string => typeof link === 'string' && link.trim().length > 0);
}

export function collectHomeMapYoutubeVideoIds(restaurants: Restaurant[]): string[] {
    const videoIds = new Set<string>();

    for (const restaurant of restaurants) {
        for (const link of collectRestaurantYoutubeLinks(restaurant)) {
            const videoId = extractVideoIdFromYoutubeLink(link);
            if (videoId) videoIds.add(videoId);
        }
    }

    return [...videoIds];
}

function buildMetricMeta(metric: HomeMapYouTubeKpiMetric): YoutubeMeta {
    return {
        ...(metric.title ? { title: metric.title } : {}),
        ...(metric.publishedAt ? { publishedAt: metric.publishedAt } : {}),
        duration: metric.duration,
        viewCount: metric.viewCount,
        likeCount: metric.likeCount,
        commentCount: metric.commentCount,
    };
}

async function fetchHomeMapYoutubeKpiMetrics(videoIds: string[]): Promise<Map<string, HomeMapYouTubeKpiMetric>> {
    if (videoIds.length === 0) return new Map();

    const batches: string[][] = [];
    for (let i = 0; i < videoIds.length; i += 120) batches.push(videoIds.slice(i, i + 120));
    const metrics = new Map<string, HomeMapYouTubeKpiMetric>();
    // Respect the public endpoint's 120-ID bound with at most three requests in flight.
    for (let i = 0; i < batches.length; i += 3) {
        const results = await Promise.all(batches.slice(i, i + 3).map(async batch => {
            const response = await fetch('/api/home/youtube-kpi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoIds: batch }),
            });
            if (!response.ok) throw new Error('HOME_YOUTUBE_KPI_UNAVAILABLE');
            const payload = await response.json() as HomeMapYouTubeKpiResponse;
            const requested = new Set(batch);
            return (payload.metrics ?? []).filter(metric => requested.has(metric.videoId));
        }));
        for (const result of results) for (const metric of result) metrics.set(metric.videoId, metric);
    }
    return metrics;
}

export function mergeHomeMapYoutubeKpiMetrics(
    restaurants: Restaurant[],
    metricsByVideoId: Map<string, HomeMapYouTubeKpiMetric>,
): Restaurant[] {
    if (metricsByVideoId.size === 0) return restaurants;

    return restaurants.map((restaurant) => {
        const videoIds = [...new Set(collectRestaurantYoutubeLinks(restaurant)
            .map(extractVideoIdFromYoutubeLink).filter((id): id is string => Boolean(id)))];
        if (!videoIds.some(id => metricsByVideoId.has(id))) return restaurant;

        const updateRow = <T extends Pick<Restaurant, 'youtube_link' | 'youtube_meta'>>(row: T): T => {
            const videoId = extractVideoIdFromYoutubeLink(row.youtube_link);
            const metric = videoId ? metricsByVideoId.get(videoId) : undefined;
            if (!metric) return row;
            const existing = row.youtube_meta && typeof row.youtube_meta === 'object' && !Array.isArray(row.youtube_meta)
                ? row.youtube_meta : {};
            return { ...row, youtube_meta: { ...existing, ...buildMetricMeta(metric) } };
        };
        const updated = updateRow(restaurant);
        const mergedRestaurants = restaurant.mergedRestaurants?.map(updateRow);
        const sourceRows = mergedRestaurants?.length ? mergedRestaurants : [updated];
        const representedIds = new Set(sourceRows.map(row => extractVideoIdFromYoutubeLink(row.youtube_link)));
        const metas = sourceRows.map((row): unknown => row.youtube_meta)
            .filter((value): value is YoutubeMeta => Boolean(value) && typeof value === 'object' && !Array.isArray(value));
        for (const videoId of videoIds) {
            if (representedIds.has(videoId)) continue;
            const metric = metricsByVideoId.get(videoId);
            if (metric) metas.push(buildMetricMeta(metric));
        }
        return { ...updated, mergedRestaurants, mergedYoutubeMetas: metas };
    });
}

export async function enrichRestaurantsWithHomeMapYoutubeKpiMetrics(
    restaurants: Restaurant[],
    themeId: HomeMapThemeFilterId | null,
): Promise<Restaurant[]> {
    if (!isYoutubeMetadataBackedHomeMapThemeFilterId(themeId)) return restaurants;

    const videoIds = collectHomeMapYoutubeVideoIds(restaurants);
    if (videoIds.length === 0) return restaurants;

    try {
        return mergeHomeMapYoutubeKpiMetrics(
            restaurants,
            await fetchHomeMapYoutubeKpiMetrics(videoIds),
        );
    } catch {
        console.warn('[home-map-youtube-kpi] metric enrichment failed:');
        return restaurants;
    }
}
