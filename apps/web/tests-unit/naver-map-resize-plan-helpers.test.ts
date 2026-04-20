import { describe, expect, test } from 'bun:test';

import { resolveNaverResizePlan } from '../lib/naver-map-resize-plan-helpers';

describe('naver map resize plan helpers', () => {
    test('skips when grid mode or user movement blocks recenter', () => {
        expect(resolveNaverResizePlan({
            currentCenter: { lat: () => 1, lng: () => 2 },
            currentZoom: 10,
            effectivePanelOffset: 400,
            getAdjustedCenter: () => ({ ok: true }),
            hasUserMoved: true,
            isGridMode: false,
            isMobileOrTablet: false,
            mobileVerticalOffset: 0,
            selectedRegion: null,
            selectedRestaurant: null,
            urlLat: Number.NaN,
            urlLng: Number.NaN,
            urlZoom: Number.NaN,
        })).toEqual({ skip: true });
    });

    test('skips when resize target says to keep current url-driven state', () => {
        expect(resolveNaverResizePlan({
            currentCenter: { lat: () => 1, lng: () => 2 },
            currentZoom: 10,
            effectivePanelOffset: 400,
            getAdjustedCenter: () => ({ ok: true }),
            hasUserMoved: false,
            isGridMode: false,
            isMobileOrTablet: false,
            mobileVerticalOffset: 0,
            selectedRegion: null,
            selectedRestaurant: null,
            urlLat: 37.5,
            urlLng: 127.1,
            urlZoom: 10,
        })).toEqual({ skip: true });
    });

    test('returns computed center when recentering should proceed', () => {
        const calls: unknown[][] = [];
        const result = resolveNaverResizePlan({
            currentCenter: { lat: () => 10, lng: () => 20 },
            currentZoom: 12,
            effectivePanelOffset: 400,
            getAdjustedCenter: (...args) => {
                calls.push(args);
                return { ok: true };
            },
            hasUserMoved: false,
            isGridMode: false,
            isMobileOrTablet: false,
            mobileVerticalOffset: 0,
            selectedRegion: '서울',
            selectedRestaurant: null,
            urlLat: Number.NaN,
            urlLng: Number.NaN,
            urlZoom: Number.NaN,
        });

        expect(result).toEqual({
            skip: false,
            newCenterLatLng: { ok: true },
        });
        expect(calls).toHaveLength(1);
    });
});
