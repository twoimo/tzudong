import { describe, expect, test } from 'bun:test';

import { resolveNaverMapTarget } from '../lib/naver-map-target-helpers';

describe('naver map target helpers', () => {
    test('prefers selected restaurant target and optional focus zoom', () => {
        const restaurant = { lat: 37.5, lng: 127.1 } as any;
        const result = resolveNaverMapTarget({
            currentMapZoom: 11,
            getDeviceAdjustedZoom: (zoom) => zoom,
            mapFocusZoom: 15,
            selectedRegion: '서울',
            selectedRestaurant: restaurant,
            urlLat: Number.NaN,
            urlLng: Number.NaN,
            urlZoom: Number.NaN,
        });

        expect(result).toEqual({
            skip: false,
            targetLat: 37.5,
            targetLng: 127.1,
            targetZoom: 15,
        });
    });

    test('skips movement when url coordinates are present and no restaurant is selected', () => {
        const result = resolveNaverMapTarget({
            currentMapZoom: 11,
            getDeviceAdjustedZoom: (zoom) => zoom,
            mapFocusZoom: null,
            selectedRegion: null,
            selectedRestaurant: null,
            urlLat: 37.5,
            urlLng: 127.1,
            urlZoom: 10,
        });

        expect(result).toEqual({ skip: true });
    });

    test('falls back to selected region or national config', () => {
        const zoomCalls: Array<[number, boolean | undefined]> = [];
        const result = resolveNaverMapTarget({
            currentMapZoom: 11,
            getDeviceAdjustedZoom: (zoom, isNational) => {
                zoomCalls.push([zoom, isNational]);
                return zoom - 1;
            },
            mapFocusZoom: null,
            selectedRegion: '서울',
            selectedRestaurant: null,
            urlLat: Number.NaN,
            urlLng: Number.NaN,
            urlZoom: Number.NaN,
        });

        expect(result.skip).toBe(false);
        expect(result.targetLat).toBeTypeOf('number');
        expect(result.targetLng).toBeTypeOf('number');
        expect(result.targetZoom).toBeTypeOf('number');
        expect(zoomCalls).toHaveLength(1);
        expect(typeof zoomCalls[0][1]).toBe('boolean');
    });
});
