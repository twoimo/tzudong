import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { getAdjacentRestaurantByStep } from '../lib/home-map-keyboard-navigation';
import { shouldDismissSheetFromPeek } from '../lib/mobile-sheet-dismiss-gesture';
import { buildPostSearchSwipeCandidates, releaseSearchSelectionOwnership } from '../lib/mobile-home-search-selection';
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate } from '../lib/map-render-guard';
import { resolveMobileMapBlankTapAction } from '../lib/mobile-map-fullscreen-toggle';

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

    test('peek-state downward sheet gesture dismisses only after intentional distance or speed', () => {
        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 64,
            gestureVelocity: 0.12,
        })).toBe(true);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 18,
            gestureVelocity: 0.3,
            minVelocityPxPerMs: 0.26,
        })).toBe(true);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 18,
            gestureVelocity: 0.12,
            minVelocityPxPerMs: 0.26,
        })).toBe(false);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: false,
            dragDistancePx: 80,
            gestureVelocity: 0.4,
        })).toBe(false);
    });

    test('blank map taps collapse the sheet, enter fullscreen map, then restore the peek sheet', () => {
        const baseState = {
            isMobileOrTablet: true,
            isPanelOpen: true,
            hasPanelRestaurant: true,
            peekHeight: 25,
        };

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: false,
            sheetHeight: 50,
        })).toBe('collapse-to-peek');

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: false,
            sheetHeight: 25,
        })).toBe('enter-map-fullscreen');

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: true,
            sheetHeight: 25,
        })).toBe('restore-from-map-fullscreen');
    });

    test('blank map fullscreen toggle is inactive outside a mobile restaurant panel', () => {
        expect(resolveMobileMapBlankTapAction({
            isMobileOrTablet: false,
            isPanelOpen: true,
            hasPanelRestaurant: true,
            isMapFullscreen: false,
            sheetHeight: 50,
            peekHeight: 25,
        })).toBe('none');

        expect(resolveMobileMapBlankTapAction({
            isMobileOrTablet: true,
            isPanelOpen: false,
            hasPanelRestaurant: true,
            isMapFullscreen: false,
            sheetHeight: 50,
            peekHeight: 25,
        })).toBe('none');
    });
});
