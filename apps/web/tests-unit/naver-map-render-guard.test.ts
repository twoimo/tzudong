import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

    test('does not skip marker render when marker kind, asset version, or user toggle changes', () => {
        const previous = buildMarkerRenderSignature({
            zoom: 12,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-1'],
            selectedRestaurantId: null,
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
            markerKindEntries: [{ id: 'r-1', kind: 'category', assetVersion: 'assets-v1' }],
            markerLayerVersion: 'assets-v1',
            showUserSubmittedMarkers: true,
        });

        const nextKindChanged = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-1'],
            selectedRestaurantId: null,
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
            markerKindEntries: [{ id: 'r-1', kind: 'user-submitted', assetVersion: 'assets-v1' }],
            markerLayerVersion: 'assets-v1',
            showUserSubmittedMarkers: true,
        });

        const nextAssetChanged = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-1'],
            selectedRestaurantId: null,
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
            markerKindEntries: [{ id: 'r-1', kind: 'category', assetVersion: 'assets-v2' }],
            markerLayerVersion: 'assets-v2',
            showUserSubmittedMarkers: true,
        });

        const nextToggleChanged = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: {
                south: 37.4569,
                west: 127.0345,
                north: 37.4669,
                east: 127.0645,
            },
            displayRestaurantIds: ['r-1'],
            selectedRestaurantId: null,
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
            markerKindEntries: [{ id: 'r-1', kind: 'category', assetVersion: 'assets-v1' }],
            markerLayerVersion: 'assets-v1',
            showUserSubmittedMarkers: false,
        });

        expect(shouldSkipMarkerUpdate(previous, nextKindChanged)).toBe(false);
        expect(shouldSkipMarkerUpdate(previous, nextAssetChanged)).toBe(false);
        expect(shouldSkipMarkerUpdate(previous, nextToggleChanged)).toBe(false);
    });

    test('keeps an empty desktop marker render from poisoning the render signature', () => {
        const source = readFileSync(join(process.cwd(), 'components/map/NaverMapView.tsx'), 'utf8');

        expect(source).toContain('MARKER_RENDER_EMPTY_RETRY_LIMIT');
        expect(source).toContain('CLUSTER_INDEX_IDLE_TIMEOUT_MS');
        expect(source).toContain("window.requestIdleCallback(callback, { timeout: CLUSTER_INDEX_IDLE_TIMEOUT_MS })");
        expect(source).toContain('markerRenderSignatureRef.current = null;');
        expect(source).toContain('setMarkerRenderRetryTick((tick) => tick + 1)');
        expect(source).toContain("document.querySelector('.cluster-marker-container')");
        expect(source).toContain('activeIds.size === 0 && displayRestaurants.length > 0');
        expect(source).toContain('markerRenderRetryTick');
    });
});
