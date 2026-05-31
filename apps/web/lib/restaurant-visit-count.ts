import type { Restaurant } from '@/types/restaurant';

type VisitCountRestaurant = Partial<Pick<
    Restaurant,
    | 'youtube_link'
    | 'youtube_links'
    | 'tzuyang_review'
    | 'tzuyang_reviews'
    | 'mergedYoutubeLinks'
    | 'mergedTzuyangReviews'
    | 'mergedRestaurants'
>>;

const addNonEmptyString = (target: Set<string>, value: unknown): void => {
    if (typeof value !== 'string') {
        return;
    }

    const normalized = value.trim();
    if (normalized.length > 0) {
        target.add(normalized);
    }
};

const addStringCollection = (target: Set<string>, values: unknown): void => {
    if (!Array.isArray(values)) {
        return;
    }

    values.forEach((value) => addNonEmptyString(target, value));
};

export function getTzuyangVisitCount(restaurant: VisitCountRestaurant | null | undefined): number {
    if (!restaurant) {
        return 0;
    }

    const youtubeLinks = new Set<string>();
    const tzuyangReviews = new Set<string>();

    addNonEmptyString(youtubeLinks, restaurant.youtube_link);
    addStringCollection(youtubeLinks, restaurant.youtube_links);
    addStringCollection(youtubeLinks, restaurant.mergedYoutubeLinks);

    addNonEmptyString(tzuyangReviews, restaurant.tzuyang_review);
    addStringCollection(tzuyangReviews, restaurant.tzuyang_reviews);
    addStringCollection(tzuyangReviews, restaurant.mergedTzuyangReviews);

    restaurant.mergedRestaurants?.forEach((mergedRestaurant) => {
        addNonEmptyString(youtubeLinks, mergedRestaurant.youtube_link);
        addNonEmptyString(tzuyangReviews, mergedRestaurant.tzuyang_review);
    });

    return Math.max(youtubeLinks.size, tzuyangReviews.size);
}

export function shouldShowTzuyangVisitBadge(restaurant: VisitCountRestaurant | null | undefined): boolean {
    return getTzuyangVisitCount(restaurant) >= 2;
}
