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
    target: Restaurant,
    candidates: Restaurant[],
): Restaurant | null => {
    if (target.mergedRestaurants && target.mergedRestaurants.length > 0) {
        const mergedIds = target.mergedRestaurants.map((restaurant) => restaurant.id);
        return (
            candidates.find((candidate) =>
                mergedIds.includes(candidate.id) ||
                candidate.mergedRestaurants?.some((mergedRestaurant) => mergedIds.includes(mergedRestaurant.id)) ||
                hasSameNameAndCoordinate(candidate, target)
            ) ?? null
        );
    }

    return (
        candidates.find((candidate) =>
            candidate.id === target.id ||
            candidate.mergedRestaurants?.some((mergedRestaurant) => mergedRestaurant.id === target.id) ||
            hasSameNameAndCoordinate(candidate, target)
        ) ?? null
    );
};
