import { describe, expect, test } from 'bun:test';

import {
    buildNaverMapDetailPanelFocusCaptureHandler,
    buildNaverMapDetailPanelMouseDownCaptureHandler,
    buildNaverMapInternalPanelCloseHandler,
    buildNaverMapInternalPanelToggleHandler,
    buildNaverMarkerRestaurantSelectionHandler,
    buildNaverMapRestaurantAction,
    buildNaverMapReviewCloseHandler,
    buildNaverMapReviewOpenHandler,
    buildNaverMapReviewSuccessHandler,
    getNaverMapReviewRestaurant,
    shouldCloseNaverInternalPanelForExternalState,
    shouldCloseNaverInternalPanelOnEscape,
} from '../lib/naver-map-sidepanel-helpers';

describe('naver map sidepanel helpers', () => {
    test('creates restaurant-bound action only when callback and restaurant exist', () => {
        const calls: string[] = [];
        const restaurant = { id: 'r1', name: '식당', lat: '0', lng: '0' } as any;

        const action = buildNaverMapRestaurantAction((value) => calls.push(value.id), restaurant);
        action?.();

        expect(calls).toEqual(['r1']);
        expect(buildNaverMapRestaurantAction(undefined, restaurant)).toBeUndefined();
        expect(buildNaverMapRestaurantAction((value) => calls.push(value.id), null)).toBeUndefined();
    });

    test('builds review restaurant payload', () => {
        expect(getNaverMapReviewRestaurant({ id: 'r1', name: '식당' } as any)).toEqual({
            id: 'r1',
            name: '식당',
        });
        expect(getNaverMapReviewRestaurant(null)).toBeNull();
    });

    test('builds review success handler', () => {
        const calls: string[] = [];
        const handler = buildNaverMapReviewSuccessHandler({
            refetch: () => calls.push('refetch'),
            showMapToast: (message, type) => calls.push(`${type}:${message}`),
        });

        handler();

        expect(calls).toEqual([
            'refetch',
            'success:리뷰가 성공적으로 등록되었습니다!',
        ]);
    });

    test('builds internal panel close/toggle handlers', () => {
        const calls: boolean[] = [];
        buildNaverMapInternalPanelCloseHandler((value) => calls.push(value))();
        buildNaverMapInternalPanelToggleHandler({
            internalPanelOpen: true,
            setInternalPanelOpen: (value) => calls.push(value),
        })();

        expect(calls).toEqual([false, false]);
    });

    test('builds review open/close handlers', () => {
        const calls: boolean[] = [];
        buildNaverMapReviewOpenHandler((value) => calls.push(value))();
        buildNaverMapReviewCloseHandler((value) => calls.push(value))();

        expect(calls).toEqual([true, false]);
    });

    test('builds detail panel capture handlers', () => {
        const calls: string[] = [];
        const mouseHandler = buildNaverMapDetailPanelMouseDownCaptureHandler((panel) => calls.push(panel));
        const focusHandler = buildNaverMapDetailPanelFocusCaptureHandler((panel) => calls.push(panel));
        let stopped = false;

        mouseHandler({
            stopPropagation: () => {
                stopped = true;
            },
        } as any);
        focusHandler();

        expect(stopped).toBe(true);
        expect(calls).toEqual(['detail', 'detail']);
    });

    test('builds marker restaurant selection handler for internal and external modes', () => {
        const restaurant = { id: 'r1', name: '식당' } as any;
        const internalCalls: string[] = [];
        const externalCalls: string[] = [];
        const movedRef = { current: true };

        const internalHandler = buildNaverMarkerRestaurantSelectionHandler({
            hasUserMovedMapRef: movedRef,
            onRestaurantSelect: (value) => internalCalls.push(value.id),
            setInternalPanelOpen: (value) => internalCalls.push(`panel:${value}`),
        });
        internalHandler(restaurant);

        expect(movedRef.current).toBe(false);
        expect(internalCalls).toEqual(['r1', 'panel:true']);

        movedRef.current = true;
        const externalHandler = buildNaverMarkerRestaurantSelectionHandler({
            hasUserMovedMapRef: movedRef,
            onMarkerClick: (value) => externalCalls.push(value.id),
            onRestaurantSelect: (value) => externalCalls.push(`select:${value.id}`),
            setInternalPanelOpen: (value) => externalCalls.push(`panel:${value}`),
        });
        externalHandler(restaurant);

        expect(movedRef.current).toBe(false);
        expect(externalCalls).toEqual(['r1']);
    });

    test('decides when external state should close internal panel', () => {
        expect(shouldCloseNaverInternalPanelForExternalState(false)).toBe(true);
        expect(shouldCloseNaverInternalPanelForExternalState(true)).toBe(false);
        expect(shouldCloseNaverInternalPanelForExternalState(undefined)).toBe(false);
    });

    test('closes internal panel only for escape in non-grid open state', () => {
        expect(shouldCloseNaverInternalPanelOnEscape({
            key: 'Escape',
            internalPanelOpen: true,
            isGridMode: false,
        })).toBe(true);
        expect(shouldCloseNaverInternalPanelOnEscape({
            key: 'Enter',
            internalPanelOpen: true,
            isGridMode: false,
        })).toBe(false);
        expect(shouldCloseNaverInternalPanelOnEscape({
            key: 'Escape',
            internalPanelOpen: false,
            isGridMode: false,
        })).toBe(false);
        expect(shouldCloseNaverInternalPanelOnEscape({
            key: 'Escape',
            internalPanelOpen: true,
            isGridMode: true,
        })).toBe(false);
    });
});
