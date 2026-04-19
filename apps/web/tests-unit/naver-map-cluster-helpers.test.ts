import { describe, expect, test } from 'bun:test';

import {
    getRegionalClusterTargetZoom,
    getSeoulDistrictTargetZoom,
    getSuperclusterTargetZoom,
    shouldHideInSeoulDistrictMode,
} from '../lib/naver-map-cluster-helpers';

describe('naver map cluster helpers', () => {
    test('computes regional cluster target zoom', () => {
        expect(getRegionalClusterTargetZoom(7)).toBe(9);
        expect(getRegionalClusterTargetZoom(8)).toBe(9);
    });

    test('computes seoul district target zoom', () => {
        expect(getSeoulDistrictTargetZoom(9)).toBe(11);
        expect(getSeoulDistrictTargetZoom(11)).toBe(13);
        expect(getSeoulDistrictTargetZoom(13)).toBe(13);
    });

    test('computes supercluster target zoom with lower bound', () => {
        expect(getSuperclusterTargetZoom(8, 7)).toBe(10);
        expect(getSuperclusterTargetZoom(8, 12)).toBe(12);
    });

    test('hides only seoul features in seoul district mode', () => {
        expect(shouldHideInSeoulDistrictMode({
            address: '서울 강남구',
            isPointInSeoul: false,
            shouldUseSeoulDistrictCluster: true,
        })).toBe(true);

        expect(shouldHideInSeoulDistrictMode({
            address: '경기 고양시',
            isPointInSeoul: true,
            shouldUseSeoulDistrictCluster: true,
        })).toBe(false);

        expect(shouldHideInSeoulDistrictMode({
            address: null,
            isPointInSeoul: true,
            shouldUseSeoulDistrictCluster: true,
        })).toBe(true);
    });
});
