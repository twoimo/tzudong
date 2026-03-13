import { describe, expect, test } from 'bun:test';

import {
    buildMarkerRenderSignature,
    shouldSkipMarkerUpdate,
    type MarkerRenderSignature,
} from '../lib/map-render-guard';

describe('naver map marker render guard', () => {
    const makeBaseSignature = (): MarkerRenderSignature =>
        buildMarkerRenderSignature({
            zoom: 12,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-1', 'r-2'],
            selectedRestaurantId: 'r-1',
            searchedRestaurantId: null,
            isClusterMode: true,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

    test('skips marker render when effective signature is unchanged', () => {
        const previous = makeBaseSignature();
        const next = buildMarkerRenderSignature({
            zoom: 12,
            bounds: {
                south: 37.45694,
                west: 127.03446,
                north: 37.46691,
                east: 127.06448,
            },
            displayRestaurantIds: ['r-2', 'r-1'],
            selectedRestaurantId: 'r-1',
            searchedRestaurantId: null,
            isClusterMode: true,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(true);
    });

    test('does not skip marker render when selected marker changes', () => {
        const previous = makeBaseSignature();
        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-2', 'r-1'],
            selectedRestaurantId: 'r-2',
            searchedRestaurantId: previous.searchedRestaurantId,
            isRegionalClusterMode: true,
            isClusterMode: true,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('does not skip marker render when viewport or mode changes', () => {
        const previous = makeBaseSignature();

        const nextViewportChanged = buildMarkerRenderSignature({
            zoom: 11,
            bounds: {
                south: 37.5,
                west: 127.0,
                north: 37.9,
                east: 127.9,
            },
            displayRestaurantIds: ['r-1', 'r-2'],
            selectedRestaurantId: 'r-1',
            searchedRestaurantId: null,
            isClusterMode: true,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const nextModeChanged = buildMarkerRenderSignature({
            zoom: 12,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-1', 'r-2'],
            selectedRestaurantId: 'r-1',
            searchedRestaurantId: null,
            isClusterMode: true,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: true,
        });

        expect(shouldSkipMarkerUpdate(previous, nextViewportChanged)).toBe(false);
        expect(shouldSkipMarkerUpdate(previous, nextModeChanged)).toBe(false);
    });
});
