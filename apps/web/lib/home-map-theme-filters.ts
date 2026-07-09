import type { Restaurant, YoutubeMeta } from '@/types/restaurant';

export type HomeMapThemeFilterId =
    | 'hot-view'
    | 'comment-hot'
    | 'fresh-video'
    | 'repeat-video'
    | 'fan-signal';

export type HomeMapThemeFilter = {
    id: HomeMapThemeFilterId;
    label: string;
    ariaLabel: string;
    description: string;
};

const FRESH_VIDEO_DAYS = 90;
const REPEAT_VIDEO_MIN_COUNT = 2;
const TOP_BAND_RATIO = 0.2;
const YOUTUBE_METADATA_BACKED_HOME_MAP_THEME_FILTER_IDS = [
    'hot-view',
    'comment-hot',
    'fresh-video',
    'fan-signal',
] as const satisfies ReadonlyArray<HomeMapThemeFilterId>;

export const HOME_MAP_THEME_FILTERS = [
    {
        id: 'hot-view',
        label: '조회수 폭발',
        ariaLabel: '조회수가 높은 쯔양 영상 맛집 필터',
        description: '연결된 쯔양 영상 조회수가 현재 결과 상위권인 맛집',
    },
    {
        id: 'comment-hot',
        label: '댓글 폭주',
        ariaLabel: '댓글 반응이 많은 쯔양 영상 맛집 필터',
        description: '연결된 쯔양 영상 댓글 수가 현재 결과 상위권인 맛집',
    },
    {
        id: 'fresh-video',
        label: '최근 영상',
        ariaLabel: '최근 쯔양 영상에 나온 맛집 필터',
        description: `가장 최근 공개된 쯔양 영상 기준 최근 ${FRESH_VIDEO_DAYS}일 안에 등장한 맛집`,
    },
    {
        id: 'repeat-video',
        label: '재등장 맛집',
        ariaLabel: '쯔양 영상에 두 번 이상 등장한 맛집 필터',
        description: '연결된 쯔양 영상이 2개 이상인 재등장 맛집',
    },
    {
        id: 'fan-signal',
        label: '반응 찐함',
        ariaLabel: '조회수 대비 댓글 반응이 진한 쯔양 영상 맛집 필터',
        description: '조회수 대비 댓글 밀도가 높은 영상의 맛집',
    },
] as const satisfies ReadonlyArray<HomeMapThemeFilter>;

export const HOME_MAP_THEME_FILTER_IDS = HOME_MAP_THEME_FILTERS.map((filter) => filter.id);

export function isHomeMapThemeFilterId(value: unknown): value is HomeMapThemeFilterId {
    return typeof value === 'string' && HOME_MAP_THEME_FILTER_IDS.includes(value as HomeMapThemeFilterId);
}

export function isYoutubeMetadataBackedHomeMapThemeFilterId(value: unknown): value is HomeMapThemeFilterId {
    return (
        typeof value === 'string' &&
        YOUTUBE_METADATA_BACKED_HOME_MAP_THEME_FILTER_IDS.includes(
            value as (typeof YOUTUBE_METADATA_BACKED_HOME_MAP_THEME_FILTER_IDS)[number],
        )
    );
}
type YoutubeMetricKey = 'viewCount' | 'commentCount';
type YoutubeMetricSnakeKey = 'view_count' | 'comment_count';
type YoutubeMetaWithMetricAliases = YoutubeMeta & Partial<Record<YoutubeMetricSnakeKey | 'published_at', unknown>>;

const YOUTUBE_METRIC_ALIASES: Record<YoutubeMetricKey, readonly [YoutubeMetricKey, YoutubeMetricSnakeKey]> = {
    viewCount: ['viewCount', 'view_count'],
    commentCount: ['commentCount', 'comment_count'],
};


function parseYoutubeMetric(value: unknown): number | null {
    const numericValue = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
    if (typeof numericValue !== 'number') return null;
    if (!Number.isFinite(numericValue) || numericValue < 0) return null;
    return numericValue;
}

function parseYoutubePublishedAt(value: unknown): number | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getYoutubeMetric(meta: YoutubeMeta, metricKey: YoutubeMetricKey): number | null {
    const aliasedMeta = meta as YoutubeMetaWithMetricAliases;

    for (const alias of YOUTUBE_METRIC_ALIASES[metricKey]) {
        const metric = parseYoutubeMetric(aliasedMeta[alias]);
        if (metric !== null) return metric;
    }

    return null;
}

function getYoutubePublishedAt(meta: YoutubeMeta): number | null {
    const aliasedMeta = meta as YoutubeMetaWithMetricAliases;

    return parseYoutubePublishedAt(aliasedMeta.publishedAt ?? aliasedMeta.published_at);
}


