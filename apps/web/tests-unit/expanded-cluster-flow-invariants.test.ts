import { describe, expect, test } from 'bun:test';
import { Transpiler } from 'bun';
import { readFileSync } from 'node:fs';

import type { Restaurant } from '../types/restaurant';
import {
    buildRenderTargetIdsForSignature,
    getVisibleRestaurantsForRender,
    resolveEmptyClusterMarkerCleanupPlan,
    shouldRenderExpandedClusterMarker,
} from '../lib/naver-map-render-plan';
import {
    buildMarkerRenderSignature,
    shouldSkipMarkerUpdate,
} from '../lib/map-render-guard';
import { fillExtendedBounds, getExtendedBounds } from '../lib/naver-map-view-helpers';

const rendererSource = readFileSync(
    new URL('../components/map/NaverMapView.tsx', import.meta.url),
    'utf8',
);

// Execute the production callbacks without loading the map component's network
// dependencies. This exercises the render -> idle ordering, not a second copy
// of the viewport invalidation implementation.
function runRendererSource<T>(source: string, bindings: Record<string, unknown>): T {
    const compiled = new Transpiler({ loader: 'tsx' }).transformSync(`function run() { ${source} }`);
    return new Function(...Object.keys(bindings), `${compiled}\nreturn run();`)(...Object.values(bindings)) as T;
}

const viewportHelperStart = rendererSource.indexOf('function getNaverMarkerViewportKey(');
const viewportHelperEnd = rendererSource.indexOf('\ntype NaverQueryBounds', viewportHelperStart);
const getViewportKey = runRendererSource<(map: unknown, element: unknown) => string>(
    `${rendererSource.slice(viewportHelperStart, viewportHelperEnd)}\nreturn getNaverMarkerViewportKey;`,
    { fillExtendedBounds },
);

const viewport = {
    south: 37.49,
    north: 37.53,
    west: 126.94,
    east: 126.99,
};

const makeRestaurants = (count = 735): Restaurant[] => Array.from({ length: count }, (_, index) => ({
    id: `restaurant-${index}`,
    name: `실험맛집${String(index).padStart(4, '0')}`,
    approved_name: `실험맛집${String(index).padStart(4, '0')}`,
    lat: 37.5 + (index % 40) * 0.003,
    lng: 126.96 + Math.floor(index / 40) * 0.003,
    road_address: `서울특별시 중구 실험로 ${index + 1}`,
    categories: [index % 2 ? '한식' : '분식'],
    category: [index % 2 ? '한식' : '분식'],
    review_count: 0,
    weekly_search_count: count - index,
    status: 'approved',
} as Restaurant));

function renderSignatureArgs(restaurants: Restaurant[]) {
    return {
        activeSearchedRestaurant: null,
        selectedRestaurant: null,
        clusters: [],
        displayRestaurantIds: new Set(restaurants.map((restaurant) => restaurant.id)),
        displayRestaurants: restaurants,
        mergedRestaurantById: new Map<string, Restaurant>(),
        nextIsClusterMode: false,
        nextIsRegionalClusterMode: false,
        nextIsSeoulDistrictMode: false,
        regionalClusters: [],
        restaurantById: new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])),
        seoulClustersToRender: [],
        seoulIndividualIds: [],
    };
}

