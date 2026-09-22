// 색인 도입 직전 커밋의 apps/web/lib/restaurant-visit-matching.ts를 그대로 복제한 동결 사본입니다.
// 재현 벤치마크에서 이전 경로를 손으로 흉내내지 않고 실제 구현으로 측정하기 위한 것이며,
// 프로덕션 코드 경로에서는 사용하지 않습니다. 원본이 바뀌어도 이 사본은 이 벤치마크의 기준선 근거로만 남깁니다.
// 원본과 다른 점: 런타임 import 경로만 벤치마크 위치에 맞춰 상대 경로로 바꿨습니다.

import type { Restaurant } from '@/types/restaurant';
import { selectRelatedRestaurantReviewIds } from '../../lib/restaurant-review-lookup';

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
