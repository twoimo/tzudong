import type { HomeMapMode } from '@/lib/home-detail-route-state';

export type HomeReturnTarget = {
  restaurantId: string | null;
  mapMode: HomeMapMode;
  focusZoom: number | null;
};

// Only a public restaurant selection enters this route. Search text, device
// coordinates, account fields and drafts stay with their existing owners.
export function buildHomeReturnHref(target: HomeReturnTarget): string {
  if (!target.restaurantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.restaurantId)) return '/';
  if (target.mapMode !== 'domestic' && target.mapMode !== 'overseas') return '/';
  const params = new URLSearchParams({ restaurant: target.restaurantId, mapMode: target.mapMode });
  if (typeof target.focusZoom === 'number' && Number.isFinite(target.focusZoom)) {
    params.set('z', String(target.focusZoom));
  }
  // A detail-history restore key describes the previous list entry, not the
  // Mypage entry. Reusing it here could make closing the detail go to Mypage.
  return `/?${params.toString()}`;
}