function isYoutubeMeta(value: unknown): value is YoutubeMeta {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getYoutubeMetaDedupeKey(meta: YoutubeMeta): string {
    const aliasedMeta = meta as YoutubeMetaWithMetricAliases;

    return [
        meta.title,
        aliasedMeta.publishedAt ?? aliasedMeta.published_at,
        getYoutubeMetric(meta, 'viewCount'),
        meta.likeCount,
        getYoutubeMetric(meta, 'commentCount'),
    ]
        .map((value) => String(value ?? ''))
        .join('\u0000');
}

function collectMergedYoutubeMetas(restaurant: Restaurant): YoutubeMeta[] {
    const metas: YoutubeMeta[] = [];
    const seen = new Set<string>();

    const addMeta = (value: unknown) => {
        if (!isYoutubeMeta(value)) return;
        const key = getYoutubeMetaDedupeKey(value);
        if (seen.has(key)) return;
        seen.add(key);
        metas.push(value);
    };

    restaurant.mergedYoutubeMetas?.forEach(addMeta);
    addMeta(restaurant.youtube_meta);
    restaurant.mergedRestaurants?.forEach((mergedRestaurant) => addMeta(mergedRestaurant.youtube_meta));

    return metas;
}

function getMergedVideoCount(restaurant: Restaurant): number {
    const links = new Set<string>();
    const addLink = (value: unknown) => {
        if (typeof value !== 'string') return;
        const normalized = value.trim();
        if (normalized.length > 0) links.add(normalized);
    };

    restaurant.mergedYoutubeLinks?.forEach(addLink);
    addLink(restaurant.youtube_link);
    restaurant.mergedRestaurants?.forEach((mergedRestaurant) => addLink(mergedRestaurant.youtube_link));

    return links.size;
}

function getTopBandThreshold(values: number[]): number | null {
    if (values.length === 0) return null;
    const sortedValues = [...values].sort((a, b) => b - a);
    const thresholdIndex = Math.max(0, Math.ceil(sortedValues.length * TOP_BAND_RATIO) - 1);
    return sortedValues[thresholdIndex];
}

function getMedian(values: number[]): number | null {
    if (values.length === 0) return null;
    const sortedValues = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2 === 1) return sortedValues[middle];
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function filterByTopYoutubeMetric(
    restaurants: Restaurant[],
    metricKey: YoutubeMetricKey,
): Restaurant[] {
    const metricByRestaurant = new Map<Restaurant, number>();

    restaurants.forEach((restaurant) => {
        const values = collectMergedYoutubeMetas(restaurant)
            .map((meta) => getYoutubeMetric(meta, metricKey))
            .filter((value): value is number => value !== null);
        if (values.length === 0) return;
        metricByRestaurant.set(restaurant, Math.max(...values));
    });

    const threshold = getTopBandThreshold([...metricByRestaurant.values()]);
    if (threshold === null) return [];

    return restaurants.filter((restaurant) => {
        const metric = metricByRestaurant.get(restaurant);
        return metric !== undefined && metric >= threshold;
    });
}

function filterByFreshVideo(restaurants: Restaurant[]): Restaurant[] {
    const publishedAtByRestaurant = new Map<Restaurant, number[]>();
    let latestPublishedAt: number | null = null;

    restaurants.forEach((restaurant) => {
        const publishedAtValues = collectMergedYoutubeMetas(restaurant)
            .map(getYoutubePublishedAt)
            .filter((value): value is number => value !== null);
        if (publishedAtValues.length === 0) return;
        publishedAtByRestaurant.set(restaurant, publishedAtValues);
        for (const publishedAt of publishedAtValues) {
            latestPublishedAt = latestPublishedAt === null ? publishedAt : Math.max(latestPublishedAt, publishedAt);
        }
    });

    if (latestPublishedAt === null) return [];

    const threshold = latestPublishedAt - FRESH_VIDEO_DAYS * 24 * 60 * 60 * 1000;
    return restaurants.filter((restaurant) => publishedAtByRestaurant.get(restaurant)?.some((publishedAt) => publishedAt >= threshold));
}

function filterByFanSignal(restaurants: Restaurant[]): Restaurant[] {
    const maxViewByRestaurant = new Map<Restaurant, number>();
    const maxRatioByRestaurant = new Map<Restaurant, number>();

    restaurants.forEach((restaurant) => {
        for (const meta of collectMergedYoutubeMetas(restaurant)) {
            const viewCount = getYoutubeMetric(meta, 'viewCount');
            if (viewCount === null || viewCount <= 0) continue;
            maxViewByRestaurant.set(restaurant, Math.max(maxViewByRestaurant.get(restaurant) ?? 0, viewCount));

            const commentCount = getYoutubeMetric(meta, 'commentCount');
            if (commentCount === null || commentCount <= 0) continue;
            maxRatioByRestaurant.set(restaurant, Math.max(maxRatioByRestaurant.get(restaurant) ?? 0, commentCount / viewCount));
        }
    });

    const medianViewCount = getMedian([...maxViewByRestaurant.values()]);
    if (medianViewCount === null) return [];

    const eligibleRatios = [...maxRatioByRestaurant.entries()]
        .filter(([restaurant]) => (maxViewByRestaurant.get(restaurant) ?? 0) >= medianViewCount)
        .map(([, ratio]) => ratio);
    const threshold = getTopBandThreshold(eligibleRatios);
    if (threshold === null) return [];

    return restaurants.filter((restaurant) => {
        const ratio = maxRatioByRestaurant.get(restaurant);
        return ratio !== undefined && (maxViewByRestaurant.get(restaurant) ?? 0) >= medianViewCount && ratio >= threshold;
    });
}

export function applyHomeMapThemeFilter(
    restaurants: Restaurant[],
    themeId: HomeMapThemeFilterId | null | undefined,
): Restaurant[] {
    if (!themeId) return restaurants;

    if (themeId === 'hot-view') {
        return filterByTopYoutubeMetric(restaurants, 'viewCount');
    }

    if (themeId === 'comment-hot') {
        return filterByTopYoutubeMetric(restaurants, 'commentCount');
    }

    if (themeId === 'fresh-video') {
        return filterByFreshVideo(restaurants);
    }

    if (themeId === 'repeat-video') {
        return restaurants.filter((restaurant) => getMergedVideoCount(restaurant) >= REPEAT_VIDEO_MIN_COUNT);
    }

    if (themeId === 'fan-signal') {
        return filterByFanSignal(restaurants);
    }

    return restaurants;
}
