import type { Restaurant } from '@/types/restaurant';

type MapBoundsLike = {
    getNorthEast: () => { lat: () => number; lng: () => number };
    getSouthWest: () => { lat: () => number; lng: () => number };
};

export function buildMapViewBoundsQuery(bounds: MapBoundsLike | null) {
    if (!bounds) return undefined;

    return {
        south: bounds.getSouthWest().lat(),
        west: bounds.getSouthWest().lng(),
        north: bounds.getNorthEast().lat(),
        east: bounds.getNorthEast().lng(),
    };
}

export function findUpdatedSelectedRestaurant(
    restaurants: Restaurant[],
    selectedRestaurant: Restaurant | null | undefined,
) {
    if (!selectedRestaurant) return null;
    return restaurants.find((restaurant) => restaurant.id === selectedRestaurant.id) ?? null;
}

export function getMapViewRestaurantCountToastVisible(
    restaurantsLength: number,
    isLoadingRestaurants: boolean,
) {
    return restaurantsLength > 0 && !isLoadingRestaurants;
}

