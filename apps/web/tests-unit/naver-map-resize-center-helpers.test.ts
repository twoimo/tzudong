import { describe, expect, test } from 'bun:test';

import { resolveNaverResizeCenter } from '../lib/naver-map-resize-center-helpers';

describe('naver map resize center helpers', () => {
    test('prefers explicit target coordinates', () => {
        const calls: unknown[][] = [];
        const result = resolveNaverResizeCenter({
            currentCenter: {
                lat: () => 1,
                lng: () => 2,
            },
            currentZoom: 12,
            getAdjustedCenter: (...args) => {
                calls.push(args);
                return { ok: true };
            },
            targetLat: 37.5,
            targetLng: 127.1,
            targetOffsetX: 200,
            targetOffsetY: 40,
        });

        expect(result).toEqual({ ok: true });
        expect(calls).toEqual([[37.5, 127.1, 12, 200, 40]]);
    });

    test('falls back to current center when target coordinates are absent', () => {
        const calls: unknown[][] = [];
        resolveNaverResizeCenter({
            currentCenter: {
                lat: () => 10,
                lng: () => 20,
            },
            currentZoom: 8,
            getAdjustedCenter: (...args) => {
                calls.push(args);
                return null;
            },
            targetOffsetX: 0,
            targetOffsetY: 0,
        });

        expect(calls).toEqual([[10, 20, 8, 0, 0]]);
    });
});