describe('expanded cluster flow invariants', () => {
    test('provider marker culling does not remove list or swipe candidates', () => {
        const candidates = makeRestaurants();
        const candidateIds = candidates.map((restaurant) => restaurant.id);
        const providerMarkers = candidates.filter((restaurant) => shouldRenderExpandedClusterMarker(
            restaurant,
            null,
            null,
            viewport,
            true,
        ));

        expect(providerMarkers.length).toBeGreaterThan(0);
        expect(providerMarkers.length).toBeLessThan(candidates.length);
        expect(candidates).toHaveLength(735);
        expect(candidates.map((restaurant) => restaurant.id)).toEqual(candidateIds);
    });

    test('selected and searched offscreen restaurants remain provider exceptions', () => {
        const [selected, searched, ordinary] = makeRestaurants(3).map((restaurant, index) => ({
            ...restaurant,
            id: ['selected', 'searched', 'ordinary'][index],
            lat: 35,
            lng: 129,
        }));

        expect(shouldRenderExpandedClusterMarker(selected, 'selected', null, viewport, true)).toBe(true);
        expect(shouldRenderExpandedClusterMarker(searched, null, 'searched', viewport, true)).toBe(true);
        expect(shouldRenderExpandedClusterMarker(ordinary, 'selected', 'searched', viewport, true)).toBe(false);
    });

    test('pan to an empty viewport releases stale candidates and pan back restores the same ordered rows', () => {
        const candidates = makeRestaurants();
        const first = getVisibleRestaurantsForRender(candidates, null, viewport, true);
        const away = getVisibleRestaurantsForRender(candidates, null, {
            south: 35,
            north: 35.01,
            west: 129,
            east: 129.01,
        }, true);
        const returned = getVisibleRestaurantsForRender(candidates, null, viewport, true);

        expect(first.length).toBeGreaterThan(0);
        expect(away).toEqual([]);
        expect(returned.map((restaurant) => restaurant.id)).toEqual(first.map((restaurant) => restaurant.id));
        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 0,
            clusterCount: 0,
        })).toBe('release');
    });

    test('a refreshed array identity reindexes changed coordinates and changes the render signature', () => {
        const original = makeRestaurants(3);
        const changedId = original[0].id;
        const originalSnapshot = original.map((restaurant) => ({ ...restaurant }));
        const beforeVisible = getVisibleRestaurantsForRender(original, null, viewport, true);
        const beforeSignature = buildRenderTargetIdsForSignature(renderSignatureArgs(original));

        const refreshed = original.map((restaurant) => restaurant.id === changedId
            ? { ...restaurant, lat: 35, lng: 129 }
            : { ...restaurant });
        const afterVisible = getVisibleRestaurantsForRender(refreshed, null, viewport, true);
        const afterSignature = buildRenderTargetIdsForSignature(renderSignatureArgs(refreshed));

        expect(beforeVisible.some((restaurant) => restaurant.id === changedId)).toBe(true);
        expect(afterVisible.some((restaurant) => restaurant.id === changedId)).toBe(false);
        expect(afterSignature.find((token) => token.includes(changedId))).not.toEqual(
            beforeSignature.find((token) => token.includes(changedId)),
        );
        expect(original).toEqual(originalSnapshot);
    });

    test('empty viewport cleanup keeps an expanded selection renderable until expansion clears', () => {
        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 0,
            clusterCount: 0,
            expandedRestaurantCount: 735,
        })).toBe('render');
        expect(resolveEmptyClusterMarkerCleanupPlan({
            displayRestaurantCount: 0,
            clusterCount: 2,
            expandedRestaurantCount: 0,
        })).toBe('release');
    });

    test('idle and resize invalidate expanded markers before scheduling the unchanged cluster debounce', () => {
        const updateStart = rendererSource.indexOf('const handleViewportChange = () =>');
        const dynamicBounds = rendererSource.indexOf(
            'const viewportKey = getNaverMarkerViewportKey(mapInstanceRef.current, mapRef.current);',
            updateStart,
        );
        const revisionGuard = rendererSource.indexOf(
            'if (lastMarkerViewportRef.current !== viewportKey)',
            dynamicBounds,
        );
        const clusterSchedule = rendererSource.indexOf(
            'debouncedUpdateClusters();',
            revisionGuard,
        );

        expect(updateStart).toBeGreaterThan(-1);
        expect(dynamicBounds).toBeGreaterThan(updateStart);
        expect(revisionGuard).toBeGreaterThan(dynamicBounds);
        expect(clusterSchedule).toBeGreaterThan(revisionGuard);
        expect(rendererSource.slice(revisionGuard, clusterSchedule)).toContain(
            'setMarkerViewportRevision((revision) => revision + 1);',
        );
        expect(rendererSource.slice(updateStart, clusterSchedule)).not.toContain('clusterIndexRef');
        expect(rendererSource).toContain('debounce(updateClusters, mapOptimization.idleDebounceMs)');
        expect(rendererSource).toContain("maps.Event.addListener(map, 'idle', handleViewportChange)");
        expect(rendererSource).toContain("maps.Event.addListener(map, 'resize', handleViewportChange)");
        expect(rendererSource).toContain(
            'previousEarlyMarkerRenderKey.markerViewportRevision === markerViewportRevision',
        );
        expect(rendererSource).toContain(
            "+ (expandedClusterRestaurantIds.length > 0 && !retainSmallExpandedDesktop ? `:viewport-${markerViewportRevision}` : ''),",
        );
        expect(rendererSource).toContain(
            'markerRenderRetryTick, markerViewportRevision, markerVisibleActiveSearchedRestaurant',
        );
    });

    test.each([true, false])('fast pan return restores culled markers without an away idle (cluster index: %s)', (hasIndex) => {
        const candidates = makeRestaurants();
        let bounds = viewport;
        let revision = 0;
        let clusterQueries = 0;
        let clusterStateChanges = 0;
        let retries = 0;
        const lastMarkerViewportRef = { current: null as string | null };
        const mapElement = { clientWidth: 390, clientHeight: 844 };
        const map = {
            getZoom: () => 14,
            getBounds: () => ({
                getSW: () => ({ lat: () => bounds.south, lng: () => bounds.west }),
                getNE: () => ({ lat: () => bounds.north, lng: () => bounds.east }),
            }),
            getCenter: () => ({
                lat: () => (bounds.south + bounds.north) / 2,
                lng: () => (bounds.west + bounds.east) / 2,
            }),
        };
        const clusterResult: unknown[] = [];
        const markerIds = new Set<string>();
        const expandedClusterRestaurantIds = candidates.map(({ id }) => id);
        const updateStart = rendererSource.indexOf('const updateClusters = () =>');
        const updateEnd = rendererSource.indexOf('\n        const map = mapInstanceRef.current;', updateStart);
        const updateClusters = runRendererSource<() => void>(
            `${rendererSource.slice(updateStart, updateEnd)}\nreturn updateClusters;`,
            {
                disposed: false, mapInstanceRef: { current: map }, mapRef: { current: mapElement },
                getNaverMarkerViewportKey: getViewportKey, lastMarkerViewportRef, expandedClusterRestaurantIds,
                setMarkerViewportRevision: (update: (previous: number) => number) => { revision = update(revision); },
                clusterIndexRef: { current: hasIndex ? {} : null },
                quantizeNaverClusterZoom: (zoom: number) => zoom,
                resolveNaverClusterUpdateBbox: () => ({ bbox: [0, 0, 1, 1] }),
                getClusters: () => { clusterQueries++; return clusterResult; },
                areClusterFeaturesEqual: (left: unknown, right: unknown) => left === right,
                setClusters: (update: (previous: unknown[]) => unknown[]) => {
                    if (update(clusterResult) !== clusterResult) clusterStateChanges++;
                },
            },
        );
        const handlerStart = rendererSource.indexOf('const handleViewportChange = () =>');
        const handlerEnd = rendererSource.indexOf('\n        const idleListener =', handlerStart);
        const pendingClusterUpdates: Array<() => void> = [];
        const idle = runRendererSource<() => void>(
            `${rendererSource.slice(handlerStart, handlerEnd)}\nreturn handleViewportChange;`,
            {
                disposed: false, mapInstanceRef: { current: map }, mapRef: { current: mapElement },
                getNaverMarkerViewportKey: getViewportKey, lastMarkerViewportRef, expandedClusterRestaurantIds,
                setMarkerViewportRevision: (update: (previous: number) => number) => { revision = update(revision); },
                debouncedUpdateClusters: () => { pendingClusterUpdates[0] = updateClusters; },
            },
        );
        const loopStart = rendererSource.indexOf('contextualRestaurants.forEach(restaurant => {');
        const cleanupStart = rendererSource.indexOf('            // Cleanup', loopStart);
        const loopEnd = rendererSource.lastIndexOf('\n            }', cleanupStart);
        const cleanupEnd = rendererSource.indexOf('            if (hasVisibleMarkerReviewBubbles(', cleanupStart);
        const renderCode = rendererSource.slice(loopStart, loopEnd) + rendererSource.slice(cleanupStart, cleanupEnd);
        const render = () => {
            const extendedBounds = getExtendedBounds(map, 0.25);
            runRendererSource(renderCode, {
                map, contextualRestaurants: candidates, displayRestaurants: candidates, expandedClusterRestaurantIds,
                activeIds: new Set<string>(), extendedBounds,
                renderedExpandedSources: new Map<string, Restaurant>(),
                deferredMarkerRenders: [],
                markerViewportKey: getViewportKey(map, mapElement), lastMarkerViewportRef,
                shouldRenderExpandedMarker: (restaurant: Restaurant) => shouldRenderExpandedClusterMarker(
                    restaurant, null, null, extendedBounds, true,
                ),
                shouldHideInSeoulDistrictMode: () => false, isPointInSeoul: () => true,
                shouldUseSeoulDistrictCluster: false, selectedRestaurant: null,
                getNaverIndividualMarkerVisual: () => ({ content: '', anchor: { x: 14, y: 14 } }),
                activeVisibleMarkerReviewBubbles: {}, isMobileOrTablet: true,
                wrapNaverMarkerContentWithReviewBubble: (content: string) => content,
                createIndividualMarkerPosition: () => null, anchorForMarker: () => null,
                handleMarkerRestaurantSelection: () => undefined,
                markerPool: {
                    acquire: (id: string) => markerIds.add(id),
                    releaseExcept: (ids: Set<string>) => {
                        for (const id of markerIds) if (!ids.has(id)) markerIds.delete(id);
                    },
                },
                markerRenderSignatureRef: { current: null }, nextMarkerRenderSignature: {},
                scheduleMarkerRenderRetry: () => { retries++; }, resetMarkerRenderRetry: () => undefined,
            });
        };

        render();
        idle();
        pendingClusterUpdates.pop()?.();
        const initialIds = [...markerIds];
        const initialRevision = revision;
        expect(initialIds.length).toBeGreaterThan(0);
        bounds = { south: 35, north: 35.01, west: 129, east: 129.01 };
        render(); // A data-driven render culls before the debounced away idle.
        expect(markerIds.size).toBe(0);
        bounds = viewport; // Return before any away idle has run.
        idle();
        expect(clusterQueries).toBe(hasIndex ? 1 : 0); // No query or debounce wait before restoration.
        // An unchanged cluster result cannot schedule this restore; revision must.
        if (revision !== initialRevision) render();
        expect(revision).toBe(initialRevision + 1);
        expect([...markerIds]).toEqual(initialIds);
        expect(clusterStateChanges).toBe(0);
        expect(retries).toBe(0);
        pendingClusterUpdates.pop()?.();
        expect(clusterQueries).toBe(hasIndex ? 2 : 0);
        idle();
        expect(revision).toBe(initialRevision + 1);
    });

    test.each([true, false])('raw viewport changes invalidate only expanded markers (expanded: %s)', (expanded) => {
        let revision = 0;
        let zoom = 14;
        let west = viewport.west;
        const map = {
            getZoom: () => zoom,
            getBounds: () => ({
                getSW: () => ({ lat: () => viewport.south, lng: () => west }),
                getNE: () => ({ lat: () => viewport.north, lng: () => viewport.east }),
            }),
        };
        const element = { clientWidth: 390, clientHeight: 844 };
        const lastMarkerViewportRef = { current: getViewportKey(map, element) };
        const handlerStart = rendererSource.indexOf('const handleViewportChange = () =>');
        const handlerEnd = rendererSource.indexOf('\n        const idleListener =', handlerStart);
        const change = runRendererSource<() => void>(
            `${rendererSource.slice(handlerStart, handlerEnd)}\nreturn handleViewportChange;`,
            {
                disposed: false, mapInstanceRef: { current: map }, mapRef: { current: element },
                getNaverMarkerViewportKey: getViewportKey, lastMarkerViewportRef,
                expandedClusterRestaurantIds: expanded ? ['restaurant'] : [],
                setMarkerViewportRevision: (update: (previous: number) => number) => { revision = update(revision); },
                debouncedUpdateClusters: () => undefined,
            },
        );
        change();
        change();
        expect(revision).toBe(0);
        west += 0.000001; // Smaller than the rounded early-render bbox key.
        change();
        zoom += 0.25; // Same floored/quantized zoom.
        change();
        element.clientWidth++;
        change();
        element.clientHeight++;
        change();
        expect(revision).toBe(expanded ? 4 : 0);
        expect(lastMarkerViewportRef.current).toBe(getViewportKey(map, element));
        change();
        expect(revision).toBe(expanded ? 4 : 0);
    });

    test('unchanged repeated idle keeps the marker signature while viewport revision invalidates it', () => {
        const signature = (revision: number) => buildMarkerRenderSignature({
            zoom: 14,
            bounds: viewport,
            displayRestaurantIds: ['restaurant-1', 'expanded-cluster-restaurant-1'],
            selectedRestaurantId: null,
            searchedRestaurantId: null,
            isClusterMode: true,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
            markerLayerVersion: `assets-v1:viewport-${revision}`,
        });

        expect(shouldSkipMarkerUpdate(signature(4), signature(4))).toBe(true);
        expect(shouldSkipMarkerUpdate(signature(4), signature(5))).toBe(false);
    });
});
