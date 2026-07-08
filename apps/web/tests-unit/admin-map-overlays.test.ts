import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
  buildAdminMapOverlayPayloadHash,
  buildAdminMapOverlayPreviewHash,
  mapAdminMapOverlayRouteActionToRpcAction,
  normalizeAdminMapOverlayPreviewRequest,
  isAdminMapOverlayActiveAt,
  parseAdminMapOverlayLimit,
  parseAdminMapOverlayQuery,
  parseAdminMapOverlayTypes,
} from '../lib/admin-map-overlays';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

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

  test('normalizes manual overlay authoring requests and hashes canonically', () => {
    const body = {
      action: 'upsert',
      restaurantId: '11111111-1111-4111-8111-111111111111',
      overlayType: 'trend',
      label: '  Summer queue  ',
      description: '',
      activeFrom: '2026-07-07T09:00:00+09:00',
      activeUntil: null,
      evidence: { z: 1, a: { keep: true, drop: undefined } },
      reason: 'manual operator correction',
    };

    const normalized = normalizeAdminMapOverlayPreviewRequest(body);
    const reordered = normalizeAdminMapOverlayPreviewRequest({
      evidence: { a: { drop: undefined, keep: true }, z: 1 },
      reason: 'manual operator correction',
      activeUntil: null,
      activeFrom: '2026-07-07T00:00:00.000Z',
      description: null,
      label: 'Summer queue',
      overlayType: 'trend',
      restaurantId: '11111111-1111-4111-8111-111111111111',
      action: 'upsert',
    });

    expect(normalized).toEqual(reordered);
    expect(normalized.activeFrom).toBe('2026-07-07T00:00:00.000Z');
    expect(normalized.description).toBeNull();
    expect(buildAdminMapOverlayPreviewHash(normalized)).toBe(buildAdminMapOverlayPreviewHash(reordered));
  });

  test('maps route actions and hashes payloads after RPC action mapping', () => {
    const normalized = normalizeAdminMapOverlayPreviewRequest({
      action: 'deactivate',
      restaurantId: '11111111-1111-4111-8111-111111111111',
      overlayType: 'seasonal',
      label: null,
      description: null,
      activeFrom: null,
      activeUntil: null,
      evidence: { source: 'operator' },
      reason: 'manual removal',
    });
    const previewHash = buildAdminMapOverlayPreviewHash(normalized);
    const rpcAction = mapAdminMapOverlayRouteActionToRpcAction(normalized.action);

    expect(rpcAction).toBe('deactivate_overlay');
    expect(mapAdminMapOverlayRouteActionToRpcAction('upsert')).toBe('upsert_overlay');
    expect(buildAdminMapOverlayPayloadHash({
      normalized,
      rpcAction,
      previewHash,
      confirmationText: ADMIN_MAP_OVERLAY_CONFIRMATION_TEXT,
    })).not.toBe(buildAdminMapOverlayPreviewHash(normalized));
  });

  test('rejects invalid manual overlay authoring inputs', () => {
    const valid = {
      action: 'upsert',
      restaurantId: '11111111-1111-4111-8111-111111111111',
      overlayType: 'trend',
      label: 'Manual trend',
      activeFrom: null,
      activeUntil: null,
      evidence: {},
      reason: 'manual correction',
    };

    expect(() => normalizeAdminMapOverlayPreviewRequest({ ...valid, restaurantId: 'bad' })).toThrow('invalid-restaurant-id');
    expect(() => normalizeAdminMapOverlayPreviewRequest({ ...valid, overlayType: 'proposal' })).toThrow('invalid-overlay-type');
    expect(() => normalizeAdminMapOverlayPreviewRequest({ ...valid, label: '' })).toThrow('invalid-label');
    expect(() => normalizeAdminMapOverlayPreviewRequest({ ...valid, evidence: [] })).toThrow('invalid-evidence');
    expect(() => normalizeAdminMapOverlayPreviewRequest({ ...valid, reason: '' })).toThrow('invalid-reason');
    expect(() => normalizeAdminMapOverlayPreviewRequest({
      ...valid,
      activeFrom: '2026-07-08T00:00:00.000Z',
      activeUntil: '2026-07-07T00:00:00.000Z',
    })).toThrow('invalid-active-window');
    expect(normalizeAdminMapOverlayPreviewRequest({
      ...valid,
      action: 'deactivate',
      label: null,
      description: null,
    }).label).toBeNull();
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

  test('manual overlay authoring routes preserve admin, cache, mutation, and RPC boundaries', () => {
    const previewSource = source('app/api/admin/map-overlays/preview/route.ts');
    const applySource = source('app/api/admin/map-overlays/apply/route.ts');

    const previewRequireAdminIndex = previewSource.indexOf('await requireAdmin()');
    const previewServiceRoleIndex = previewSource.indexOf('createSupabaseServiceRoleClient()');
    const applyRequireAdminIndex = applySource.indexOf('await requireAdmin()');
    const applyServiceRoleIndex = applySource.indexOf('createSupabaseServiceRoleClient()');
    const applyRpcIndex = applySource.indexOf(".rpc(\n      'apply_admin_restaurant_map_overlay_action'");

    expect(previewSource).toContain("export const runtime = 'nodejs'");
    expect(applySource).toContain("export const runtime = 'nodejs'");
    expect(previewSource).toContain('Cache-Control');
    expect(previewSource).toContain('no-store');
    expect(applySource).toContain('Cache-Control');
    expect(applySource).toContain('no-store');

    expect(previewRequireAdminIndex).toBeGreaterThan(-1);
    expect(previewServiceRoleIndex).toBeGreaterThan(previewRequireAdminIndex);
    expect(previewSource).not.toContain('.rpc(');

    expect(applyRequireAdminIndex).toBeGreaterThan(-1);
    expect(applyServiceRoleIndex).toBeGreaterThan(applyRequireAdminIndex);
    expect(applyRpcIndex).toBeGreaterThan(applyServiceRoleIndex);
    expect(applySource.match(/\.rpc\(/g) ?? []).toHaveLength(1);
    expect(applySource).toContain('mapAdminMapOverlayRouteActionToRpcAction(normalized.action)');
    expect(applySource).not.toContain('error.message');
    expect(applySource).not.toContain('p_confirmation_text');
    expect(applySource).toContain('isUuid(correlationId)');
    expect(applySource).toContain('isValidIdempotencyKey(idempotencyKey)');
    expect(applySource).toContain("domain: 'admin_restaurant_map_overlays'");
    expect(applySource).toContain("source: 'admin_restaurant_map_overlay_audit_events'");
    expect(applySource).toContain("error: 'overlay_preview_stale'");
    expect(applySource).toContain("error: 'overlay_apply_failed'");
    expect(applySource).not.toContain('trend_proposal');
  });

  test('manual overlay audit migration and RPC stay service-role only and replay-safe', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260707000200_admin_restaurant_map_overlay_audit_apply.sql');

    expect(migrationSource).toContain('create table if not exists public.admin_restaurant_map_overlay_audit_events');
    expect(migrationSource).toContain('before_snapshot jsonb not null default');
    expect(migrationSource).toContain('request_metadata jsonb not null default');
    expect(migrationSource).toContain("action text not null check (action in ('upsert_overlay', 'deactivate_overlay', 'approve_proposal_overlay'))");
    expect(migrationSource).toContain('public.apply_admin_restaurant_map_overlay_action(');
    expect(migrationSource).toContain("if auth.role() <> 'service_role' then");
    expect(migrationSource).toContain("p_preview_hash !~ '^[0-9a-f]{64}$'");
    expect(migrationSource).toContain('pg_advisory_xact_lock');
    expect(migrationSource).toContain('overlay_idempotency_conflict');
    expect(migrationSource).toContain('overlay_not_found_for_deactivate');
    expect(migrationSource).toContain('grant all on table public.admin_restaurant_map_overlay_audit_events to service_role');
    expect(migrationSource).toContain('grant execute on function public.apply_admin_restaurant_map_overlay_action');
    expect(migrationSource).toContain('to service_role');
    expect(migrationSource).not.toContain(' to authenticated;');
    expect(migrationSource).not.toContain(' to anon;');
  });

  test('public home map surfaces do not fetch admin overlay contracts', () => {
    const publicSources = [
      source('app/home-client.tsx'),
      source('components/home/home-map-container.tsx'),
      source('components/map/NaverMapView.tsx'),
    ].join('\n');

    expect(publicSources).not.toContain('/api/admin/map-overlays');
    expect(publicSources).not.toContain('admin_restaurant_map_overlays');
    expect(publicSources).not.toContain('map_overlay_proposal');
    expect(publicSources).not.toContain('proposal_overlay');
  });
});
