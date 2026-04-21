import { describe, expect, test } from 'bun:test';

import {
    buildNaverCurrentStateSnapshot,
    buildNaverInitialCurrentStateSnapshot,
    getNaverCurrentPanelOffset,
    resolveNaverRestaurantCountUpdatePlan,
} from '../lib/naver-map-current-state-helpers';

describe('naver map current state helpers', () => {
    test('builds current state snapshot from panel and layout state', () => {
        expect(buildNaverCurrentStateSnapshot({
            effectivePanelOffset: 400,
            externalPanelOpen: false,
            isGridMode: true,
            isPanelCollapsed: false,
            isSidebarOpen: true,
        })).toEqual({
            effectivePanelOffset: 400,
            externalPanelOpen: false,
            isGridMode: true,
            isPanelCollapsed: false,
            isSidebarOpen: true,
        });
    });

    test('returns current panel offset from snapshot', () => {
        expect(getNaverCurrentPanelOffset({ effectivePanelOffset: 320 })).toBe(320);
    });

    test('builds initial current state snapshot with zero panel offset', () => {
        expect(buildNaverInitialCurrentStateSnapshot({
            externalPanelOpen: true,
            isGridMode: false,
            isPanelCollapsed: true,
            isSidebarOpen: false,
        })).toEqual({
            effectivePanelOffset: 0,
            externalPanelOpen: true,
            isGridMode: false,
            isPanelCollapsed: true,
            isSidebarOpen: false,
        });
    });

    test('resolves restaurant count badge update only for loaded non-empty data', () => {
        expect(resolveNaverRestaurantCountUpdatePlan({
            isLoadingRestaurants: false,
            restaurantsLength: 3,
        })).toEqual({
            hideDelayMs: 3000,
            shouldShowRestaurantCount: true,
            shouldStorePreviousRestaurants: true,
        });

        expect(resolveNaverRestaurantCountUpdatePlan({
            isLoadingRestaurants: true,
            restaurantsLength: 3,
        }).shouldShowRestaurantCount).toBe(false);

        expect(resolveNaverRestaurantCountUpdatePlan({
            hideDelayMs: 1000,
            isLoadingRestaurants: false,
            restaurantsLength: 0,
        })).toEqual({
            hideDelayMs: 1000,
            shouldShowRestaurantCount: false,
            shouldStorePreviousRestaurants: false,
        });
    });
});
