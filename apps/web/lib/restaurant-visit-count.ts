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

    // Compact map rows can omit all history. Avoid two empty Set allocations;
    // non-empty inputs still use the exact unique-history calculation below.
    if (!restaurant.youtube_link && !restaurant.tzuyang_review
        && !restaurant.youtube_links?.length && !restaurant.tzuyang_reviews?.length
        && !restaurant.mergedYoutubeLinks?.length && !restaurant.mergedTzuyangReviews?.length) {
        // The map projection retains the original compact row even when it
        // has no video/review fields, so an existing merged row is not a visit.
        let hasMergedHistory = false;
        if (restaurant.mergedRestaurants) {
            for (const merged of restaurant.mergedRestaurants) {
                if (merged.youtube_link || merged.tzuyang_review) {
                    hasMergedHistory = true;
                    break;
                }
            }
        }
        if (!hasMergedHistory) return 0;
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
