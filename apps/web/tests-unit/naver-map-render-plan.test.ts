import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    buildRenderTargetIdsForSignature,
    deriveClusterRenderPlan,
    getVisibleRestaurantsForRender,
} from '../lib/naver-map-render-plan';

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

describe('naver map render plan helpers', () => {
    test('derives regional cluster mode for low zoom without selected region', () => {
        const plan = deriveClusterRenderPlan(8, false, 14, [], []);
        expect(plan.nextIsRegionalClusterMode).toBe(true);
        expect(plan.nextIsClusterMode).toBe(true);
        expect(plan.nextIsSeoulDistrictMode).toBe(false);
    });

    test('derives seoul district filtered mode for mid zoom', () => {
        const seoulFiltered = [{ region: '강남구', count: 3, center: { lat: 37.5, lng: 127.0 }, categories: ['한식'] }] as any[];
        const plan = deriveClusterRenderPlan(11, false, 14, [], seoulFiltered as any);
        expect(plan.nextIsRegionalClusterMode).toBe(false);
        expect(plan.nextIsSeoulDistrictMode).toBe(true);
        expect(plan.seoulClustersToRender).toEqual(seoulFiltered);
        expect(plan.shouldUseSeoulDistrictFiltered).toBe(true);
    });

    test('filters visible restaurants while preserving selected restaurant', () => {
        const selected = makeRestaurant({ id: 'selected', lat: 40, lng: 140 });
        const visible = makeRestaurant({ id: 'visible', lat: 37.5, lng: 127.0 });
        const hidden = makeRestaurant({ id: 'hidden', lat: 40, lng: 140 });
        const result = getVisibleRestaurantsForRender(
            [selected, visible, hidden],
            'selected',
            { south: 37, north: 38, west: 126, east: 128 },
            true,
        );
        expect(result.map((restaurant) => restaurant.id)).toEqual(['selected', 'visible']);
    });

    test('builds stable render target ids for restaurants and regional clusters', () => {
        const restaurants = [makeRestaurant({ id: 'visible' })];
        const ids = buildRenderTargetIdsForSignature({
            activeSearchedRestaurant: makeRestaurant({ id: 'searched', lat: 38, lng: 128 }),
            clusters: [],
            displayRestaurantIds: new Set(['visible']),
            displayRestaurants: restaurants,
            mergedRestaurantById: new Map(),
            nextIsClusterMode: false,
            nextIsRegionalClusterMode: true,
            nextIsSeoulDistrictMode: false,
            regionalClusters: [{ region: '서울', count: 2, center: { lat: 37.5, lng: 127.0 }, categories: ['한식', '분식'] }] as any,
            restaurantById: new Map(),
            seoulClustersToRender: [],
            seoulIndividualIds: [],
        });
        expect(ids[0]).toContain('restaurant-visible');
        expect(ids[1]).toContain('searched-searched');
        expect(ids[2]).toContain('regional-서울:2:37.500000:127.000000');
    });
});
