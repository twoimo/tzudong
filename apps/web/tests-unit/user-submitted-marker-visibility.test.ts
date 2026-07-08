import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildRestaurantMarkerKindSignature,
  isUserSubmittedRestaurant,
  resolveRestaurantMarkerKind,
  USER_SUBMITTED_RESTAURANT_SOURCE_TYPE,
} from '../lib/restaurant-marker-kind';

const appRoot = join(import.meta.dir, '..');

type MarkerKindSignatureRestaurant = Parameters<typeof buildRestaurantMarkerKindSignature>[0][number];

function readSource(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), 'utf8');
}

describe('user-submitted marker visibility contract', () => {
  test('classifies direct and merged user-submitted restaurants as the public user marker kind', () => {
    const direct: MarkerKindSignatureRestaurant = {
      id: 'direct-user-submitted',
      source_type: USER_SUBMITTED_RESTAURANT_SOURCE_TYPE,
    };
    const merged = {
      id: 'merged-user-submitted',
      source_type: 'youtube',
      mergedRestaurants: [{ source_type: USER_SUBMITTED_RESTAURANT_SOURCE_TYPE }],
    } as unknown as MarkerKindSignatureRestaurant;
    const ordinary: MarkerKindSignatureRestaurant = { id: 'ordinary-restaurant', source_type: 'youtube' };

    expect(isUserSubmittedRestaurant(direct)).toBe(true);
    expect(isUserSubmittedRestaurant(merged)).toBe(true);
    expect(isUserSubmittedRestaurant(ordinary)).toBe(false);
    expect(resolveRestaurantMarkerKind(direct)).toBe('user-submitted');
    expect(resolveRestaurantMarkerKind(merged)).toBe('user-submitted');
    expect(resolveRestaurantMarkerKind(ordinary)).toBe('category');
    expect(resolveRestaurantMarkerKind(direct, ['trend'])).toBe('trend');
    expect(buildRestaurantMarkerKindSignature([direct, merged, ordinary])).toContain(
      'direct-user-submitted:user-submitted:user_submission_new',
    );
  });

  test('keeps admin-only toggle state wired to map filtering and Korean accessible controls', () => {
    const homeClient = readSource('app/home-client.tsx');
    const naverMapView = readSource('components/map/NaverMapView.tsx');
    const mobileControls = readSource('components/home/MobileControlOverlay.tsx');
    const floatingButton = readSource('components/home/SubmissionFloatingButton.tsx');

    expect(homeClient).toContain('const [showUserSubmittedMarkers, setShowUserSubmittedMarkers] = useState(true);');
    expect(homeClient).toContain('title: next ? "사용자 제보 맛집 마커 표시" : "사용자 제보 맛집 마커 숨김",');
    expect(homeClient).toContain('showUserSubmittedMarkers={showUserSubmittedMarkers}');
    expect(homeClient).toContain('onUserSubmittedMarkersToggle={handleUserSubmittedMarkerToggle}');
    expect(homeClient).toContain('isAdmin={isAdmin}');

    expect(naverMapView).toContain('return unfilteredDisplayRestaurants.filter((restaurant) => !isUserSubmittedRestaurant(restaurant));');
    expect(naverMapView).toContain('showUserSubmittedMarkers || !isUserSubmittedRestaurant(activeSearchedRestaurant)');
    expect(naverMapView).toContain('showUserSubmittedMarkers || !isUserSubmittedRestaurant(selectedRestaurant)');
    expect(naverMapView).toContain('showUserSubmittedMarkers,');

    for (const source of [mobileControls, floatingButton]) {
      expect(source).toContain('isAdmin && (');
      expect(source).toContain('aria-pressed={showUserSubmittedMarkers}');
      expect(source).toContain('data-user-submitted-marker-toggle="admin-only"');
      expect(source).toContain('사용자 제보 맛집 마커 숨기기');
      expect(source).toContain('사용자 제보 맛집 마커 보이기');
      expect(source).toContain('bg-blue-600 hover:bg-blue-700 text-white border-transparent');
    }
  });

  test('keeps public home and map sources free of admin overlay/proposal endpoints', () => {
    const publicSources = [
      'app/home-client.tsx',
      'components/home/home-map-container.tsx',
      'components/home/MobileControlOverlay.tsx',
      'components/home/SubmissionFloatingButton.tsx',
      'components/map/NaverMapView.tsx',
      'components/map/naver-map-surface.tsx',
      'lib/naver-map-marker-visuals.ts',
      'lib/restaurant-marker-kind.ts',
    ];
    const forbiddenFragments = [
      'admin_restaurant_map_overlays',
      '/api/admin/map-overlays',
      'admin-map-overlays',
      'TrendProposalQueue',
      'OverlayPreviewApplyPanel',
      'approve_admin_restaurant_map_overlay_proposal',
    ];

    for (const path of publicSources) {
      const source = readSource(path);
      for (const forbidden of forbiddenFragments) {
        expect(source, `${path} must not leak ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
