import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    resolveNaverSearchSelectionPlan,
    resolveNaverSelectedMarkerStyleUpdatePlan,
    resolveNaverSelectionChange,
} from '../lib/naver-map-selection-helpers';

const restaurant = (overrides: Partial<Restaurant>): Restaurant => ({
    id: 'r1',
    name: '식당',
    lat: 37.5,
    lng: 127.1,
    address: '서울',
    category: '한식',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
} as Restaurant);

describe('naver map selection helpers', () => {
    test('detects changed selection ids', () => {
        expect(resolveNaverSelectionChange({
            currentSelectedId: 'r1',
            previousSelectedId: null,
        })).toEqual({
            isSelectionChanged: true,
            nextSelectedId: 'r1',
        });
    });

    test('detects unchanged selection ids', () => {
        expect(resolveNaverSelectionChange({
            currentSelectedId: 'r1',
            previousSelectedId: 'r1',
        })).toEqual({
            isSelectionChanged: false,
            nextSelectedId: 'r1',
        });
    });

    test('skips selected-marker style update when marker id is unchanged', () => {
        expect(resolveNaverSelectedMarkerStyleUpdatePlan({
            currentSelectedId: 'r1',
            previousSelectedId: 'r1',
        })).toEqual({
            nextPreviousSelectedId: 'r1',
            shouldSkip: true,
            updates: [],
        });
    });

    test('updates only previous marker when selection is cleared', () => {
        expect(resolveNaverSelectedMarkerStyleUpdatePlan({
            currentSelectedId: null,
            previousSelectedId: 'previous',
        })).toEqual({
            nextPreviousSelectedId: null,
            shouldSkip: false,
            updates: [
                { isSelected: false, restaurantId: 'previous' },
            ],
        });
    });

    test('updates previous and current marker when selection changes', () => {
        expect(resolveNaverSelectedMarkerStyleUpdatePlan({
            currentSelectedId: 'current',
            previousSelectedId: 'previous',
        })).toEqual({
            nextPreviousSelectedId: 'current',
            shouldSkip: false,
            updates: [
                { isSelected: false, restaurantId: 'previous' },
                { isSelected: true, restaurantId: 'current' },
            ],
        });
    });

    test('resets previous searched restaurant when no active search remains', () => {
        expect(resolveNaverSearchSelectionPlan({
            activeSearchedRestaurant: null,
            previousHandledRestaurant: restaurant({ id: 'previous' }),
            restaurants: [],
            selectedRestaurant: null,
        })).toEqual({
            actualSearchedRestaurant: null,
            focusTarget: null,
            matchedExistingRestaurant: null,
            nextPreviousSearchedRestaurant: null,
            shouldHandle: false,
            shouldNotifyParentSelection: false,
            shouldOpenPanel: false,
        });
    });

    test('uses matched canonical restaurant and asks parent selection to sync', () => {
        const activeSearch = restaurant({
            id: 'merged-source',
            mergedRestaurants: [restaurant({ id: 'canonical' })],
        });
        const canonical = restaurant({
            id: 'canonical',
            name: '정식당',
            lat: 37.6,
            lng: 127.2,
        });

        expect(resolveNaverSearchSelectionPlan({
            activeSearchedRestaurant: activeSearch,
            previousHandledRestaurant: null,
            restaurants: [canonical],
            selectedRestaurant: null,
        })).toEqual({
            actualSearchedRestaurant: canonical,
            focusTarget: {
                lat: 37.6,
                lng: 127.2,
                zoom: 15,
            },
            matchedExistingRestaurant: canonical,
            nextPreviousSearchedRestaurant: canonical,
            shouldHandle: true,
            shouldNotifyParentSelection: true,
            shouldOpenPanel: true,
        });
    });

    test('skips repeated active search selection already handled', () => {
        const activeSearch = restaurant({ id: 'same' });

        expect(resolveNaverSearchSelectionPlan({
            activeSearchedRestaurant: activeSearch,
            previousHandledRestaurant: activeSearch,
            restaurants: [],
            selectedRestaurant: activeSearch,
        })).toMatchObject({
            focusTarget: null,
            nextPreviousSearchedRestaurant: activeSearch,
            shouldHandle: false,
            shouldNotifyParentSelection: false,
            shouldOpenPanel: false,
        });
    });
});
