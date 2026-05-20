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
    applyNaverImmediateMarkerCenter,
    resolveNaverMarkerClickImmediateCenterPlan,
    shouldSkipNaverDeferredCenterAfterImmediateMarkerClick,
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
        const centerCalls: string[] = [];
        const movedRef = { current: true };

        const internalHandler = buildNaverMarkerRestaurantSelectionHandler({
            centerMarkerImmediately: (value) => centerCalls.push(`center:${value.id}`),
            hasUserMovedMapRef: movedRef,
            onRestaurantSelect: (value) => internalCalls.push(value.id),
            setInternalPanelOpen: (value) => internalCalls.push(`panel:${value}`),
        });
        internalHandler(restaurant);

        expect(movedRef.current).toBe(false);
        expect(centerCalls).toEqual(['center:r1']);
        expect(internalCalls).toEqual(['r1', 'panel:true']);

        movedRef.current = true;
        centerCalls.length = 0;
        const externalHandler = buildNaverMarkerRestaurantSelectionHandler({
            centerMarkerImmediately: (value) => externalCalls.push(`center:${value.id}`),
            hasUserMovedMapRef: movedRef,
            onMarkerClick: (value) => externalCalls.push(value.id),
            onRestaurantSelect: (value) => externalCalls.push(`select:${value.id}`),
            setInternalPanelOpen: (value) => externalCalls.push(`panel:${value}`),
        });
        externalHandler(restaurant);

        expect(movedRef.current).toBe(false);
        expect(centerCalls).toEqual([]);
        expect(externalCalls).toEqual(['center:r1', 'r1']);
    });

    test('plans immediate marker centering before React panel state catches up', () => {
        const restaurant = { id: 'r1', lat: 37.5, lng: 127.1 } as any;

        expect(resolveNaverMarkerClickImmediateCenterPlan({
            currentZoom: 11,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            mapFocusZoom: 15,
            mobileVerticalOffset: 0,
            panelWidth: 420,
            restaurant,
            usesExternalPanel: true,
        })).toEqual({
            skip: false,
            restaurantId: 'r1',
            targetLat: 37.5,
            targetLng: 127.1,
            targetZoom: 15,
            targetOffsetX: 210,
            targetOffsetY: 0,
        });

        expect(resolveNaverMarkerClickImmediateCenterPlan({
            currentZoom: 11,
            isGridMode: true,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            mapFocusZoom: null,
            mobileVerticalOffset: 0,
            panelWidth: 420,
            restaurant,
            usesExternalPanel: true,
        })).toEqual({ skip: true });

        expect(resolveNaverMarkerClickImmediateCenterPlan({
            currentZoom: 11,
            isGridMode: false,
            isMobileOrTablet: true,
            isPanelCollapsed: false,
            mapFocusZoom: null,
            mobileVerticalOffset: 96,
            panelWidth: 420,
            restaurant,
            usesExternalPanel: true,
        })).toEqual({
            skip: false,
            restaurantId: 'r1',
            targetLat: 37.5,
            targetLng: 127.1,
            targetZoom: 11,
            targetOffsetX: 0,
            targetOffsetY: 96,
        });
    });

    test('applies immediate marker centering through a single map mutation transaction', () => {
        const calls: string[] = [];
        const plan = resolveNaverMarkerClickImmediateCenterPlan({
            currentZoom: 11,
            isGridMode: false,
            isMobileOrTablet: false,
            isPanelCollapsed: false,
            mapFocusZoom: 15,
            mobileVerticalOffset: 0,
            panelWidth: 420,
            restaurant: { id: 'r1', lat: 37.5, lng: 127.1 } as any,
            usesExternalPanel: true,
        });

        const result = applyNaverImmediateMarkerCenter({
            currentZoom: 11,
            getAdjustedCenter: (...args) => {
                calls.push(`adjust:${args.join(',')}`);
                return { center: true };
            },
            map: {
                setCenter: (center) => calls.push(`center:${JSON.stringify(center)}`),
                setZoom: (zoom) => calls.push(`zoom:${zoom}`),
            },
            now: 123,
            plan,
        });

        expect(calls).toEqual([
            'adjust:37.5,127.1,15,210,0',
            'zoom:15',
            'center:{"center":true}',
        ]);
        expect(result).toEqual({
            applied: true,
            markerCenter: {
                restaurantId: 'r1',
                targetLat: 37.5,
                targetLng: 127.1,
                targetZoom: 15,
                targetOffsetX: 210,
                targetOffsetY: 0,
                centeredAt: 123,
            },
        });
    });

    test('skips deferred recenter only when immediate marker center already matches target layout', () => {
        const centeredAt = Date.now();

        expect(shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
            centeredAt,
            immediateOffsetX: 210,
            immediateOffsetY: 0,
            immediateTargetLat: 37.5,
            immediateTargetLng: 127.1,
            immediateZoom: 15,
            restaurantId: 'r1',
            selectedRestaurantId: 'r1',
            targetLat: 37.5,
            targetLng: 127.1,
            targetOffsetX: 210,
            targetOffsetY: 0,
            targetZoom: 15,
        })).toBe(true);

        expect(shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
            centeredAt,
            immediateOffsetX: 0,
            immediateOffsetY: 0,
            immediateTargetLat: 37.5,
            immediateTargetLng: 127.1,
            immediateZoom: 15,
            restaurantId: 'r1',
            selectedRestaurantId: 'r1',
            targetLat: 37.5,
            targetLng: 127.1,
            targetOffsetX: 210,
            targetOffsetY: 0,
            targetZoom: 15,
        })).toBe(false);

        expect(shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
            centeredAt: centeredAt - 1200,
            immediateOffsetX: 210,
            immediateOffsetY: 0,
            immediateTargetLat: 37.5,
            immediateTargetLng: 127.1,
            immediateZoom: 15,
            restaurantId: 'r1',
            selectedRestaurantId: 'r1',
            targetLat: 37.5,
            targetLng: 127.1,
            targetOffsetX: 210,
            targetOffsetY: 0,
            targetZoom: 15,
        })).toBe(false);

        expect(shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
            centeredAt,
            immediateOffsetX: 210,
            immediateOffsetY: 0,
            immediateTargetLat: 37.5,
            immediateTargetLng: 127.1,
            immediateZoom: 15,
            restaurantId: 'r1',
            selectedRestaurantId: 'r1',
            targetLat: 37.50001,
            targetLng: 127.1,
            targetOffsetX: 210,
            targetOffsetY: 0,
            targetZoom: 15,
        })).toBe(false);
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
