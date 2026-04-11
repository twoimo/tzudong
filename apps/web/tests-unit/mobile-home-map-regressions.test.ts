import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { getAdjacentRestaurantByStep } from '../lib/home-map-keyboard-navigation';
import { buildPostSearchSwipeCandidates, releaseSearchSelectionOwnership } from '../lib/mobile-home-search-selection';
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate } from '../lib/map-render-guard';

const makeRestaurant = (id: string, name: string): Restaurant =>
    ({
        id,
        name,
        lat: 37.5665,
        lng: 126.978,
    }) as Restaurant;

describe('mobile home map regression guards', () => {
    test('search-selected restaurant can still swipe to a different visible restaurant', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');
        const nearbyMarkerRestaurant = makeRestaurant('marker-next', '명동칼국수');
        const anotherNearbyRestaurant = makeRestaurant('marker-third', '서울돈까스');

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: [searchedRestaurant, nearbyMarkerRestaurant, anotherNearbyRestaurant],
            currentRestaurant: searchedRestaurant,
            step: 1,
            isSameRestaurant: (left, right) => left.id === right.id,
        });

        expect(nextRestaurant?.id).toBe('marker-next');
    });

    test('marker render is not skipped when another marker takes over after a search selection', () => {
        const sharedBounds = {
            south: 37.565,
            west: 126.977,
            north: 37.568,
            east: 126.98,
        } as const;
        const sharedDisplayIds = ['search-selected', 'marker-next', 'marker-third'] as const;

        const previous = buildMarkerRenderSignature({
            zoom: 15,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'search-selected',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'marker-next',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('marker render is not skipped when the sheet closes and a new marker opens with cleared search state', () => {
        const sharedBounds = {
            south: 37.565,
            west: 126.977,
            north: 37.568,
            east: 126.98,
        } as const;
        const sharedDisplayIds = ['search-selected', 'marker-next', 'marker-third'] as const;

        const previous = buildMarkerRenderSignature({
            zoom: 15,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'search-selected',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'marker-third',
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('single-visible post-search swipe falls back to the nearest restaurant', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');
        const nearestRestaurant = {
            ...makeRestaurant('marker-nearest', '서울돈까스'),
            lat: 37.5661,
            lng: 126.9772,
        } as Restaurant;
        const fartherRestaurant = {
            ...makeRestaurant('marker-farther', '명동칼국수'),
            lat: 37.56695,
            lng: 126.97885,
        } as Restaurant;

        const swipeCandidates = buildPostSearchSwipeCandidates({
            visibleRestaurants: [searchedRestaurant],
            allRestaurants: [searchedRestaurant, fartherRestaurant, nearestRestaurant],
            activeSearchedRestaurant: searchedRestaurant,
        });

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: swipeCandidates,
            currentRestaurant: searchedRestaurant,
            step: 1,
            isSameRestaurant: (left, right) => left.id === right.id,
        });

        expect(nextRestaurant?.id).toBe('marker-nearest');
    });

    test('search ownership release keeps the current detail selection active', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');

        expect(
            releaseSearchSelectionOwnership({
                searchedRestaurant,
                selectedRestaurant: searchedRestaurant,
                panelRestaurant: searchedRestaurant,
                isPanelOpen: true,
            })
        ).toMatchObject({
            searchedRestaurant: null,
            selectedRestaurant: searchedRestaurant,
            panelRestaurant: searchedRestaurant,
            isPanelOpen: true,
        });
    });
});
