import type { Restaurant } from '@/types/restaurant';

export function mergeOverseasRestaurants(
    restaurants: Restaurant[],
    searchedRestaurant: Restaurant | null,
) {
    if (!searchedRestaurant) return restaurants;

    const exists = restaurants.some((restaurant) => restaurant.id === searchedRestaurant.id);
    return exists ? restaurants : [...restaurants, searchedRestaurant];
}

export function uniqueRestaurantsById(restaurants: Restaurant[]) {
    const uniqueRestaurants = new Map<string, Restaurant>();
    restaurants.forEach((restaurant) => {
        uniqueRestaurants.set(restaurant.id, restaurant);
    });
    return Array.from(uniqueRestaurants.values());
}
