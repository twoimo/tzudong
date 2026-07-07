import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isAdminMapOverlayActiveAt,
  parseAdminMapOverlayLimit,
  parseAdminMapOverlayQuery,
  parseAdminMapOverlayTypes,
} from '../lib/admin-map-overlays';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin map overlays contract', () => {
  test('parses bounded overlay query options', () => {
    const restaurantOneId = '11111111-1111-4111-8111-111111111111';
    const restaurantTwoId = '22222222-2222-4222-8222-222222222222';

    const query = parseAdminMapOverlayQuery(new URLSearchParams({
      types: 'trend,seasonal,trend',
      activeAt: '2026-07-07T00:00:00.000Z',
      restaurantIds: [restaurantOneId, restaurantTwoId, restaurantOneId].join(','),
      limit: '50',
    }));

    expect(query.types).toEqual(['trend', 'seasonal']);
    expect(query.restaurantIds).toEqual([restaurantOneId, restaurantTwoId]);
    expect(query.limit).toBe(50);
    expect(query.activeAt?.toISOString()).toBe('2026-07-07T00:00:00.000Z');
  });

  test('rejects invalid overlay query values', () => {
    expect(() => parseAdminMapOverlayTypes('trend,public')).toThrow('invalid-overlay-type');
    expect(() => parseAdminMapOverlayLimit('501')).toThrow('invalid-limit');
    expect(() =>
      parseAdminMapOverlayQuery(new URLSearchParams({ restaurantIds: 'r-1' })),
    ).toThrow('invalid-restaurant-id');
  });

  test('filters active overlay windows fail-closed', () => {
    const activeAt = new Date('2026-07-07T12:00:00.000Z');

    expect(isAdminMapOverlayActiveAt({
      is_active: true,
      active_from: '2026-07-07T00:00:00.000Z',
      active_until: '2026-07-08T00:00:00.000Z',
    }, activeAt)).toBe(true);

    expect(isAdminMapOverlayActiveAt({
      is_active: false,
      active_from: null,
      active_until: null,
    }, activeAt)).toBe(false);

    expect(isAdminMapOverlayActiveAt({
      is_active: true,
      active_from: '2026-07-08T00:00:00.000Z',
      active_until: null,
    }, activeAt)).toBe(false);
  });

  test('admin route is guarded, no-store, and service-role only after requireAdmin', () => {
    const routeSource = source('app/api/admin/map-overlays/route.ts');
    const requireAdminIndex = routeSource.indexOf('await requireAdmin()');
    const serviceRoleIndex = routeSource.indexOf('createSupabaseServiceRoleClient()');
    const activeFromFilterIndex = routeSource.indexOf('active_from.is.null');
    const activeUntilFilterIndex = routeSource.indexOf('active_until.is.null');
    const limitIndex = routeSource.indexOf('.limit(queryOptions.limit)');

    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain('Cache-Control');
    expect(routeSource).toContain('no-store');
    expect(requireAdminIndex).toBeGreaterThan(-1);
    expect(serviceRoleIndex).toBeGreaterThan(requireAdminIndex);
    expect(activeFromFilterIndex).toBeGreaterThan(serviceRoleIndex);
    expect(activeUntilFilterIndex).toBeGreaterThan(activeFromFilterIndex);
    expect(limitIndex).toBeGreaterThan(activeUntilFilterIndex);
    expect(routeSource).not.toContain('error.message');
  });

  test('public home map surfaces do not fetch admin overlay contracts', () => {
    const publicSources = [
      source('app/home-client.tsx'),
      source('components/home/home-map-container.tsx'),
      source('components/map/NaverMapView.tsx'),
    ].join('\n');

    expect(publicSources).not.toContain('/api/admin/map-overlays');
    expect(publicSources).not.toContain('admin_restaurant_map_overlays');
  });
});
