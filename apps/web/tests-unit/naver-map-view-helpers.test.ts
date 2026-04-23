import { describe, expect, test } from 'bun:test';

import {
    getExtendedBounds,
    getPrimaryCategory,
    isPointInSeoul,
    isRestaurantInViewport,
} from '../lib/naver-map-view-helpers';

describe('naver map view helpers', () => {
    test('expands map bounds by the requested padding', () => {
        const map = {
            getBounds: () => ({
                getSW: () => ({ lat: () => 37, lng: () => 126 }),
                getNE: () => ({ lat: () => 38, lng: () => 127 }),
            }),
        };

        expect(getExtendedBounds(map, 0.1)).toEqual({
            south: 36.9,
            north: 38.1,
            west: 125.9,
            east: 127.1,
        });
    });

    test('detects restaurants inside the expanded viewport', () => {
        const bounds = { south: 37, north: 38, west: 126, east: 127 };

        expect(isRestaurantInViewport({ lat: 37.5, lng: 126.5 }, bounds)).toBe(true);
        expect(isRestaurantInViewport({ lat: 38.5, lng: 126.5 }, bounds)).toBe(false);
    });

    test('returns the first available category', () => {
        expect(getPrimaryCategory({ categories: ['한식'], category: [] })).toBe('한식');
        expect(getPrimaryCategory({ categories: [], category: ['중식'] })).toBe('중식');
        expect(getPrimaryCategory({ categories: [], category: [] })).toBe('기타');
    });

    test('keeps only Seoul-proximate coordinates inside Seoul bounds', () => {
        expect(isPointInSeoul(37.5665, 126.9780)).toBe(true);
        expect(isPointInSeoul(37.6584, 126.8320)).toBe(false);
    });
});
