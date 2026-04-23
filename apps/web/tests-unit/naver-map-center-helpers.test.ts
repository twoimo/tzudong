import { describe, expect, test } from 'bun:test';

import { calculateNaverAdjustedCenter } from '../lib/naver-map-center-helpers';

class FakeLatLng {
    constructor(private readonly _lat: number, private readonly _lng: number) {}
    lat() { return this._lat; }
    lng() { return this._lng; }
}

class FakePoint {
    constructor(public readonly x: number, public readonly y: number) {}
}

describe('naver map center helpers', () => {
    test('applies horizontal offset scaled by zoom delta', () => {
        const result = calculateNaverAdjustedCenter({
            centerLat: 10,
            centerLng: 20,
            currentZoom: 12,
            targetZoom: 10,
            offsetX: 40,
            projection: {
                fromCoordToOffset: (coord) => new FakePoint(coord.lng() * 10, coord.lat() * 10),
                fromOffsetToCoord: (point) => new FakeLatLng(point.y / 10, point.x / 10),
            },
            createLatLng: (lat, lng) => new FakeLatLng(lat, lng),
            createPoint: (x, y) => new FakePoint(x, y),
        });

        expect(result.lat()).toBe(10);
        expect(result.lng()).toBe(36);
    });

    test('applies vertical offset and preserves target center when no zoom delta', () => {
        const result = calculateNaverAdjustedCenter({
            centerLat: 5,
            centerLng: 7,
            currentZoom: 8,
            targetZoom: 8,
            offsetX: 0,
            offsetY: 30,
            projection: {
                fromCoordToOffset: (coord) => new FakePoint(coord.lng() * 5, coord.lat() * 5),
                fromOffsetToCoord: (point) => new FakeLatLng(point.y / 5, point.x / 5),
            },
            createLatLng: (lat, lng) => new FakeLatLng(lat, lng),
            createPoint: (x, y) => new FakePoint(x, y),
        });

        expect(result.lat()).toBe(11);
        expect(result.lng()).toBe(7);
    });
});
