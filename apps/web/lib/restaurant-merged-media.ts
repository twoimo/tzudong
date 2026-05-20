import type { Restaurant, YoutubeMeta } from '@/types/restaurant';

type BaseMergedRestaurant = NonNullable<Restaurant['mergedRestaurants']>[number];
type RestaurantLike = Restaurant | BaseMergedRestaurant;

export interface RestaurantMergedMedia {
    youtubeLinks: string[];
    tzuyangReviews: string[];
    youtubeMetas: YoutubeMeta[];
}

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const getRestaurantMediaDate = (restaurant: RestaurantLike): string => {
    const meta = restaurant.youtube_meta as YoutubeMeta | null | undefined;
    return meta?.publishedAt || restaurant.created_at || '';
};

const addUniqueString = (items: string[], value: unknown) => {
    if (!isNonEmptyString(value)) return;

    const trimmed = value.trim();
    if (!items.includes(trimmed)) {
        items.push(trimmed);
    }
};

const addUniqueMeta = (items: YoutubeMeta[], value: unknown) => {
    if (!value || typeof value !== 'object') return;

    const meta = value as YoutubeMeta;
    const key = JSON.stringify(meta);
    const exists = items.some((item) => JSON.stringify(item) === key);
    if (!exists) {
        items.push(meta);
    }
};

const collectUniqueRestaurants = (...restaurantGroups: Array<Array<RestaurantLike | null | undefined> | null | undefined>): RestaurantLike[] => {
    const records: RestaurantLike[] = [];
    const seenIds = new Set<string>();

    restaurantGroups.flatMap((group) => group ?? []).forEach((restaurant) => {
        if (!restaurant?.id || seenIds.has(restaurant.id)) return;
        seenIds.add(restaurant.id);
        records.push(restaurant);
    });

    return records;
};

const getRestaurantRecordsByMediaDate = (restaurant: Restaurant): RestaurantLike[] => {
    const records = collectUniqueRestaurants([
        restaurant,
        ...(restaurant.mergedRestaurants ?? []),
    ]);

    return records.sort((left, right) => getRestaurantMediaDate(right).localeCompare(getRestaurantMediaDate(left)));
};

const mergeCategories = (restaurant: Restaurant, mergeContext?: Restaurant | null): string[] => {
    const categories: string[] = [];

    const addCategories = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach((category) => addUniqueString(categories, category));
        } else {
            addUniqueString(categories, value);
        }
    };

    addCategories(mergeContext?.categories);
    addCategories(mergeContext?.category);
    addCategories(restaurant.categories);
    addCategories(restaurant.category);

    collectUniqueRestaurants(
        restaurant.mergedRestaurants,
        mergeContext?.mergedRestaurants,
    ).forEach((record) => addCategories(record.categories));

    return categories;
};

export const collectRestaurantMergedMedia = (restaurant: Restaurant | null | undefined): RestaurantMergedMedia => {
    if (!restaurant) {
        return { youtubeLinks: [], tzuyangReviews: [], youtubeMetas: [] };
    }

    const youtubeLinks: string[] = [];
    const tzuyangReviews: string[] = [];
    const youtubeMetas: YoutubeMeta[] = [];

    restaurant.mergedYoutubeLinks?.forEach((link) => addUniqueString(youtubeLinks, link));
    restaurant.mergedTzuyangReviews?.forEach((review) => addUniqueString(tzuyangReviews, review));
    restaurant.mergedYoutubeMetas?.forEach((meta) => addUniqueMeta(youtubeMetas, meta));

    getRestaurantRecordsByMediaDate(restaurant).forEach((record) => {
        addUniqueString(youtubeLinks, record.youtube_link);
        addUniqueString(tzuyangReviews, record.tzuyang_review);
        addUniqueMeta(youtubeMetas, record.youtube_meta);
    });

    return { youtubeLinks, tzuyangReviews, youtubeMetas };
};

export const hydrateRestaurantDetailWithMergeContext = (
    detailRestaurant: Restaurant | null | undefined,
    mergeContextRestaurant: Restaurant | null | undefined,
): Restaurant | null => {
    const baseRestaurant = detailRestaurant ?? mergeContextRestaurant;
    if (!baseRestaurant) return null;

    const mergedRestaurants = collectUniqueRestaurants(
        [baseRestaurant],
        detailRestaurant?.mergedRestaurants,
        mergeContextRestaurant ? [mergeContextRestaurant] : null,
        mergeContextRestaurant?.mergedRestaurants,
    );

    const restaurantWithMergeContext = {
        ...mergeContextRestaurant,
        ...detailRestaurant,
        mergedRestaurants,
    } as Restaurant;

    const mergedMedia = collectRestaurantMergedMedia({
        ...restaurantWithMergeContext,
        mergedYoutubeLinks: [
            ...(mergeContextRestaurant?.mergedYoutubeLinks ?? []),
            ...(detailRestaurant?.mergedYoutubeLinks ?? []),
        ],
        mergedTzuyangReviews: [
            ...(mergeContextRestaurant?.mergedTzuyangReviews ?? []),
            ...(detailRestaurant?.mergedTzuyangReviews ?? []),
        ],
        mergedYoutubeMetas: [
            ...(mergeContextRestaurant?.mergedYoutubeMetas ?? []),
            ...(detailRestaurant?.mergedYoutubeMetas ?? []),
        ],
    } as Restaurant);

    const categories = mergeCategories(restaurantWithMergeContext, mergeContextRestaurant);

    return {
        ...restaurantWithMergeContext,
        address: restaurantWithMergeContext.road_address || restaurantWithMergeContext.jibun_address || '',
        category: categories,
        categories,
        youtube_link: mergedMedia.youtubeLinks[0] || restaurantWithMergeContext.youtube_link || null,
        tzuyang_review: mergedMedia.tzuyangReviews[0] || restaurantWithMergeContext.tzuyang_review || null,
        youtube_meta: mergedMedia.youtubeMetas[0] || restaurantWithMergeContext.youtube_meta || null,
        mergedYoutubeLinks: mergedMedia.youtubeLinks,
        mergedTzuyangReviews: mergedMedia.tzuyangReviews,
        mergedYoutubeMetas: mergedMedia.youtubeMetas,
        mergedRestaurants,
    } as Restaurant;
};
