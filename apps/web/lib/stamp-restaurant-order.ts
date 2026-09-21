import { parseCategoryList } from '@/lib/category-utils';
import type { Restaurant } from '@/types/restaurant';

export type StampRestaurantSortColumn = 'name' | 'category' | 'fanVisits';
export type StampRestaurantSortDirection = 'asc' | 'desc' | null;

type StampOrderRestaurant = Pick<Restaurant, 'name' | 'review_count' | 'category' | 'categories'> & {
    verified_review_count?: number | null;
};

type CompareStampRestaurantsOptions = {
    isVisited: (restaurant: Restaurant) => boolean;
    sortColumn: StampRestaurantSortColumn;
    sortDirection: StampRestaurantSortDirection;
};

function getReviewCount(restaurant: StampOrderRestaurant): number {
    return restaurant.verified_review_count ?? restaurant.review_count ?? 0;
}

function getCategoryName(restaurant: StampOrderRestaurant): string {
    return parseCategoryList(restaurant.category ?? restaurant.categories)[0] || '';
}

function compareSortValue(
    a: Restaurant,
    b: Restaurant,
    sortColumn: StampRestaurantSortColumn,
    sortDirection: StampRestaurantSortDirection
): number {
    if (!sortDirection) return 0;

    let comparison = 0;
    switch (sortColumn) {
        case 'name':
            comparison = (a.name || '').localeCompare(b.name || '');
            break;
        case 'category':
            comparison = getCategoryName(a).localeCompare(getCategoryName(b));
            break;
        case 'fanVisits':
            comparison = getReviewCount(a) - getReviewCount(b);
            break;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
}

export function compareStampRestaurants(
    a: Restaurant,
    b: Restaurant,
    { isVisited, sortColumn, sortDirection }: CompareStampRestaurantsOptions
): number {
    const aVisited = isVisited(a);
    const bVisited = isVisited(b);

    if (aVisited !== bVisited) {
        return aVisited ? -1 : 1;
    }

    return compareSortValue(a, b, sortColumn, sortDirection);
}

/**
 * 방문 판정을 맛집 객체당 한 번만 계산하도록 감쌉니다.
 *
 * 정렬 비교자는 비교할 때마다 두 맛집의 방문 여부를 다시 묻기 때문에, 1,372개 목록에서 판정이
 * 2만 5천 번까지 늘어납니다(비교 1회당 2번 x 약 1.2만 회 비교). 판정 결과는 맛집 객체에만
 * 의존하므로 WeakMap으로 고정해도 정렬 결과는 같고, 판정 횟수만 목록 길이로 줄어듭니다.
 */
export function createVisitedLookup(
    isVisited: (restaurant: Restaurant) => boolean
): (restaurant: Restaurant) => boolean {
    const cache = new WeakMap<Restaurant, boolean>();

    return (restaurant: Restaurant) => {
        const cached = cache.get(restaurant);
        if (cached !== undefined) return cached;

        const visited = isVisited(restaurant);
        cache.set(restaurant, visited);
        return visited;
    };
}
