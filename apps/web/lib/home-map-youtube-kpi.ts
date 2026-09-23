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

export function collectHomeMapYoutubeVideoIds(restaurants: Restaurant[] | null | undefined): string[] {
    if (!restaurants || restaurants.length === 0) return [];

    const videoIds = new Set<string>();

    for (const restaurant of restaurants) {
        for (const link of collectRestaurantYoutubeLinks(restaurant)) {
            const videoId = extractVideoIdFromYoutubeLink(link);
            if (videoId) videoIds.add(videoId);
        }
    }

    return [...videoIds];
}

export const HOME_MAP_YOUTUBE_KPI_REQUEST_CHUNK_SIZE = 100;
export const HOME_MAP_YOUTUBE_KPI_MAX_CONCURRENCY = 4;

export function chunkHomeMapYoutubeVideoIds(
    videoIds: string[],
    chunkSize = HOME_MAP_YOUTUBE_KPI_REQUEST_CHUNK_SIZE,
): string[][] {
    const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : HOME_MAP_YOUTUBE_KPI_REQUEST_CHUNK_SIZE;
    const chunks: string[][] = [];
    for (let index = 0; index < videoIds.length; index += size) {
        chunks.push(videoIds.slice(index, index + size));
    }
    return chunks;
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

    const metricsByVideoId = new Map<string, HomeMapYouTubeKpiMetric>();
    const chunks = chunkHomeMapYoutubeVideoIds(videoIds);
    const chunkResults = Array<HomeMapYouTubeKpiResponse>(chunks.length);
    let nextChunkIndex = 0;

    const fetchNextChunk = async () => {
        while (true) {
            const chunkIndex = nextChunkIndex++;
            const chunk = chunks[chunkIndex];
            if (!chunk) return;

            try {
                const response = await fetch('/api/home/youtube-kpi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoIds: chunk }),
                });

                if (!response.ok) {
                    throw new Error(`home-youtube-kpi:${response.status}`);
                }

                chunkResults[chunkIndex] = (await response.json()) as HomeMapYouTubeKpiResponse;
            } catch (error) {
                const failureCode = error instanceof Error && /^home-youtube-kpi:\d{3}$/.test(error.message)
                    ? error.message
                    : (error instanceof SyntaxError ? 'invalid-response' : 'request-failed');
                console.warn(`[home-map-youtube-kpi] metric chunk failed (${failureCode})`);
            }
        }
    };

    await Promise.all(
        Array.from(
            { length: Math.min(HOME_MAP_YOUTUBE_KPI_MAX_CONCURRENCY, chunks.length) },
            () => fetchNextChunk(),
        ),
    );

    for (const payload of chunkResults) {
        for (const metric of payload?.metrics ?? []) {
            metricsByVideoId.set(metric.videoId, metric);
        }
    }

    return metricsByVideoId;
}

export function mergeHomeMapYoutubeKpiMetrics(
    restaurants: Restaurant[],
    metricsByVideoId: Map<string, HomeMapYouTubeKpiMetric>,
): Restaurant[] {
    if (metricsByVideoId.size === 0) return restaurants;

    return restaurants.map((restaurant) => {
        const metricMetas = collectRestaurantYoutubeLinks(restaurant)
            .map((link) => extractVideoIdFromYoutubeLink(link))
            .filter((videoId): videoId is string => Boolean(videoId))
            .map((videoId) => metricsByVideoId.get(videoId))
            .filter((metric): metric is HomeMapYouTubeKpiMetric => Boolean(metric))
            .map(buildMetricMeta);

        if (metricMetas.length === 0) return restaurant;

        const directVideoId = extractVideoIdFromYoutubeLink(restaurant.youtube_link);
        const directMetric = directVideoId ? metricsByVideoId.get(directVideoId) : null;
        const existingMeta =
            restaurant.youtube_meta && typeof restaurant.youtube_meta === 'object' && !Array.isArray(restaurant.youtube_meta)
                ? restaurant.youtube_meta
                : {};

        return {
            ...restaurant,
            youtube_meta: directMetric
                ? { ...existingMeta, ...buildMetricMeta(directMetric) } as Restaurant['youtube_meta']
                : restaurant.youtube_meta,
            mergedYoutubeMetas: [
                ...(restaurant.mergedYoutubeMetas ?? []),
                ...metricMetas,
            ],
        } as Restaurant;
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
    } catch (error) {
        const failureCode = error instanceof Error && /^home-youtube-kpi:\d{3}$/.test(error.message)
            ? error.message
            : (error instanceof SyntaxError ? 'invalid-response' : 'request-failed');
        console.warn(`[home-map-youtube-kpi] metric enrichment failed (${failureCode})`);
        return restaurants;
    }
}
