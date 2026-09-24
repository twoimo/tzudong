import { describe, expect, test } from 'bun:test';

import {
    buildNaverOverlappingMarkerKey,
    buildNaverOverlappingMarkerOffsets,
    resolveNaverOverlappingMarkerPosition,
    reuseMarkerLatLng,
    reuseMarkerAnchor,
    reuseProjectedLatLng,
} from '../lib/naver-map-overlap-helpers';

describe('naver map overlap helpers', () => {
    test('groups markers by quantized coordinates', () => {
        expect(buildNaverOverlappingMarkerKey(37.1234564, 127.1234564)).toBe('37.123456:127.123456');
        expect(buildNaverOverlappingMarkerKey(null, 127.1234564)).toBeNull();
        expect(buildNaverOverlappingMarkerKey(Number.NaN, 127.1234564)).toBeNull();
    });

    test('assigns deterministic pixel offsets only to overlapping coordinates', () => {
        const offsets = buildNaverOverlappingMarkerOffsets([
            { id: 'b', lat: 37.5, lng: 127.0 },
            { id: 'solo', lat: 37.6, lng: 127.1 },
            { id: 'a', lat: 37.5, lng: 127.0 },
        ]);

        expect(offsets.has('solo')).toBe(false);
        expect(offsets.get('a')).toMatchObject({ count: 2, index: 0, x: -9, y: 0 });
        expect(offsets.get('b')).toMatchObject({ count: 2, index: 1, x: 9, y: 0 });
    });

    test('spreads three or more overlapping markers around the base point', () => {
        const offsets = buildNaverOverlappingMarkerOffsets([
            { id: 'c', lat: 37.5, lng: 127.0 },
            { id: 'b', lat: 37.5, lng: 127.0 },
            { id: 'a', lat: 37.5, lng: 127.0 },
        ]);

        expect(offsets.get('a')).toMatchObject({ count: 3, index: 0, x: 0, y: -18 });
        expect(offsets.get('b')?.x).not.toBe(0);
        expect(offsets.get('c')?.x).not.toBe(0);
    });

    test('projects overlapping marker offset through the map projection', () => {
        const shifted = resolveNaverOverlappingMarkerPosition({
            basePosition: { x: 100, y: 200 },
            createPoint: (x, y) => ({ x, y }),
            offset: { count: 2, index: 1, x: 9, y: 0 },
            projection: {
                fromCoordToOffset: (coord) => coord as { x: number; y: number },
                fromOffsetToCoord: (offset) => offset,
            },
        });

        expect(shifted).toEqual({ x: 109, y: 200 });
    });

    test('keeps the base position for non-overlapping markers or projection errors', () => {
        const basePosition = { x: 100, y: 200 };
        expect(resolveNaverOverlappingMarkerPosition({
            basePosition,
            createPoint: (x, y) => ({ x, y }),
            offset: undefined,
            projection: null,
        })).toBe(basePosition);

        expect(resolveNaverOverlappingMarkerPosition({
            basePosition,
            createPoint: (x, y) => ({ x, y }),
            offset: { count: 2, index: 1, x: 9, y: 0 },
            projection: {
                fromCoordToOffset: () => {
                    throw new Error('projection unavailable');
                },
                fromOffsetToCoord: (offset) => offset,
            },
        })).toBe(basePosition);
    });

    test('reuses a marker position when latitude and longitude are unchanged', () => {
        const current = { lat: () => 37.5, lng: () => 127.1 };
        expect(reuseMarkerLatLng(current, 37.5, 127.1, () => ({ created: true }))).toBe(current);
        expect(reuseMarkerLatLng(current, 37.6, 127.1, () => ({ created: true }))).toEqual({ created: true });
        expect(reuseMarkerLatLng(null, 37.5, 127.1, () => ({ created: true }))).toEqual({ created: true });
        const anchor = { x: 16, y: 32 };
        expect(reuseMarkerAnchor(anchor, 16, 32, () => ({ created: true }))).toBe(anchor);
        expect(reuseMarkerAnchor(anchor, 16, 30, () => ({ created: true }))).toEqual({ created: true });
    });

    test('reuses a projected coordinate for the same restaurant and position', () => {
        const restaurant = { id: 'a' };
        let created = 0;
        const first = reuseProjectedLatLng(restaurant, 37.5, 127.1, () => {
            created += 1;
            return { id: created };
        });
        const second = reuseProjectedLatLng(restaurant, 37.5, 127.1, () => {
            created += 1;
            return { id: created };
        });
        const moved = reuseProjectedLatLng(restaurant, 37.6, 127.1, () => {
            created += 1;
            return { id: created };
        });

        expect(second).toBe(first);
        expect(moved).not.toBe(first);
        expect(created).toBe(2);
    });
});
