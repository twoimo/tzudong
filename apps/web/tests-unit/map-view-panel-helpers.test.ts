import { describe, expect, mock, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    buildMapViewPanelStateSetter,
    buildMapViewPanelCloseHandler,
    buildMapViewRestaurantAction,
    buildMapViewReviewOpenHandler,
    buildMapViewTogglePanelHandler,
    resolveMapViewPanelOpenState,
    resolveMapViewPanelWidth,
} from '../lib/map-view-panel-helpers';

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

describe('map view panel helpers', () => {
    test('builds panel state setter that prefers external collapse toggle', () => {
        const onTogglePanelCollapse = mock();
        const setLocalIsPanelOpen = mock();

        buildMapViewPanelStateSetter({ onTogglePanelCollapse, setLocalIsPanelOpen })(true);
        buildMapViewPanelStateSetter({ setLocalIsPanelOpen })(false);

        expect(onTogglePanelCollapse).toHaveBeenCalledTimes(1);
        expect(setLocalIsPanelOpen).toHaveBeenCalledTimes(1);
        expect(setLocalIsPanelOpen).toHaveBeenCalledWith(false);
    });

    test('resolves panel width preferring prop width', () => {
        expect(resolveMapViewPanelWidth({ panelWidth: 100, propPanelWidth: 320 })).toBe(320);
        expect(resolveMapViewPanelWidth({ panelWidth: 100 })).toBe(100);
    });

    test('resolves panel open state preferring prop state', () => {
        expect(resolveMapViewPanelOpenState({ localIsPanelOpen: false, propIsPanelOpen: true })).toBe(true);
        expect(resolveMapViewPanelOpenState({ localIsPanelOpen: true })).toBe(true);
    });

    test('prefers external panel close callback', () => {
        const onPanelClose = mock();
        const setIsPanelOpen = mock();

        buildMapViewPanelCloseHandler({ onPanelClose, setIsPanelOpen })( );

        expect(onPanelClose).toHaveBeenCalledTimes(1);
        expect(setIsPanelOpen).not.toHaveBeenCalled();
    });

    test('falls back to local panel state update', () => {
        const setIsPanelOpen = mock();

        buildMapViewPanelCloseHandler({ setIsPanelOpen })( );

        expect(setIsPanelOpen).toHaveBeenCalledWith(false);
    });

    test('toggles panel using current state snapshot', () => {
        const setIsPanelOpen = mock();

        buildMapViewTogglePanelHandler({ isPanelOpen: true, setIsPanelOpen })();
        expect(setIsPanelOpen).toHaveBeenCalledWith(false);
    });

    test('opens review modal', () => {
        const setIsReviewModalOpen = mock();
        buildMapViewReviewOpenHandler(setIsReviewModalOpen)();
        expect(setIsReviewModalOpen).toHaveBeenCalledWith(true);
    });

    test('creates restaurant-bound action only when callback exists', () => {
        const restaurant = makeRestaurant();
        const action = mock();
        const bound = buildMapViewRestaurantAction(action, restaurant);

        expect(typeof bound).toBe('function');
        bound?.();
        expect(action).toHaveBeenCalledWith(restaurant);
        expect(buildMapViewRestaurantAction(undefined, restaurant)).toBeUndefined();
        expect(buildMapViewRestaurantAction(action, null)).toBeUndefined();
    });
});
