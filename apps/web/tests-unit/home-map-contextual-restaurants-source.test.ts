import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVisibleMarkerReviewBubbleHtml,
  selectVisibleMarkerReviewBubbleTargets,
} from '../lib/visible-marker-review-bubbles';

const root = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

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
    expect(naverMapSource).toContain('const contextualRenderMode = resolveHomeMapContextualRenderMode({');
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
    expect(mobileOverlaySource).toContain('dismissedVisibleMarkerRestaurantsSignatureRef.current === visibleMarkerRestaurantsSignature');
    expect(mobileOverlaySource).toContain('<span className="truncate">맛집 목록</span>');
    expect(mobileOverlaySource).toContain('aria-label={`맛집 목록 ${visibleMarkerRestaurantCount}곳`}');
    expect(mobileOverlaySource).toContain('aria-label="맛집 목록 닫기"');
    expect(mobileOverlaySource).toContain('onClick={handleVisibleMarkerSheetClose}');
    expect(mobileOverlaySource).toContain('density="dense"');
    expect(mobileOverlaySource).toContain('layout="list"');
    expect(mobileOverlaySource).toContain("activeSheet === 'visibleMarkers' ? \"px-3 pb-6 pt-2\" : \"p-4 pb-8\"");
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
