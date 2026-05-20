import type { Restaurant } from '@/types/restaurant';

type MapBoundsLike = {
    getNorthEast: () => { lat: () => number; lng: () => number };
    getSouthWest: () => { lat: () => number; lng: () => number };
};

export function buildMapViewBoundsQuery(bounds: MapBoundsLike | null) {
    if (!bounds) return undefined;

    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    if (!southWest || !northEast) throw new Error('Google Maps bounds are missing corners');

    const query = {
        south: southWest.lat(),
        west: southWest.lng(),
        north: northEast.lat(),
        east: northEast.lng(),
    };

    for (const value of Object.values(query)) {
        if (!Number.isFinite(value)) {
            throw new Error('Google Maps bounds contain non-finite coordinates');
        }
    }

    return query;
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
