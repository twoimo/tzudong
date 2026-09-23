import type { Restaurant } from '@/types/restaurant';

type RestaurantMatch = Pick<Restaurant, 'id' | 'name' | 'lat' | 'lng' | 'mergedRestaurants'>;

export interface RestaurantLookup {
    byId: Map<string, Restaurant>;
    idSet: Set<string>;
    mergedRestaurantIds: Set<string>;
    mergedRestaurantById: Map<string, Restaurant>;
}

const hasSameNameAndCoordinate = (left: RestaurantMatch, right: RestaurantMatch): boolean => {
    return (
        left.name === right.name &&
        Math.abs((left.lat || 0) - (right.lat || 0)) < 0.0001 &&
        Math.abs((left.lng || 0) - (right.lng || 0)) < 0.0001
    );
};

export const buildRestaurantLookup = (restaurants: Restaurant[]): RestaurantLookup => {
    const byId = new Map<string, Restaurant>();
    const idSet = new Set<string>();
    const mergedRestaurantIds = new Set<string>();
    const mergedRestaurantById = new Map<string, Restaurant>();

    restaurants.forEach((restaurant) => {
        byId.set(restaurant.id, restaurant);
        idSet.add(restaurant.id);

        restaurant.mergedRestaurants?.forEach((mergedRestaurant) => {
            mergedRestaurantIds.add(mergedRestaurant.id);
            if (!mergedRestaurantById.has(mergedRestaurant.id)) {
                mergedRestaurantById.set(mergedRestaurant.id, restaurant);
            }
        });
    });

    return { byId, idSet, mergedRestaurantIds, mergedRestaurantById };
};

export const findMatchingRestaurantInList = (
    target: Restaurant | null | undefined,
    candidates: Restaurant[] | null | undefined,
): Restaurant | null => {
    if (!target || !candidates || candidates.length === 0) return null;

    const mergedRestaurants = target.mergedRestaurants;
    if (mergedRestaurants && mergedRestaurants.length > 0) {
        const mergedIds = new Set(mergedRestaurants.map((restaurant) => restaurant.id));
        for (const candidate of candidates) {
            if (
                mergedIds.has(candidate.id) ||
                candidate.mergedRestaurants?.some((mergedRestaurant) => mergedIds.has(mergedRestaurant.id)) ||
                hasSameNameAndCoordinate(candidate, target)
            ) {
                return candidate;
            }
        }
        return null;
    }

    const targetId = target.id;
    for (const candidate of candidates) {
        if (
            candidate.id === targetId ||
            candidate.mergedRestaurants?.some((mergedRestaurant) => mergedRestaurant.id === targetId) ||
            hasSameNameAndCoordinate(candidate, target)
        ) {
            return candidate;
        }
    }
    return null;
};
