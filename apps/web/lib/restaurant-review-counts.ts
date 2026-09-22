import { createRelatedVerifiedReviewCountLookup } from '@/lib/restaurant-review-lookup';
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

    // 후보를 주소로 한 번만 색인해 맛집마다 후보 전체를 다시 훑지 않는다(합산 결과는 같다).
    const countRelated = createRelatedVerifiedReviewCountLookup(candidates);

    return new Map(restaurants.map((restaurant) => {
        return [restaurant.id, countRelated(restaurant, directCountMap)];
    }));
}
