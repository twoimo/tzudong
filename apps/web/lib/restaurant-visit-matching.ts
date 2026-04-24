import type { Restaurant } from '@/types/restaurant';
import { selectRelatedRestaurantReviewIds } from '@/lib/restaurant-review-lookup';

type VisitMatchRestaurant = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
>;

type VisitMatchCandidate = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address'
>;

type HasRelatedVerifiedUserReviewInput = {
    restaurant: VisitMatchRestaurant | null;
    reviewedRestaurantIds: Set<string>;
    reviewedRestaurants: VisitMatchCandidate[];
};

type FindCanonicalVisitedRestaurantInput = {
    reviewedRestaurant: VisitMatchCandidate | null;
    approvedRestaurants: VisitMatchRestaurant[];
    reviewedRestaurantId?: string | null;
};

export function hasRelatedVerifiedUserReview({
    restaurant,
    reviewedRestaurantIds,
    reviewedRestaurants,
}: HasRelatedVerifiedUserReviewInput) {
    if (!restaurant || reviewedRestaurantIds.size === 0) return false;

    return selectRelatedRestaurantReviewIds(restaurant, reviewedRestaurants)
        .some((restaurantId) => reviewedRestaurantIds.has(restaurantId));
}

export function findCanonicalVisitedRestaurant({
    reviewedRestaurant,
    approvedRestaurants,
    reviewedRestaurantId,
}: FindCanonicalVisitedRestaurantInput) {
    const relatedReviewId = reviewedRestaurantId || reviewedRestaurant?.id;
    if (!relatedReviewId) return null;

    const reviewedRestaurantIds = new Set([relatedReviewId]);
    const reviewedRestaurants = reviewedRestaurant ? [reviewedRestaurant] : [];

    return approvedRestaurants.find((restaurant) => hasRelatedVerifiedUserReview({
        restaurant,
        reviewedRestaurantIds,
        reviewedRestaurants,
    })) ?? null;
}
