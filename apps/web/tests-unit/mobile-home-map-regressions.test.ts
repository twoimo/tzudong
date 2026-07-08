import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Restaurant } from '../types/restaurant';
import { getAdjacentRestaurantByStep } from '../lib/home-map-keyboard-navigation';
import { shouldDismissSheetFromPeek } from '../lib/mobile-sheet-dismiss-gesture';
import { buildPostSearchSwipeCandidates, releaseSearchSelectionOwnership } from '../lib/mobile-home-search-selection';
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate } from '../lib/map-render-guard';
import { resolveMobileMapBlankTapAction } from '../lib/mobile-map-fullscreen-toggle';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const makeRestaurant = (id: string, name: string): Restaurant =>
    ({
        id,
        name,
        lat: 37.5665,
        lng: 126.978,
    }) as Restaurant;

describe('mobile home map regression guards', () => {
    test('search-selected restaurant can still swipe to a different visible restaurant', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');
        const nearbyMarkerRestaurant = makeRestaurant('marker-next', '명동칼국수');
        const anotherNearbyRestaurant = makeRestaurant('marker-third', '서울돈까스');

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: [searchedRestaurant, nearbyMarkerRestaurant, anotherNearbyRestaurant],
            currentRestaurant: searchedRestaurant,
            step: 1,
            isSameRestaurant: (left, right) => left.id === right.id,
        });

        expect(nextRestaurant?.id).toBe('marker-next');
    });

    test('marker render is not skipped when another marker takes over after a search selection', () => {
        const sharedBounds = {
            south: 37.565,
            west: 126.977,
            north: 37.568,
            east: 126.98,
        } as const;
        const sharedDisplayIds = ['search-selected', 'marker-next', 'marker-third'] as const;

        const previous = buildMarkerRenderSignature({
            zoom: 15,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'search-selected',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'marker-next',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('marker render is not skipped when the sheet closes and a new marker opens with cleared search state', () => {
        const sharedBounds = {
            south: 37.565,
            west: 126.977,
            north: 37.568,
            east: 126.98,
        } as const;
        const sharedDisplayIds = ['search-selected', 'marker-next', 'marker-third'] as const;

        const previous = buildMarkerRenderSignature({
            zoom: 15,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'search-selected',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'marker-third',
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('single-visible post-search swipe falls back to the nearest restaurant', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');
        const nearestRestaurant = {
            ...makeRestaurant('marker-nearest', '서울돈까스'),
            lat: 37.5661,
            lng: 126.9772,
        } as Restaurant;
        const fartherRestaurant = {
            ...makeRestaurant('marker-farther', '명동칼국수'),
            lat: 37.56695,
            lng: 126.97885,
        } as Restaurant;

        const swipeCandidates = buildPostSearchSwipeCandidates({
            visibleRestaurants: [searchedRestaurant],
            allRestaurants: [searchedRestaurant, fartherRestaurant, nearestRestaurant],
            activeSearchedRestaurant: searchedRestaurant,
        });

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: swipeCandidates,
            currentRestaurant: searchedRestaurant,
            step: 1,
            isSameRestaurant: (left, right) => left.id === right.id,
        });

        expect(nextRestaurant?.id).toBe('marker-nearest');
    });

    test('search ownership release keeps the current detail selection active', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');

        expect(
            releaseSearchSelectionOwnership({
                searchedRestaurant,
                selectedRestaurant: searchedRestaurant,
                panelRestaurant: searchedRestaurant,
                isPanelOpen: true,
            })
        ).toMatchObject({
            searchedRestaurant: null,
            selectedRestaurant: searchedRestaurant,
            panelRestaurant: searchedRestaurant,
            isPanelOpen: true,
        });
    });

    test('peek-state downward sheet gesture dismisses only after intentional distance or speed', () => {
        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 64,
            gestureVelocity: 0.12,
        })).toBe(true);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 18,
            gestureVelocity: 0.3,
            minVelocityPxPerMs: 0.26,
        })).toBe(true);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 18,
            gestureVelocity: 0.12,
            minVelocityPxPerMs: 0.26,
        })).toBe(false);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: false,
            dragDistancePx: 80,
            gestureVelocity: 0.4,
        })).toBe(false);
    });

    test('blank map taps collapse the sheet, enter fullscreen map, then restore the peek sheet', () => {
        const baseState = {
            isMobileOrTablet: true,
            isPanelOpen: true,
            hasPanelRestaurant: true,
            peekHeight: 25,
        };

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: false,
            sheetHeight: 50,
        })).toBe('collapse-to-peek');

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: false,
            sheetHeight: 25,
        })).toBe('enter-map-fullscreen');

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: true,
            sheetHeight: 25,
        })).toBe('restore-from-map-fullscreen');
    });

    test('blank map fullscreen toggle is inactive outside a mobile restaurant panel', () => {
        expect(resolveMobileMapBlankTapAction({
            isMobileOrTablet: false,
            isPanelOpen: true,
            hasPanelRestaurant: true,
            isMapFullscreen: false,
            sheetHeight: 50,
            peekHeight: 25,
        })).toBe('none');

        expect(resolveMobileMapBlankTapAction({
            isMobileOrTablet: true,
            isPanelOpen: false,
            hasPanelRestaurant: true,
            isMapFullscreen: false,
            sheetHeight: 50,
            peekHeight: 25,
        })).toBe('none');
    });

    test('cluster marker zoom jumps immediately without Naver morph animation', () => {
        const mapSource = source('components/map/NaverMapView.tsx');

        expect(mapSource).toContain('const jumpWithPanelOffset = useCallback');
        expect(mapSource).toContain('map.setZoom(targetZoom, false)');
        expect(mapSource).toContain('map.setCenter(adjustedCenter)');
        expect(mapSource).toContain('jumpWithPanelOffset(cluster.center.lat, cluster.center.lng, targetZoom)');
        expect(mapSource).toContain('jumpWithPanelOffset(lat, lng, targetZoom)');
        expect(mapSource).not.toContain('morphWithPanelOffset');
    });
    test('mobile restaurant detail sheet peeks on map interaction without skipping fullscreen tap sequence', () => {
        const containerSource = source('components/home/home-map-container.tsx');
        const naverMapSource = source('components/map/NaverMapView.tsx');
        const overseasMapSource = source('components/map/OverseasMap.tsx');

        expect(containerSource).toContain('const lastMapInteractionCollapseAtRef = useRef(0);');
        expect(containerSource).toContain('const handleMapUserInteraction = useCallback(() => {');
        expect(containerSource).toContain('lastMapInteractionCollapseAtRef.current = Date.now();');
        expect(containerSource).toContain('setSheetHeightSafe(PEEK_SHEET_HEIGHT, true);');
        expect(containerSource).toContain('if (now - lastMapInteractionCollapseAtRef.current < 450) return;');
        expect(containerSource.match(/onMapInteraction=\{handleMapUserInteraction\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(naverMapSource).toContain('const isSelectionClearedByPanelClose =');
        expect(naverMapSource).toContain('if (isSelectionClearedByPanelClose) {');
        expect(naverMapSource).toContain('if (isSelectionChanged && currentSelectedId) {');
        expect(naverMapSource).toContain("map.panTo(newCenterLatLng, { duration: 340, easing: 'easeOutCubic' });");
        expect(naverMapSource).toContain('Number.isNaN(urlZoom)');

        expect(naverMapSource).toContain('onMapInteraction?: () => void;');
        expect(naverMapSource).toContain('onMapInteraction?.();');
        expect(naverMapSource).toContain("const listener = maps.Event.addListener(mapInstanceRef.current, 'click', () => {");
        expect(naverMapSource).toContain('onMapBlankClick, onMapInteraction');
        expect(overseasMapSource).toContain('onMapInteraction?: () => void;');
        expect(overseasMapSource).toContain('onMapInteractionRef.current?.();');
        expect(overseasMapSource).toContain("mapInstance.on('click', () => {");
    });

    test('G002 mobile category sheet commits immediately without delayed apply affordance', () => {
        const overlaySource = source('components/home/MobileControlOverlay.tsx');

        expect(overlaySource).not.toContain('적용하기');
        expect(overlaySource).toContain('data-mobile-category-sheet-commit="immediate"');
        expect(overlaySource).toContain('onCategoryChange([])');
        expect(overlaySource).toContain('onCategoryChange(newCategories)');
        expect(overlaySource).toContain('선택 즉시 지도에 반영됩니다.');
        const desktopPanelSource = source('components/home/home-desktop-control-panel.tsx');
        expect(desktopPanelSource).toContain('선택하면 즉시 적용됩니다.');
        expect(desktopPanelSource).toContain('onCategoryChange={onCategoryChange}');
    });

    test('G002 detail-active safe area owns mobile bottom-right floating actions', () => {
        const overlaySource = source('components/home/MobileControlOverlay.tsx');

        expect(overlaySource).toContain(
            'const doesDetailOwnBottomRightSafeArea = isPanelOpen && Boolean(panelRestaurant);'
        );
        expect(overlaySource).toContain(
            "activeSheet !== 'search' && !doesDetailOwnBottomRightSafeArea"
        );
        expect(overlaySource).toContain('data-mobile-bottom-right-safe-area-owner="mobile-floating-actions"');
        expect(overlaySource).toContain('{shouldRenderMobileFloatingActions && (');
    });
    test('home detail route history uses app-owned list/detail states and browser back restoration contracts', () => {
        const homeSource = source('app/home-client.tsx');
        const effectsSource = source('app/home-client-effects.tsx');

        expect(homeSource).toContain('window.addEventListener("popstate", handlePopState)');
        expect(homeSource).toContain('window.history.pushState(detailState, "", detailUrl)');
        expect(homeSource).toContain('buildHomeListState({');
        expect(homeSource).toContain('buildHomeDetailState({');
        expect(homeSource).toContain('isHomeDetailHistoryState(window.history.state)');
        expect(homeSource).toContain('window.history.back();');
        expect(effectsSource).toContain('resolveHomeDetailMapModeParam(searchParams)');
        expect(effectsSource).toContain("{ source: 'url', mapMode: targetMode ?? undefined, restoreKey }");
    });
});
