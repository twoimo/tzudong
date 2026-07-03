import type { Restaurant } from '@/types/restaurant';

export type HomeMapThemeFilterId =
    | 'new'
    | 'repeat'
    | 'favorite'
    | 'review-rich'
    | 'video-rich';

export type HomeMapThemeFilter = {
    id: HomeMapThemeFilterId;
    label: string;
    shortLabel: string;
    ariaLabel: string;
    description: string;
};

const NEW_RESTAURANT_DAYS = 90;
const REPEAT_VISIT_MIN_COUNT = 2;
const REVIEW_RICH_MIN_COUNT = 10;
const FAVORITE_REVIEW_KEYWORDS = [
    '최애',
    '인생',
    '또 오',
    '또 갈',
    '재방문',
    '강추',
    '추천',
    '맛있',
    '행복',
] as const;

export const HOME_MAP_THEME_FILTERS = [
    {
        id: 'new',
        label: '신규 맛집',
        shortLabel: '신규',
        ariaLabel: '최근 등록된 신규 맛집 필터',
        description: `데이터 최신 등록일 기준 최근 ${NEW_RESTAURANT_DAYS}일 이내 등록`,
    },
    {
        id: 'repeat',
        label: `${REPEAT_VISIT_MIN_COUNT}번 이상`,
        shortLabel: 'N번 방문',
        ariaLabel: '두 번 이상 소개되거나 리뷰된 맛집 필터',
        description: '쯔양 영상 또는 서비스 리뷰가 2개 이상인 재등장 맛집',
    },
    {
        id: 'favorite',
        label: '최애 후보',
        shortLabel: '최애',
        ariaLabel: '쯔양 리뷰 표현 기반 최애 후보 맛집 필터',
        description: '쯔양 리뷰 문구에서 최애·인생·재방문·강추 등 호감 표현이 확인된 맛집',
    },
    {
        id: 'review-rich',
        label: '리뷰 많은 곳',
        shortLabel: '리뷰多',
        ariaLabel: '사용자 리뷰가 많은 맛집 필터',
        description: `서비스 리뷰 ${REVIEW_RICH_MIN_COUNT}개 이상`,
    },
    {
        id: 'video-rich',
        label: '영상 맛집',
        shortLabel: '영상多',
        ariaLabel: '연결된 쯔양 영상이 많은 맛집 필터',
        description: '연결된 쯔양 영상이 2개 이상인 맛집',
    },
] as const satisfies ReadonlyArray<HomeMapThemeFilter>;

export const HOME_MAP_THEME_FILTER_IDS = HOME_MAP_THEME_FILTERS.map((filter) => filter.id);

export function isHomeMapThemeFilterId(value: unknown): value is HomeMapThemeFilterId {
    return typeof value === 'string' && HOME_MAP_THEME_FILTER_IDS.includes(value as HomeMapThemeFilterId);
}

function parseRestaurantDate(value: unknown): number | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getRestaurantCreatedAtMs(restaurant: Restaurant): number | null {
    return parseRestaurantDate(restaurant.created_at);
}

function getMergedVideoCount(restaurant: Restaurant): number {
    if (Array.isArray(restaurant.mergedYoutubeLinks) && restaurant.mergedYoutubeLinks.length > 0) {
        return restaurant.mergedYoutubeLinks.filter(Boolean).length;
    }

    if (Array.isArray(restaurant.mergedRestaurants) && restaurant.mergedRestaurants.length > 0) {
        return restaurant.mergedRestaurants.filter((item) => Boolean(item.youtube_link)).length;
    }

    return restaurant.youtube_link ? 1 : 0;
}

function getMergedReviewCount(restaurant: Restaurant): number {
    const explicitReviewCount = typeof restaurant.review_count === 'number' ? restaurant.review_count : 0;
    const verifiedReviewCount =
        'verified_review_count' in restaurant && typeof restaurant.verified_review_count === 'number'
            ? restaurant.verified_review_count
            : 0;

    return Math.max(explicitReviewCount, verifiedReviewCount);
}

function collectTzuyangReviewText(restaurant: Restaurant): string {
    const reviews = new Set<string>();

    if (typeof restaurant.tzuyang_review === 'string') {
        reviews.add(restaurant.tzuyang_review);
    }

    restaurant.mergedTzuyangReviews?.forEach((review) => {
        if (typeof review === 'string') reviews.add(review);
    });

    restaurant.mergedRestaurants?.forEach((mergedRestaurant) => {
        if (typeof mergedRestaurant.tzuyang_review === 'string') {
            reviews.add(mergedRestaurant.tzuyang_review);
        }
    });

    return [...reviews].join(' ');
}

function hasFavoriteReviewSignal(restaurant: Restaurant): boolean {
    const reviewText = collectTzuyangReviewText(restaurant);
    if (!reviewText) return false;

    return FAVORITE_REVIEW_KEYWORDS.some((keyword) => reviewText.includes(keyword));
}

function getLatestCreatedAtMs(restaurants: Restaurant[]): number | null {
    let latest: number | null = null;

    for (const restaurant of restaurants) {
        const createdAt = getRestaurantCreatedAtMs(restaurant);
        if (createdAt === null) continue;
        latest = latest === null ? createdAt : Math.max(latest, createdAt);
    }

    return latest;
}

export function applyHomeMapThemeFilter(
    restaurants: Restaurant[],
    themeId: HomeMapThemeFilterId | null | undefined,
): Restaurant[] {
    if (!themeId) return restaurants;

    if (themeId === 'new') {
        const latestCreatedAt = getLatestCreatedAtMs(restaurants);
        if (latestCreatedAt === null) return restaurants;

        const threshold = latestCreatedAt - NEW_RESTAURANT_DAYS * 24 * 60 * 60 * 1000;
        return restaurants.filter((restaurant) => {
            const createdAt = getRestaurantCreatedAtMs(restaurant);
            return createdAt !== null && createdAt >= threshold;
        });
    }

    if (themeId === 'repeat') {
        return restaurants.filter(
            (restaurant) =>
                getMergedVideoCount(restaurant) >= REPEAT_VISIT_MIN_COUNT ||
                getMergedReviewCount(restaurant) >= REPEAT_VISIT_MIN_COUNT,
        );
    }

    if (themeId === 'favorite') {
        return restaurants.filter(hasFavoriteReviewSignal);
    }

    if (themeId === 'review-rich') {
        return restaurants.filter((restaurant) => getMergedReviewCount(restaurant) >= REVIEW_RICH_MIN_COUNT);
    }

    if (themeId === 'video-rich') {
        return restaurants.filter((restaurant) => getMergedVideoCount(restaurant) >= REPEAT_VISIT_MIN_COUNT);
    }

    return restaurants;
}
