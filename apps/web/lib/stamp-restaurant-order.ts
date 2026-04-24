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
