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

    expect(mobileOverlaySource).toContain("type ActiveSheet = 'none' | 'region' | 'category' | 'search' | 'visibleMarkers';");
    expect(mobileOverlaySource).toContain('const canShowVisibleMarkerSheet =');
    expect(mobileOverlaySource).toContain("(activeSheet === 'none' || activeSheet === 'visibleMarkers')");
    expect(mobileOverlaySource).toContain("activeSheet !== 'visibleMarkers'");
    expect(mobileOverlaySource).toContain('data-mobile-visible-marker-restaurants-trigger="true"');
    expect(mobileOverlaySource).toContain('data-mobile-visible-marker-restaurants-sheet="true"');
    expect(mobileOverlaySource).toContain('incrementSearchCount(restaurant.id).catch(() => {});');
  });
});
