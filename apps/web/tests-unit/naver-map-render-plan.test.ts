import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    buildRenderTargetIdsForSignature,
    deriveClusterRenderPlan,
    getRestaurantsWithRenderableCoordinates,
    hasNaverMarkerCoordinates,
    getSeoulIndividualRestaurantsForRender,
    getVisibleRestaurantsForRender,
    nextEmptyIdentityArray,
    resolveEmptyClusterMarkerCleanupPlan,
    resolveSkippedEmptyThemeMarkerPlan,
    shouldClearEmptyClusterState,
    shouldReportNaverMarkerRenderPerformance,
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

    test('keeps only restaurants that can produce Naver marker coordinates', () => {
        const result = getRestaurantsWithRenderableCoordinates([
            makeRestaurant({ id: 'valid', lat: 37.5, lng: 127.0 }),
            makeRestaurant({ id: 'missing-lat', lat: null as any, lng: 127.0 }),
            makeRestaurant({ id: 'missing-lng', lat: 37.5, lng: null as any }),
            makeRestaurant({ id: 'zero-lat', lat: 0, lng: 127.0 }),
        ]);

        expect(result.map((restaurant) => restaurant.id)).toEqual(['valid', 'zero-lat']);
    });

    test('treats numeric coordinate strings as renderable marker coordinates', () => {
        expect(hasNaverMarkerCoordinates({ lat: '37.5', lng: '127.0' })).toBe(false);
        expect(hasNaverMarkerCoordinates({ lat: null, lng: 127.0 })).toBe(false);
        const result = getRestaurantsWithRenderableCoordinates([
            makeRestaurant({ id: 'string-coords', lat: '37.5' as any, lng: '127.0' as any }),
        ]);
        expect(result.map((restaurant) => restaurant.id)).toEqual(['string-coords']);
        expect(result[0]?.lat).toBe(37.5);
        expect(result[0]?.lng).toBe(127);
        expect(typeof result[0]?.lat).toBe('number');
        expect(typeof result[0]?.lng).toBe('number');
    });

    test('filters Seoul individual marker candidates by id and coordinates', () => {
        const result = getSeoulIndividualRestaurantsForRender({
            displayRestaurants: [
                makeRestaurant({ id: 'renderable', lat: 37.5, lng: 127.0 }),
                makeRestaurant({ id: 'not-requested', lat: 37.6, lng: 127.1 }),
                makeRestaurant({ id: 'string-coordinates', lat: '37.7' as any, lng: '127.2' as any }),
                makeRestaurant({ id: 'missing-coordinate', lat: null as any, lng: 127.2 }),
            ],
            seoulIndividualIds: ['renderable', 'string-coordinates', 'missing-coordinate', 'missing-from-data'],
        });

        expect(result.map((restaurant) => restaurant.id)).toEqual(['renderable', 'string-coordinates']);
        expect(result[1]?.lat).toBe(37.7);
        expect(result[1]?.lng).toBe(127.2);
    });

    test('builds stable render target ids for restaurants and regional clusters', () => {
        const restaurants = [makeRestaurant({ id: 'visible' })];
        const ids = buildRenderTargetIdsForSignature({
            activeSearchedRestaurant: makeRestaurant({ id: 'searched', lat: 38, lng: 128 }),
            selectedRestaurant: null,
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

    test('includes visit count in marker render signature', () => {
        const ids = buildRenderTargetIdsForSignature({
            activeSearchedRestaurant: null,
            selectedRestaurant: null,
            clusters: [],
            displayRestaurantIds: new Set(['multi-visit']),
            displayRestaurants: [makeRestaurant({
                id: 'multi-visit',
                mergedYoutubeLinks: ['https://youtu.be/one', 'https://youtu.be/two'],
            })],
            mergedRestaurantById: new Map(),
            nextIsClusterMode: false,
            nextIsRegionalClusterMode: false,
            nextIsSeoulDistrictMode: false,
            regionalClusters: [],
            restaurantById: new Map(),
            seoulClustersToRender: [],
            seoulIndividualIds: [],
        });

        expect(ids[0]).toContain('restaurant-multi-visit:37.500000:127.000000:한식:2');
    });

    test('includes selected restaurant outside display data in marker render signature', () => {
        const ids = buildRenderTargetIdsForSignature({
            activeSearchedRestaurant: null,
            selectedRestaurant: makeRestaurant({ id: 'selected', lat: 38, lng: 128 }),
            clusters: [],
            displayRestaurantIds: new Set(['visible']),
            displayRestaurants: [makeRestaurant({ id: 'visible' })],
            mergedRestaurantById: new Map(),
            nextIsClusterMode: false,
            nextIsRegionalClusterMode: false,
            nextIsSeoulDistrictMode: false,
            regionalClusters: [],
            restaurantById: new Map(),
            seoulClustersToRender: [],
            seoulIndividualIds: [],
        });

        expect(ids.some((id) => id.includes('selected-selected'))).toBe(true);
    });

    test('reports marker render performance only for large development marker sets', () => {
        expect(shouldReportNaverMarkerRenderPerformance({
            activeMarkerCount: 51,
            isDevelopment: true,
        })).toBe(true);

        expect(shouldReportNaverMarkerRenderPerformance({
            activeMarkerCount: 50,
            isDevelopment: true,
        })).toBe(false);

        expect(shouldReportNaverMarkerRenderPerformance({
            activeMarkerCount: 100,
            isDevelopment: false,
        })).toBe(false);
    });

    test('clears empty cluster state when clustering is off or display is empty', () => {
        expect(shouldClearEmptyClusterState({
            clusteringEnabled: false,
            displayRestaurantCount: 4,
        })).toBe(true);

        expect(shouldClearEmptyClusterState({
            clusteringEnabled: true,
            displayRestaurantCount: 0,
        })).toBe(true);

        expect(shouldClearEmptyClusterState({
            clusteringEnabled: true,
            displayRestaurantCount: 2,
        })).toBe(false);

        expect(shouldClearEmptyClusterState({
            clusteringEnabled: true,
            displayRestaurantCount: 0,
            expandedRestaurantCount: 3,
        })).toBe(false);

        expect(shouldClearEmptyClusterState({
            clusteringEnabled: false,
            displayRestaurantCount: 0,
            expandedRestaurantCount: 2,
        })).toBe(false);
    });

    test('reuses the previous empty array identity when clearing cluster collections', () => {
        const emptyPrevious: string[] = [];
        const nonEmptyPrevious = ['cluster-a'];

        expect(nextEmptyIdentityArray(emptyPrevious)).toBe(emptyPrevious);
        expect(nextEmptyIdentityArray(nonEmptyPrevious)).toEqual([]);
        expect(nextEmptyIdentityArray(nonEmptyPrevious)).not.toBe(nonEmptyPrevious);
    });

    test('continues skipped marker updates only when an empty theme still has leftover DOM', () => {
        expect(resolveSkippedEmptyThemeMarkerPlan({
            displayRestaurantCount: 0,
            hasRenderedMarkerDom: true,
        })).toBe('continue');

        expect(resolveSkippedEmptyThemeMarkerPlan({
            displayRestaurantCount: 0,
            hasRenderedMarkerDom: false,
        })).toBe('skip');

        expect(resolveSkippedEmptyThemeMarkerPlan({
            displayRestaurantCount: 2,
            hasRenderedMarkerDom: true,
        })).toBe('skip');

        expect(resolveSkippedEmptyThemeMarkerPlan({
            displayRestaurantCount: 2,
            hasRenderedMarkerDom: false,
        })).toBe('retry');
    });

    test('releases leftover cluster markers when the empty theme display is empty', () => {
        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 0,
            clusterCount: 2,
        })).toBe('release');

        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 3,
            clusterCount: 0,
        })).toBe('retry');

        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 3,
            clusterCount: 1,
        })).toBe('render');

        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 0,
            clusterCount: 1,
            expandedRestaurantCount: 4,
        })).toBe('render');

        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 0,
            clusterCount: 0,
            expandedRestaurantCount: 2,
        })).toBe('render');
    });
});
