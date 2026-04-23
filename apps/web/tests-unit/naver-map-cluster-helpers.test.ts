import { describe, expect, test } from 'bun:test';

import {
    KOREA_CLUSTER_BBOX,
    getRegionalClusterTargetZoom,
    getSeoulDistrictTargetZoom,
    getSuperclusterTargetZoom,
    quantizeNaverClusterZoom,
    resolveNaverClusterBoundsBbox,
    resolveNaverClusterUpdateBbox,
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

    test('quantizes supercluster zoom buckets in two-level steps', () => {
        expect(quantizeNaverClusterZoom(7)).toBe(6);
        expect(quantizeNaverClusterZoom(8)).toBe(8);
        expect(quantizeNaverClusterZoom(9.8)).toBe(8);
        expect(quantizeNaverClusterZoom(10)).toBe(10);
    });

    test('resolves bounds bbox or Korea fallback bbox for initial cluster load', () => {
        const bounds = {
            getWest: () => 126,
            getSouth: () => 36,
            getEast: () => 128,
            getNorth: () => 38,
        };

        expect(resolveNaverClusterBoundsBbox(bounds)).toEqual([126, 36, 128, 38]);
        expect(resolveNaverClusterBoundsBbox(null)).toEqual(KOREA_CLUSTER_BBOX);
        expect(resolveNaverClusterBoundsBbox(undefined, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    });

    test('resolves update bbox from bounds before center fallback', () => {
        const plan = resolveNaverClusterUpdateBbox({
            bounds: {
                getWest: () => 126,
                getSouth: () => 36,
                getEast: () => 128,
                getNorth: () => 38,
            },
            center: null,
            zoom: 10,
        });

        expect(plan).toEqual({
            bbox: [126, 36, 128, 38],
            shouldSkip: false,
            shouldWarnMissingCenter: false,
        });
    });

    test('resolves update bbox from center when map bounds are unavailable', () => {
        const plan = resolveNaverClusterUpdateBbox({
            bounds: null,
            center: {
                lat: () => 37,
                lng: () => 127,
            },
            mapHeightPixels: 800,
            mapWidthPixels: 1000,
            zoom: 10,
        });

        expect(plan.shouldSkip).toBe(false);
        expect(plan.shouldWarnMissingCenter).toBe(false);
        expect(plan.bbox?.[0]).toBeLessThan(127);
        expect(plan.bbox?.[1]).toBeLessThan(37);
        expect(plan.bbox?.[2]).toBeGreaterThan(127);
        expect(plan.bbox?.[3]).toBeGreaterThan(37);
    });

    test('skips cluster update when both bounds and center are unavailable', () => {
        expect(resolveNaverClusterUpdateBbox({
            bounds: null,
            center: null,
            zoom: 10,
        })).toEqual({
            bbox: null,
            shouldSkip: true,
            shouldWarnMissingCenter: true,
        });
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
