import { describe, expect, test } from 'bun:test';

import { resolveNaverResizeTarget } from '../lib/naver-map-resize-target-helpers';

describe('naver map resize target helpers', () => {
    test('prefers selected restaurant coordinates', () => {
        const result = resolveNaverResizeTarget({
            selectedRegion: '서울',
            selectedRestaurant: { lat: 37.5, lng: 127.1 } as any,
            urlLat: Number.NaN,
            urlLng: Number.NaN,
            urlZoom: Number.NaN,
        });

        expect(result).toEqual({
            skip: false,
            targetLat: 37.5,
            targetLng: 127.1,
        });
    });

    test('skips resize target movement when url coordinates are present', () => {
        expect(resolveNaverResizeTarget({
            selectedRegion: null,
            selectedRestaurant: null,
            urlLat: 37.5,
            urlLng: 127.1,
            urlZoom: 10,
        })).toEqual({ skip: true });
    });

    test('falls back to selected region or national config', () => {
        const result = resolveNaverResizeTarget({
            selectedRegion: '서울',
            selectedRestaurant: null,
            urlLat: Number.NaN,
            urlLng: Number.NaN,
            urlZoom: Number.NaN,
        });

        expect(result.skip).toBe(false);
        expect(result.targetLat).toBeTypeOf('number');
        expect(result.targetLng).toBeTypeOf('number');
    });
});
