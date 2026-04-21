import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    buildPostSearchSwipeCandidates,
    buildRestaurantsForSwipe,
    getActiveSearchedRestaurant,
    isSameRestaurantSelection,
    releaseSearchSelectionOwnership,
    shouldHandleSearchSelection,
} from '../lib/mobile-home-search-selection';

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

describe('mobile home search selection helpers', () => {
    test('treats merged or coordinate-matched restaurants as the same selection', () => {
        const searchedRestaurant = makeRestaurant({
            id: 'search-1',
            mergedRestaurants: [{ id: 'merged-1' } as NonNullable<Restaurant['mergedRestaurants']>[number]],
        });
        const selectedRestaurant = makeRestaurant({
            id: 'merged-1',
            name: searchedRestaurant.name,
            lat: searchedRestaurant.lat,
            lng: searchedRestaurant.lng,
        });

        expect(isSameRestaurantSelection(searchedRestaurant, selectedRestaurant)).toBe(true);
    });

    test('keeps searched restaurant active only while it still matches the selected restaurant', () => {
        const searchedRestaurant = makeRestaurant({ id: 'search-1' });
        const currentSelection = makeRestaurant({ id: 'search-1' });
        const nextSelection = makeRestaurant({ id: 'next-restaurant', name: '다른 식당' });

        expect(
            getActiveSearchedRestaurant({
                searchedRestaurant,
                selectedRestaurant: currentSelection,
            })
        ).toEqual(searchedRestaurant);

        expect(
            getActiveSearchedRestaurant({
                searchedRestaurant,
                selectedRestaurant: nextSelection,
            })
        ).toBeNull();
    });

    test('handles a searched restaurant only once until search state is cleared', () => {
        const searchedRestaurant = makeRestaurant({ id: 'search-1' });

        expect(
            shouldHandleSearchSelection({
                searchedRestaurant,
                selectedRestaurant: searchedRestaurant,
                previousHandledRestaurant: null,
            })
        ).toBe(true);

        expect(
            shouldHandleSearchSelection({
                searchedRestaurant,
                selectedRestaurant: searchedRestaurant,
                previousHandledRestaurant: makeRestaurant({ id: 'search-1' }),
            })
        ).toBe(false);

        expect(
            shouldHandleSearchSelection({
                searchedRestaurant,
                selectedRestaurant: makeRestaurant({ id: 'different-restaurant', name: '다른 식당' }),
                previousHandledRestaurant: null,
            })
        ).toBe(false);
    });

    test('releases search ownership while keeping the current panel selection open', () => {
        const searchedRestaurant = makeRestaurant({ id: 'search-1' });
        const panelRestaurant = makeRestaurant({ id: 'search-1' });

        expect(
            releaseSearchSelectionOwnership({
                searchedRestaurant,
                selectedRestaurant: searchedRestaurant,
                panelRestaurant,
                isPanelOpen: true,
            })
        ).toEqual({
            searchedRestaurant: null,
            selectedRestaurant: searchedRestaurant,
            panelRestaurant,
            isPanelOpen: true,
        });
    });

    test('adds active searched restaurant to swipe candidates when it is outside display ids', () => {
        const visibleRestaurant = makeRestaurant({ id: 'visible-1' });
        const searchedRestaurant = makeRestaurant({ id: 'search-1' });

        expect(buildRestaurantsForSwipe({
            activeSearchedRestaurant: searchedRestaurant,
            displayRestaurantIds: new Set([visibleRestaurant.id]),
            displayRestaurants: [visibleRestaurant],
        }).map((restaurant) => restaurant.id)).toEqual(['visible-1', 'search-1']);
    });

    test('does not duplicate active searched restaurant already present in display ids', () => {
        const searchedRestaurant = makeRestaurant({ id: 'search-1' });

        expect(buildRestaurantsForSwipe({
            activeSearchedRestaurant: searchedRestaurant,
            displayRestaurantIds: new Set([searchedRestaurant.id]),
            displayRestaurants: [searchedRestaurant],
        }).map((restaurant) => restaurant.id)).toEqual(['search-1']);
    });

    test('adds the nearest fallback restaurant when only one visible restaurant remains after search', () => {
        const searchedRestaurant = makeRestaurant({ id: 'search-1', lat: 37.5665, lng: 126.978 });
        const nearestRestaurant = makeRestaurant({
            id: 'nearest-restaurant',
            name: '가까운 식당',
            lat: 37.5661,
            lng: 126.9772,
        });
        const fartherRestaurant = makeRestaurant({
            id: 'farther-restaurant',
            name: '먼 식당',
            lat: 37.56695,
            lng: 126.97885,
        });

        expect(
            buildPostSearchSwipeCandidates({
                visibleRestaurants: [searchedRestaurant],
                allRestaurants: [searchedRestaurant, fartherRestaurant, nearestRestaurant],
                activeSearchedRestaurant: searchedRestaurant,
            }).map((restaurant) => restaurant.id)
        ).toEqual(['search-1', 'nearest-restaurant']);
    });
});
