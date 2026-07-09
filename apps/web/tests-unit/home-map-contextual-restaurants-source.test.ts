import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVisibleMarkerReviewBubbleHtml,
  selectVisibleMarkerReviewBubbleTargets,
} from '../lib/visible-marker-review-bubbles';

const root = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const expectSourceOrder = (content: string, first: string, second: string) => {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
};

describe('home map contextual visible-marker restaurants', () => {
  test('keeps raw visible swipe callback separate from contextual presentation payload', () => {
    const naverMapSource = source('components/map/NaverMapView.tsx');
    const contractSource = source('lib/home-map-contextual-restaurants.ts');
    const reviewBubbleSource = source('lib/visible-marker-review-bubbles.ts');

    expect(contractSource).toContain('HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM = 14');
    expect(contractSource).toContain("| 'regional-cluster'");
    expect(contractSource).toContain("| 'seoul-district'");
    expect(contractSource).toContain("| 'supercluster'");
    expect(contractSource).toContain("| 'individual'");
    expect(contractSource).toContain("| 'overseas-unverified'");

    expect(naverMapSource).toContain('onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;');
    expect(naverMapSource).toContain('onContextualRestaurantsChange?: (payload: HomeMapContextualRestaurantsPayload) => void;');
    expect(naverMapSource).toContain('const hasExpandedClusterRestaurants = expandedClusterRestaurantIds.length > 0 && contextualRestaurants.length > 0;');
    expect(naverMapSource).toContain('const contextualRenderMode: HomeMapRenderMode = expandedClusterRestaurantIds.length > 0');
    expect(naverMapSource).toContain('const contextualIneligibilityReason = hasExpandedClusterRestaurants');
    expect(naverMapSource).toContain("if (renderMode !== 'individual') return 'clustered-render-mode';");
    expect(naverMapSource).toContain('zoom < HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM');

    expect(reviewBubbleSource).toContain('VISIBLE_MARKER_REVIEW_BUBBLE_MOBILE_LIMIT = 3');
    expect(reviewBubbleSource).toContain('VISIBLE_MARKER_REVIEW_BUBBLE_DESKTOP_LIMIT = 5');
    expect(reviewBubbleSource).toContain('data-visible-marker-review-bubble="true"');
    expect(naverMapSource).toContain('filterVisibleMarkerReviewBubbleViewportCandidates(visibleMarkerReviewCandidateRestaurants');
    expect(naverMapSource).toContain('selectVisibleMarkerReviewBubbleTargets(reviewBubbleCandidateRestaurants');
    expect(naverMapSource).toContain('buildVisibleMarkerReviewSeed(currentZoom, extendedBounds)');
    expect(naverMapSource).toContain('wrapNaverMarkerContentWithReviewBubble(');
    expect(naverMapSource).toContain("fetchSupabaseRows<VisibleMarkerReviewRow>('reviews'");
    expect(naverMapSource).toContain("VISIBLE_MARKER_REVIEW_SELECT = 'id,restaurant_id,user_id,content,food_photos,created_at,is_pinned'");
    expect(naverMapSource).not.toContain('import { supabase } from "@/integrations/supabase/client"');
    const rawCallbackIndex = naverMapSource.indexOf('onVisibleRestaurantsChange?.(swipeCandidates);');
    const contextualCallbackIndex = naverMapSource.indexOf('onContextualRestaurantsChange?.({');
    expect(rawCallbackIndex).toBeGreaterThan(0);
    expect(contextualCallbackIndex).toBeGreaterThan(rawCallbackIndex);
  });

  test('selects a bounded deterministic subset for marker review bubbles', () => {
    const restaurants = [
      { id: 'zero-review', review_count: 0 },
      { id: 'with-review-1', review_count: 2 },
      {
        id: 'with-review-2',
        review_count: 1,
        mergedRestaurants: [{ id: 'merged-review-2' }],
      },
      { id: 'with-review-3', review_count: 5 },
    ] as never;

    const firstRun = selectVisibleMarkerReviewBubbleTargets(restaurants, {
      limit: 2,
      seed: 'zoom:14:bounds',
    });
    const secondRun = selectVisibleMarkerReviewBubbleTargets(restaurants, {
      limit: 2,
      seed: 'zoom:14:bounds',
    });

    expect(firstRun).toEqual(secondRun);
    expect(firstRun).toHaveLength(2);
    expect(firstRun.some((target) => target.restaurantId === 'zero-review')).toBe(false);
    expect(firstRun.find((target) => target.restaurantId === 'with-review-2')?.relatedRestaurantIds)
      .toEqual(['with-review-2', 'merged-review-2']);
  });

  test('renders compact review bubble markup with photo and escaped content', () => {
    const html = buildVisibleMarkerReviewBubbleHtml(
      {
        restaurantId: 'restaurant-1',
        reviewId: 'review-1',
        userName: '맛탐험가<script>',
        content: '사진이 있는 최신 리뷰 <좋아요> 아주 길어서 잘립니다 '.repeat(3),
        photoUrl: 'https://example.com/review.jpg',
      },
      { isMobile: true },
    );

    expect(html).toContain('data-visible-marker-review-bubble="true"');
    expect(html).toContain('맛탐험가');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;좋아요&gt;');
    expect(html).toContain('https://example.com/review.jpg');
    expect(html).toContain('width:172px');
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
    expect(containerSource).toContain('buildSwipeableRestaurantsSignature(uniqueRestaurants)');
    expect(containerSource).toContain('lastSwipeableRestaurantsSignatureByModeRef.current[targetMode]');
    expect(containerSource).toContain('buildContextualRestaurantsSignature(nextPayload)');
    expect(containerSource).toContain('lastContextualRestaurantsPayloadSignatureRef.current === nextSignature');

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
    expect(desktopHomeSource).toContain('handleRestaurantOpen(restaurant)');
    expect(desktopHomeSource).toContain('{!hasContextualRestaurants ? (');
    expect(desktopHomeSource).not.toContain('bg-primary/5 px-3 pb-2 pt-3');
    expect(desktopHomeSource).not.toContain('확대된 지도에서 현재 마커로 보이는 곳이에요');
    expect(desktopHomeSource).toContain('맛집 목록');
    expect(desktopHomeSource).toContain('aria-label={`맛집 목록 ${visibleMarkerRestaurantCount}곳`}');
    expect(desktopHomeSource).toContain('restaurantThumbnailIndexes[restaurant.id] ?? 0');
    expect(desktopHomeSource).toContain('onThumbnailChange={handleRestaurantThumbnailChange}');
    expect(desktopHomeSource).toContain('layout="list"');
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
    expect(mobileOverlaySource).toContain('dismissedVisibleMarkerSheetScopeRef.current === visibleMarkerSheetDismissScope');
    expect(mobileOverlaySource).toContain('const shouldShowVisibleMarkerListRestore =');
    expect(mobileOverlaySource).toContain('data-mobile-visible-marker-restaurants-restore="true"');
    expect(mobileOverlaySource).toContain('onClick={handleVisibleMarkerSheetRestore}');
    expect(mobileOverlaySource).toContain('aria-label="맛집 목록 다시 열기"');
    expect(mobileOverlaySource).toContain('title="맛집 목록 다시 열기"');
    expect(mobileOverlaySource).toContain('h-12 w-12 rounded-full shadow-lg');
    expect(mobileOverlaySource).toContain('bg-background/95 hover:bg-secondary text-foreground border-border/70 backdrop-blur-sm');
    expect(mobileOverlaySource).toContain('<List className="h-5 w-5" aria-hidden="true" />');
    expect(mobileOverlaySource).not.toContain('목록 보기 ·');
    expect(mobileOverlaySource).not.toContain('absolute -right-1 -top-1 rounded-full bg-primary');
    expectSourceOrder(
      mobileOverlaySource,
      'data-mobile-visible-marker-restaurants-restore="true"',
      'data-mobile-submission-floating-action="true"',
    );
    expectSourceOrder(
      mobileOverlaySource,
      'data-mobile-visible-marker-restaurants-restore="true"',
      'data-user-submitted-marker-toggle="admin-only"',
    );
    expect(mobileOverlaySource).toContain('const VISIBLE_MARKER_SHEET_HEIGHT = 25;');
    expect(mobileOverlaySource).toContain('<span className="truncate">맛집 목록</span>');
    expect(mobileOverlaySource).toContain('aria-label={`맛집 목록 ${visibleMarkerRestaurantCount}곳`}');
    expect(mobileOverlaySource).toContain('aria-label="맛집 목록 닫기"');
    expect(mobileOverlaySource).toContain('onClick={handleVisibleMarkerSheetClose}');
    expect(mobileOverlaySource).toContain('density="dense"');
    expect(mobileOverlaySource).toContain('layout="list"');
    expect(mobileOverlaySource).toContain("activeSheet === 'visibleMarkers' ? \"px-3 pb-6 pt-2\" : \"p-4 pb-8\"");
    expect(mobileOverlaySource).toContain('visibleMarkerThumbnailIndexes[restaurant.id] ?? 0');
    expect(mobileOverlaySource).toContain('onThumbnailChange={handleVisibleMarkerThumbnailChange}');
    expect(mobileOverlaySource).toContain("activeSheet === 'visibleMarkers' ? VISIBLE_MARKER_SHEET_HEIGHT : MIN_SHEET_HEIGHT");
    expect(mobileOverlaySource).toContain("defaultHeight={HALF_SHEET_HEIGHT}");
    expect(mobileOverlaySource).toContain("contentClassName={activeSheet === 'visibleMarkers' ? 'scrollbar-hide' : undefined}");
    expect(source('components/ui/bottom-sheet.tsx')).toContain('contentClassName?: string;');
    expect(source('components/ui/bottom-sheet.tsx')).toContain('contentClassName');
    expect(source('components/ui/bottom-sheet.tsx')).toContain('"scrollbar-hide flex-1 overscroll-contain min-h-0 border-t border-border/50"');
    for (const globalsPath of [
      'app/app-globals.css',
      'app/home-app-globals.css',
      'app/home-deferred-globals.css',
      'app/home-detail-globals.css',
    ]) {
      const globalsSource = source(globalsPath);
      expect(globalsSource).toContain('@media (max-width: 767px)');
      expect(globalsSource).toContain('[class*="overflow-y-auto"]');
      expect(globalsSource).toContain('scrollbar-width: none;');
      expect(globalsSource).toContain('::-webkit-scrollbar');
    }
    expect(mobileOverlaySource).not.toContain('visibleMarkerRestaurantsSignatureRef');
    expect(mobileOverlaySource).toContain('dismissedVisibleMarkerSheetScopeRef.current = null;');
    expect(mobileOverlaySource).toContain('fixed bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)] right-4 z-[90] flex flex-col gap-2');
    expect(mobileOverlaySource).toContain('data-mobile-bottom-right-safe-area-owner="mobile-floating-actions"');
    expect(mobileOverlaySource).not.toContain('env(safe-area-inset-bottom)+1rem');
    expect(mobileOverlaySource.match(/const visibleMarkerSheetDismissScope = useMemo\(([\s\S]*?)\);\n    const dismissedVisibleMarkerSheetScopeRef/)?.[1]).not.toContain('visibleMarkerRestaurantsSignature');
    expect(mobileOverlaySource).toContain('const visibleMarkerSheetDismissScope = useMemo(');
    expect(mobileOverlaySource).toContain('[filters.featuredTheme, mapMode, selectedCategories, selectedCountry, selectedRegion]');
    expect(mobileOverlaySource).not.toContain('[filters.featuredTheme, mapMode, selectedCategories, selectedCountry, selectedRegion, visibleMarkerRestaurantsSignature]');
    expect(mobileOverlaySource).toContain('layoutSource="mobile-control-overlay-sheet"');
    expect(mobileOverlaySource).toContain('setVisibleMarkerSheetHeightRequestKey');
    expect(mobileOverlaySource).not.toContain('requestVisibleMarkerSheetPeek');
    expect(mobileOverlaySource).toContain("hideHandleWhenFull={activeSheet !== 'visibleMarkers'}");
    expect(mobileOverlaySource).toContain("activeSheet === 'visibleMarkers'");
    expect(mobileOverlaySource).toContain('heightRequest={');
    expect(mobileOverlaySource).toContain("mode: 'exact'");
    expect(mobileOverlaySource).toContain('incrementSearchCount(restaurant.id).catch(() => {});');
    expect(mobileOverlaySource).toContain('onRestaurantSelect(restaurant);');
  });
});
