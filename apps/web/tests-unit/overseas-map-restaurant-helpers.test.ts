import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { mergeOverseasRestaurants, uniqueRestaurantsById } from '../lib/overseas-map-restaurant-helpers';

const makeRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
    id: overrides.id ?? 'restaurant-1',
    name: overrides.name ?? '테스트 식당',
    lat: overrides.lat ?? 37.5,
    lng: overrides.lng ?? 127.0,
    category: overrides.category ?? ['한식'],
    categories: overrides.categories ?? ['한식'],
    weekly_search_count: overrides.weekly_search_count ?? null,
    ...overrides,
} as Restaurant);

describe('overseas map restaurant helpers', () => {
    test('merges searched restaurant only when missing', () => {
        const base = [makeRestaurant({ id: 'a' })];
        expect(mergeOverseasRestaurants(base, makeRestaurant({ id: 'b' })).map((restaurant) => restaurant.id)).toEqual(['a', 'b']);
        expect(mergeOverseasRestaurants(base, makeRestaurant({ id: 'a' })).map((restaurant) => restaurant.id)).toEqual(['a']);
    });

    test('keeps only the last restaurant for duplicate ids', () => {
        const unique = uniqueRestaurantsById([
            makeRestaurant({ id: 'a', name: 'first' }),
            makeRestaurant({ id: 'a', name: 'second' }),
            makeRestaurant({ id: 'b', name: 'third' }),
        ]);

        expect(unique).toHaveLength(2);
        expect(unique.find((restaurant) => restaurant.id === 'a')?.name).toBe('second');
    });
});
