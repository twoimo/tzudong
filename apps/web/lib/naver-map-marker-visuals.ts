import type { Restaurant } from '@/types/restaurant';
import { createIndividualMarkerHTML } from '@/lib/cluster-marker';
import { getPrimaryCategory } from '@/lib/naver-map-view-helpers';

export function getNaverIndividualMarkerVisual(
    restaurant: {
        categories?: Restaurant['categories'];
        category?: string | string[] | null;
    },
    isSelected: boolean,
) {
    const normalizedCategory = Array.isArray(restaurant.category)
        ? restaurant.category
        : (restaurant.category ? [restaurant.category] : []);
    const category = getPrimaryCategory({
        categories: restaurant.categories ?? [],
        category: normalizedCategory,
    });
    return {
        content: createIndividualMarkerHTML(category, isSelected),
        anchor: isSelected ? { x: 18, y: 18 } : { x: 14, y: 14 },
        zIndex: isSelected ? 100 : 1,
    };
}
