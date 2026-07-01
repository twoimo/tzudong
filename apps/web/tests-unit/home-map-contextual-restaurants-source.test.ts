import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

describe('home map contextual visible-marker restaurants', () => {
  test('keeps raw visible swipe callback separate from contextual presentation payload', () => {
    const naverMapSource = source('components/map/NaverMapView.tsx');
    const contractSource = source('lib/home-map-contextual-restaurants.ts');

    expect(contractSource).toContain('HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM = 14');
    expect(contractSource).toContain("| 'regional-cluster'");
    expect(contractSource).toContain("| 'seoul-district'");
    expect(contractSource).toContain("| 'supercluster'");
    expect(contractSource).toContain("| 'individual'");
    expect(contractSource).toContain("| 'overseas-unverified'");

    expect(naverMapSource).toContain('onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;');
    expect(naverMapSource).toContain('onContextualRestaurantsChange?: (payload: HomeMapContextualRestaurantsPayload) => void;');
    expect(naverMapSource).toContain('const contextualRenderMode = resolveHomeMapContextualRenderMode({');
    expect(naverMapSource).toContain("if (renderMode !== 'individual') return 'clustered-render-mode';");
    expect(naverMapSource).toContain('zoom < HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM');

    const rawCallbackIndex = naverMapSource.indexOf('onVisibleRestaurantsChange?.(swipeCandidates);');
    const contextualCallbackIndex = naverMapSource.indexOf('onContextualRestaurantsChange?.({');
    expect(rawCallbackIndex).toBeGreaterThan(0);
    expect(contextualCallbackIndex).toBeGreaterThan(rawCallbackIndex);
  });

  test('wires contextual state through container and home controls without overseas presentation', () => {
    const homeClientSource = source('app/home-client.tsx');
    const containerSource = source('components/home/home-map-container.tsx');
    const controlPanelSource = source('components/home/home-control-panel.tsx');

    expect(homeClientSource).toContain('const [contextualRestaurantsPayload, setContextualRestaurantsPayload] =');
    expect(homeClientSource).toContain('onContextualRestaurantsChange={setContextualRestaurantsPayload}');
    expect(homeClientSource).toContain('contextualRestaurantsPayload={contextualRestaurantsPayload}');

    expect(containerSource).toContain('const dedupeHomeMapRestaurants = (restaurants: Restaurant[]) =>');
    expect(containerSource).toContain('onContextualRestaurantsChange?: (payload: HomeMapContextualRestaurantsPayload | null) => void;');
    expect(containerSource).toContain('clearContextualRestaurants(EMPTY_OVERSEAS_CONTEXTUAL_RESTAURANTS);');
    expect(containerSource).toContain('clearContextualRestaurants(EMPTY_DOMESTIC_CONTEXTUAL_RESTAURANTS);');
    expect(containerSource).toContain('uniqueRestaurants.some((existing) => isSameRestaurantForSwipe(existing, restaurant))');
    expect(containerSource).toContain('onContextualRestaurantsChange={handleContextualRestaurantsChange}');

    expect(controlPanelSource).toContain('contextualRestaurantsPayload?: HomeMapContextualRestaurantsPayload | null;');
    expect(controlPanelSource).toContain('isMapFullscreen?: boolean;');
    expect(controlPanelSource).toContain('contextualRestaurantsPayload={contextualRestaurantsPayload}');
  });

  test('renders desktop and mobile contextual discovery only as presentation UI', () => {
    const desktopHomeSource = source('components/home/DesktopLeftPanelMapHome.tsx');
    const desktopPanelSource = source('components/home/home-desktop-control-panel.tsx');
    const mobileOverlaySource = source('components/home/MobileControlOverlay.tsx');

    expect(desktopPanelSource).toContain('shouldShowDesktopMapHome ? (');
    expect(desktopPanelSource).toContain('contextualRestaurantsPayload={mapMode === "domestic" && !isMapFullscreen ? contextualRestaurantsPayload : null}');
    expect(desktopHomeSource).toContain('data-desktop-left-panel-visible-marker-restaurants="true"');
    expect(desktopHomeSource).toContain('지도에 보이는 맛집');
    expect(desktopHomeSource).toContain('handleRestaurantOpen(restaurant)');
    expect(desktopHomeSource).toContain('{!hasContextualRestaurants ? (');
    expect(desktopHomeSource).not.toContain('bg-primary/5 px-3 pb-2 pt-3');
    expect(desktopHomeSource).toContain('restaurantThumbnailIndexes[restaurant.id] ?? 0');
    expect(desktopHomeSource).toContain('const visibleMarkerRestaurantCount =');
    expect(desktopHomeSource).toContain('aria-label={`지도에 보이는 맛집 ${visibleMarkerRestaurantCount}곳`}');
    expect(desktopHomeSource).toContain('onThumbnailChange={handleRestaurantThumbnailChange}');
    expect(desktopHomeSource).not.toContain('지도에 보이는 맛집 상세 보기');
    expect(desktopHomeSource.match(/\{!hasContextualRestaurants \? \(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

    expect(mobileOverlaySource).toContain("type ActiveSheet = 'none' | 'region' | 'category' | 'search' | 'visibleMarkers';");
    expect(mobileOverlaySource).toContain('const canAutoShowVisibleMarkerSheet =');
    expect(mobileOverlaySource).toContain("setActiveSheet('visibleMarkers');");
    expect(mobileOverlaySource).not.toContain('data-mobile-visible-marker-restaurants-trigger="true"');
    expect(mobileOverlaySource).toContain('data-mobile-visible-marker-restaurants-sheet="true"');
    expect(mobileOverlaySource).toContain('data-mobile-visible-marker-restaurants-sheet-frame="true"');
    expect(mobileOverlaySource).not.toContain('확대한 지도에서 현재 마커로 보이는 맛집이에요.');
    expect(mobileOverlaySource).toContain("activeSheet !== 'visibleMarkers' ? (");
    expect(mobileOverlaySource).toContain('dismissedVisibleMarkerRestaurantsSignatureRef.current === visibleMarkerRestaurantsSignature');
    expect(mobileOverlaySource).toContain('<span className="truncate">지도에 보이는 맛집</span>');
    expect(mobileOverlaySource).toContain('aria-label={`지도에 보이는 맛집 ${visibleMarkerRestaurantCount}곳`}');
    expect(mobileOverlaySource).toContain('aria-label="지도에 보이는 맛집 닫기"');
    expect(mobileOverlaySource).toContain('onClick={handleVisibleMarkerSheetClose}');
    expect(mobileOverlaySource).toContain('density="dense"');
    expect(mobileOverlaySource).toContain("activeSheet === 'visibleMarkers' ? \"p-3 pb-6\" : \"p-4 pb-8\"");
    expect(mobileOverlaySource).toContain('visibleMarkerThumbnailIndexes[restaurant.id] ?? 0');
    expect(mobileOverlaySource).toContain('onThumbnailChange={handleVisibleMarkerThumbnailChange}');
    expect(mobileOverlaySource).toContain('VISIBLE_MARKER_PEEK_SHEET_HEIGHT = 16');
    expect(mobileOverlaySource).toContain('visibleMarkerRestaurantsSignatureRef.current === visibleMarkerRestaurantsSignature');
    expect(mobileOverlaySource).toContain('data-bottom-sheet-layout-source="mobile-control-overlay-sheet"');
    expect(mobileOverlaySource).toContain('setVisibleMarkerSheetHeightRequestKey(0);');
    expect(mobileOverlaySource).toContain("hideHandleWhenFull={activeSheet !== 'visibleMarkers'}");
    expect(mobileOverlaySource).toContain('visibleMarkerSheetHeightRequestKey > 0');
    expect(mobileOverlaySource).toContain('height: VISIBLE_MARKER_PEEK_SHEET_HEIGHT');
    expect(mobileOverlaySource).toContain("mode: 'exact'");
    expect(mobileOverlaySource).toContain('incrementSearchCount(restaurant.id).catch(() => {});');
  });
});
