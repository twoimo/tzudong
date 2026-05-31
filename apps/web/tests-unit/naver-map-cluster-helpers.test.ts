import { describe, expect, test } from 'bun:test';

import {
    KOREA_CLUSTER_BBOX,
    getIndividualMarkerRevealZoom,
    getRegionalClusterTargetZoom,
    getSeoulDistrictTargetZoom,
    getSuperclusterTargetZoom,
    quantizeNaverClusterZoom,
    resolveNaverIslandClusterViewportByRegion,
    resolveNaverIslandClusterViewportForRestaurants,
    resolveNaverIslandFitBoundsOptions,
    resolveNaverClusterBoundsBbox,
    resolveNaverClusterUpdateBbox,
    shouldHideInSeoulDistrictMode,
} from '../lib/naver-map-cluster-helpers';

describe('naver map cluster helpers', () => {
    test('computes the first zoom where rendered and quantized cluster modes are disabled', () => {
        expect(getIndividualMarkerRevealZoom({ currentZoom: 8, clusterMaxZoom: 12 })).toBe(14);
        expect(getIndividualMarkerRevealZoom({ currentZoom: 8, clusterMaxZoom: 11 })).toBe(13);
        expect(getIndividualMarkerRevealZoom({ currentZoom: 14, clusterMaxZoom: 12 })).toBe(15);
        expect(getIndividualMarkerRevealZoom({ currentZoom: 18, clusterMaxZoom: 12 })).toBe(18);
    });

    test('computes regional cluster target zoom', () => {
        expect(getRegionalClusterTargetZoom(7, 12)).toBe(14);
        expect(getRegionalClusterTargetZoom(8, 12)).toBe(14);
    });

    test('computes seoul district target zoom', () => {
        expect(getSeoulDistrictTargetZoom(9, 12)).toBe(14);
        expect(getSeoulDistrictTargetZoom(11, 12)).toBe(14);
        expect(getSeoulDistrictTargetZoom(13, 12)).toBe(14);
    });

    test('computes supercluster target zoom beyond the cluster render ceiling', () => {
        expect(getSuperclusterTargetZoom(8, 7, 12)).toBe(14);
        expect(getSuperclusterTargetZoom(8, 12, 12)).toBe(14);
        expect(getSuperclusterTargetZoom(8, 15, 12)).toBe(15);
    });

    test('resolves island cluster viewport by region name or restaurant candidates', () => {
        expect(resolveNaverIslandClusterViewportByRegion('제주특별자치도')?.center).toEqual({
            lat: 33.3625,
            lng: 126.5339,
        });
        expect(resolveNaverIslandClusterViewportByRegion('경상북도 울릉도')?.maxZoom).toBe(12);
        expect(resolveNaverIslandClusterViewportByRegion('서울특별시')).toBeNull();

        expect(resolveNaverIslandClusterViewportForRestaurants([
            { road_address: '제주특별자치도 제주시 애월읍', lat: 33.45, lng: 126.31 },
            { road_address: '제주 서귀포시 성산읍', lat: 33.43, lng: 126.93 },
        ])?.maxZoom).toBe(10);
        expect(resolveNaverIslandClusterViewportForRestaurants([
            { road_address: '경상북도 울릉군 울릉읍', lat: 37.48, lng: 130.9 },
        ])?.maxZoom).toBe(12);
        expect(resolveNaverIslandClusterViewportForRestaurants([
            { road_address: '서울특별시 강남구', lat: 37.5, lng: 127.0 },
        ])).toBeNull();
    });

    test('builds fitBounds margins that leave room for mobile sheets and desktop panels', () => {
        expect(resolveNaverIslandFitBoundsOptions({
            isMobileOrTablet: true,
            maxZoom: 10,
            viewportOffset: 0,
        })).toEqual({
            top: 80,
            right: 48,
            bottom: 168,
            left: 48,
            maxZoom: 10,
        });

        expect(resolveNaverIslandFitBoundsOptions({
            isMobileOrTablet: false,
            maxZoom: 12,
            viewportOffset: 360.2,
        })).toEqual({
            top: 72,
            right: 72,
            bottom: 72,
            left: 433,
            maxZoom: 12,
        });
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
