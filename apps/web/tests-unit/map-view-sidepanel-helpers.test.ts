import { describe, expect, test } from 'bun:test';

import {
    buildMapViewDetailPanelFocusCaptureHandler,
    buildMapViewDetailPanelMouseDownCaptureHandler,
    buildMapViewReviewCloseHandler,
    buildMapViewReviewSuccessHandler,
    shouldShowMapViewDetailPanel,
    shouldShowMapViewReviewModal,
} from '../lib/map-view-sidepanel-helpers';

describe('map view sidepanel helpers', () => {
    test('closes review modal through setter', () => {
        const calls: boolean[] = [];
        const close = buildMapViewReviewCloseHandler((value) => calls.push(value));

        close();

        expect(calls).toEqual([false]);
    });

    test('shows detail panel only for local panel mode with selected restaurant', () => {
        const restaurant = { id: 'r1', name: '식당' } as any;

        expect(shouldShowMapViewDetailPanel({ selectedRestaurant: restaurant })).toBe(true);
        expect(shouldShowMapViewDetailPanel({ onMarkerClick: () => {}, selectedRestaurant: restaurant })).toBe(false);
        expect(shouldShowMapViewDetailPanel({ selectedRestaurant: null })).toBe(false);
    });

    test('shows review modal only when open and restaurant exists', () => {
        const restaurant = { id: 'r1', name: '식당' } as any;

        expect(shouldShowMapViewReviewModal({ isReviewModalOpen: true, selectedRestaurant: restaurant })).toBe(true);
        expect(shouldShowMapViewReviewModal({ isReviewModalOpen: false, selectedRestaurant: restaurant })).toBe(false);
        expect(shouldShowMapViewReviewModal({ isReviewModalOpen: true, selectedRestaurant: null })).toBe(false);
    });

    test('builds detail panel capture handlers', () => {
        const calls: string[] = [];
        const mouseHandler = buildMapViewDetailPanelMouseDownCaptureHandler((panel) => calls.push(panel));
        const focusHandler = buildMapViewDetailPanelFocusCaptureHandler((panel) => calls.push(panel));
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

    test('builds review success handler', () => {
        const calls: string[] = [];
        const success = buildMapViewReviewSuccessHandler(() => calls.push('refetch'));

        success();

        expect(calls).toEqual(['refetch']);
    });
});
