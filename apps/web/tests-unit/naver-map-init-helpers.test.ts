import { describe, expect, test } from 'bun:test';

import {
    getDeviceAdjustedZoom,
    parseNaverMapUrlState,
    resolveNaverRegionConfig,
} from '../lib/naver-map-init-helpers';

describe('naver map init helpers', () => {
    test('adjusts zoom for mobile but not for national view', () => {
        expect(getDeviceAdjustedZoom(12, true, false)).toBe(10);
        expect(getDeviceAdjustedZoom(7, true, false)).toBe(6);
        expect(getDeviceAdjustedZoom(8, true, true)).toBe(8);
    });

    test('parses z and legacy c url zoom state', () => {
        expect(parseNaverMapUrlState('?z=12&lat=37.5&lng=127.0')).toMatchObject({
            hasValidUrlState: true,
            urlZoom: 12,
            urlLat: 37.5,
            urlLng: 127,
        });
        expect(parseNaverMapUrlState('?c=9,rest&lat=37.6&lng=126.9').urlZoom).toBe(9);
        expect(parseNaverMapUrlState('?z=bad').hasValidUrlState).toBe(false);
    });

    test('resolves region config and national flag', () => {
        expect(resolveNaverRegionConfig(null).isNational).toBe(true);
        expect(resolveNaverRegionConfig('서울특별시' as any).isNational).toBe(false);
    });
});
