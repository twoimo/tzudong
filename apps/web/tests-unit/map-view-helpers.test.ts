import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    getAdjustedSelectedRestaurantLng,
    getMapViewCountryConfig,
    getMapViewMarkerIcon,
    MAP_VIEW_DEFAULT_CENTER,
    mergeSearchedRestaurant,
} from '../lib/map-view-helpers';

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

describe('map view helpers', () => {
    test('returns country config or default center', () => {
        expect(getMapViewCountryConfig('일본')).toEqual({ lat: 35.1815, lng: 136.9066, zoom: 10 });
        expect(getMapViewCountryConfig(null)).toEqual(MAP_VIEW_DEFAULT_CENTER);
    });

    test('merges searched restaurant only when missing', () => {
        const base = [makeRestaurant({ id: 'a' })];
        const searched = makeRestaurant({ id: 'b' });
        expect(mergeSearchedRestaurant(base, searched).map((restaurant) => restaurant.id)).toEqual(['a', 'b']);
        expect(mergeSearchedRestaurant(base, makeRestaurant({ id: 'a' })).map((restaurant) => restaurant.id)).toEqual(['a']);
    });

    test('returns marker icon path and fallback', () => {
        expect(getMapViewMarkerIcon(['치킨'])).toContain('chicken');
        expect(getMapViewMarkerIcon(['없는카테고리'])).toContain('korean');
    });

    test('computes adjusted lng from panel width', () => {
        expect(getAdjustedSelectedRestaurantLng({
            boundsNorthEastLng: 128,
            boundsSouthWestLng: 126,
            lng: 127,
            mapWidth: 1000,
            panelWidth: 400,
            sidebarWidth: 0,
        })).toBeCloseTo(127.4, 5);
    });
});
