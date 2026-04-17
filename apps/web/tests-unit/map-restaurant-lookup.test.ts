import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    buildRestaurantLookup,
    findMatchingRestaurantInList,
} from '../lib/map-restaurant-lookup';

const makeRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => (
    {
        id: overrides.id ?? 'restaurant-1',
        name: overrides.name ?? '테스트 식당',
        lat: overrides.lat ?? 37.5,
        lng: overrides.lng ?? 127.0,
        category: overrides.category ?? ['한식'],
        categories: overrides.categories ?? ['한식'],
        weekly_search_count: overrides.weekly_search_count ?? null,
        ...overrides,
    } as Restaurant
);

describe('map restaurant lookup helpers', () => {
    test('indexes visible and merged restaurant ids without overwriting the first owner', () => {
        const mergedRestaurant = { id: 'merged-1' } as NonNullable<Restaurant['mergedRestaurants']>[number];
        const primaryRestaurant = makeRestaurant({
            id: 'restaurant-1',
            mergedRestaurants: [mergedRestaurant],
        });
        const duplicateOwnerRestaurant = makeRestaurant({
            id: 'restaurant-2',
            mergedRestaurants: [mergedRestaurant],
        });

        const lookup = buildRestaurantLookup([primaryRestaurant, duplicateOwnerRestaurant]);

        expect(lookup.byId.get('restaurant-1')).toEqual(primaryRestaurant);
        expect(lookup.idSet.has('restaurant-2')).toBe(true);
        expect(lookup.mergedRestaurantIds.has('merged-1')).toBe(true);
        expect(lookup.mergedRestaurantById.get('merged-1')).toEqual(primaryRestaurant);
    });

    test('matches a merged search result to the visible restaurant that owns it', () => {
        const visibleRestaurant = makeRestaurant({
            id: 'restaurant-visible',
            mergedRestaurants: [{ id: 'merged-1' } as NonNullable<Restaurant['mergedRestaurants']>[number]],
        });
        const searchedRestaurant = makeRestaurant({
            id: 'search-result',
            mergedRestaurants: [{ id: 'merged-1' } as NonNullable<Restaurant['mergedRestaurants']>[number]],
        });

        expect(findMatchingRestaurantInList(searchedRestaurant, [visibleRestaurant])).toEqual(visibleRestaurant);
    });

    test('falls back to matching by name and coordinates for non-merged restaurants', () => {
        const selectedRestaurant = makeRestaurant({
            id: 'selected-1',
            name: '같은 식당',
            lat: 37.5665,
            lng: 126.978,
        });
        const visibleRestaurant = makeRestaurant({
            id: 'visible-1',
            name: '같은 식당',
            lat: 37.56654,
            lng: 126.97802,
        });

        expect(findMatchingRestaurantInList(selectedRestaurant, [visibleRestaurant])).toEqual(visibleRestaurant);
    });
});
