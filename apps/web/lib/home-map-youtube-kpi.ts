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

    const response = await fetch('/api/home/youtube-kpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds }),
    });

    if (!response.ok) {
        throw new Error(`home-youtube-kpi:${response.status}`);
    }

    const payload = (await response.json()) as HomeMapYouTubeKpiResponse;
    return new Map((payload.metrics ?? []).map((metric) => [metric.videoId, metric]));
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
        console.warn('[home-map-youtube-kpi] metric enrichment failed:', error instanceof Error ? error.message : error);
        return restaurants;
    }
}
