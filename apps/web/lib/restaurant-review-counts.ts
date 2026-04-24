import { selectRelatedRestaurantReviewIds } from '@/lib/restaurant-review-lookup';
import type { Restaurant } from '@/types/restaurant';

type ReviewCountRestaurant = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
>;

type ReviewCountCandidate = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address'
>;

type VerifiedReviewCountRow = {
    restaurant_id: string | null;
};

export function buildRelatedVerifiedReviewCountMap(
    restaurants: ReviewCountRestaurant[],
    candidates: ReviewCountCandidate[],
    reviewRows: VerifiedReviewCountRow[] | null | undefined
): Map<string, number> {
    const directCountMap = new Map<string, number>();
    (reviewRows ?? []).forEach((reviewRow) => {
        if (!reviewRow.restaurant_id) return;
        directCountMap.set(reviewRow.restaurant_id, (directCountMap.get(reviewRow.restaurant_id) ?? 0) + 1);
    });

    return new Map(restaurants.map((restaurant) => {
        const relatedIds = selectRelatedRestaurantReviewIds(restaurant, candidates);
        const count = relatedIds.reduce((sum, restaurantId) => sum + (directCountMap.get(restaurantId) ?? 0), 0);
        return [restaurant.id, count];
    }));
}
