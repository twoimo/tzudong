import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    buildMapViewBoundsQuery,
    findUpdatedSelectedRestaurant,
    getMapViewRestaurantCountToastVisible,
} from '../lib/map-view-state-helpers';

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

describe('map view state helpers', () => {
    test('builds bounds query from google map bounds', () => {
        const bounds = {
            getNorthEast: () => ({ lat: () => 38, lng: () => 128 }),
            getSouthWest: () => ({ lat: () => 37, lng: () => 126 }),
        };
        expect(buildMapViewBoundsQuery(bounds)).toEqual({
            south: 37,
            west: 126,
            north: 38,
            east: 128,
        });
        expect(buildMapViewBoundsQuery(null)).toBeUndefined();
    });

    test('finds updated selected restaurant by id', () => {
        const updated = findUpdatedSelectedRestaurant(
            [makeRestaurant({ id: 'a', name: 'updated' }), makeRestaurant({ id: 'b' })],
            makeRestaurant({ id: 'a', name: 'old' }),
        );
        expect(updated?.name).toBe('updated');
        expect(findUpdatedSelectedRestaurant([], null)).toBeNull();
    });

    test('computes restaurant count toast visibility', () => {
        expect(getMapViewRestaurantCountToastVisible(3, false)).toBe(true);
        expect(getMapViewRestaurantCountToastVisible(0, false)).toBe(false);
        expect(getMapViewRestaurantCountToastVisible(3, true)).toBe(false);
    });
});
