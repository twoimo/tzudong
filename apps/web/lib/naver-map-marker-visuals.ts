import type { Restaurant } from '@/types/restaurant';
import { createIndividualMarkerHTML } from '@/lib/cluster-marker';
import { getPrimaryCategory } from '@/lib/naver-map-view-helpers';
import { getTzuyangVisitCount } from '@/lib/restaurant-visit-count';

type NaverIndividualMarkerRestaurant = Partial<Pick<
    Restaurant,
    | 'id'
    | 'categories'
    | 'youtube_link'
    | 'youtube_links'
    | 'tzuyang_review'
    | 'tzuyang_reviews'
    | 'mergedYoutubeLinks'
    | 'mergedTzuyangReviews'
    | 'mergedRestaurants'
>> & {
    category?: string | string[] | null;
};

export function getNaverIndividualMarkerVisual(
    restaurant: NaverIndividualMarkerRestaurant,
    isSelected: boolean,
) {
    const normalizedCategory = Array.isArray(restaurant.category)
        ? restaurant.category
        : (restaurant.category ? [restaurant.category] : []);
    const category = getPrimaryCategory({
        categories: restaurant.categories ?? [],
        category: normalizedCategory,
    });
    const visitCount = getTzuyangVisitCount(restaurant);

    return {
        content: createIndividualMarkerHTML(category, isSelected, visitCount, restaurant.id),
        anchor: isSelected ? { x: 18, y: 18 } : { x: 14, y: 14 },
        zIndex: isSelected ? 100 : 1,
    };
}
