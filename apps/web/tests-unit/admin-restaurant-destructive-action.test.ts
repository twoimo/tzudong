import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS,
  validateRestaurantDestructiveActionRequest,
} from '../lib/admin/restaurant-destructive-action-contract';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

describe('admin restaurant destructive action contract', () => {
  test('accepts a typed, reasoned primary soft delete request', () => {
    const result = validateRestaurantDestructiveActionRequest({
      action: 'soft_delete_restaurant',
      targetRestaurantIds: ['restaurant-1'],
      reason: 'duplicate imported row',
      confirmation: RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant,
      expectedRestaurantName: '테스트 맛집',
    }, {
      routeRestaurantId: 'restaurant-1',
      actualRestaurantName: '테스트 맛집',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        action: 'soft_delete_restaurant',
        targetRestaurantIds: ['restaurant-1'],
        reason: 'duplicate imported row',
        expectedRestaurantName: '테스트 맛집',
      });
    }
  });

  test('rejects invalid destructive action inputs before database mutation', () => {
    expect(validateRestaurantDestructiveActionRequest({
      action: 'hard_delete_restaurant',
      targetRestaurantIds: ['restaurant-1'],
      reason: 'cleanup',
      confirmation: RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant,
      expectedRestaurantName: '테스트 맛집',
    }).ok).toBe(false);

    expect(validateRestaurantDestructiveActionRequest({
      action: 'soft_delete_restaurant_links',
      targetRestaurantIds: ['restaurant-1'],
      reason: 'cleanup',
      confirmation: RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant,
      expectedRestaurantName: '테스트 맛집',
    }).ok).toBe(false);

    expect(validateRestaurantDestructiveActionRequest({
      action: 'soft_delete_restaurant',
      targetRestaurantIds: [],
      reason: 'cleanup',
      confirmation: RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant,
      expectedRestaurantName: '테스트 맛집',
    }).ok).toBe(false);

    expect(validateRestaurantDestructiveActionRequest({
      action: 'soft_delete_restaurant',
      targetRestaurantIds: ['restaurant-1'],
      reason: '',
      confirmation: RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant,
      expectedRestaurantName: '테스트 맛집',
    }).ok).toBe(false);

    expect(validateRestaurantDestructiveActionRequest({
      action: 'soft_delete_restaurant',
      targetRestaurantIds: ['restaurant-1'],
      reason: 'cleanup',
      confirmation: 'delete',
      expectedRestaurantName: '테스트 맛집',
    }).ok).toBe(false);

    expect(validateRestaurantDestructiveActionRequest({
      action: 'soft_delete_restaurant',
      targetRestaurantIds: ['restaurant-1'],
      reason: 'cleanup',
      confirmation: RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS.soft_delete_restaurant,
      expectedRestaurantName: '다른 맛집',
    }, {
      routeRestaurantId: 'restaurant-1',
      actualRestaurantName: '테스트 맛집',
    }).ok).toBe(false);
  });

  test('keeps the restaurant destructive route server gated, audited, and read back', () => {
    const routeSource = source('app/api/admin/restaurants/[restaurantId]/destructive-action/route.ts');

    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource.indexOf('await requireAdmin()')).toBeGreaterThan(-1);
    expect(routeSource.indexOf('await requireAdmin()')).toBeLessThan(routeSource.indexOf('createSupabaseServiceRoleClient()'));
    expect(routeSource).toContain('validateRestaurantDestructiveActionRequest');
    expect(routeSource).toContain('randomUUID()');
    expect(routeSource).toContain('correlationId');
    expect(routeSource).toContain("rpc(\n      'apply_restaurant_admin_destructive_action'");
    expect(routeSource).toContain(".from('restaurants')");
    expect(routeSource).toContain("status === 'deleted'");
    expect(routeSource).toContain(".from('restaurant_admin_destructive_audit_events')");
    expect(routeSource).toContain("'Cache-Control': 'no-store'");
    expect(routeSource).not.toContain('rpcError.message');
    expect(routeSource).not.toContain('readbackError.message');
    expect(routeSource).not.toContain('auditError.message');
  });

  test('moves primary delete in the modal off browser Supabase mutation', () => {
    const modalSource = source('components/admin/AdminRestaurantModal.tsx');
    const deleteHandler = modalSource.slice(
      modalSource.indexOf('const handleDelete = async () =>'),
      modalSource.indexOf('const adminRestaurantTitle ='),
    );

    expect(deleteHandler).toContain('/api/admin/restaurants/');
    expect(deleteHandler).toContain('destructive-action');
    expect(deleteHandler).toContain('soft_delete_restaurant');
    expect(deleteHandler).toContain('targetRestaurantIds: [restaurant.id]');
    expect(deleteHandler).toContain('reason: deleteReason');
    expect(deleteHandler).toContain('confirmation: deleteConfirmation');
    expect(deleteHandler).toContain('expectedRestaurantName: restaurant.name');
    expect(deleteHandler).toContain('감사 ID:');
    expect(deleteHandler).not.toContain('assertLegacyBrowserAdminMutationEnabled("restaurant_record", "delete_restaurant")');
    expect(deleteHandler).not.toContain('.from("restaurants")');
    expect(deleteHandler).not.toContain("status: 'deleted'");
  });

  test('adds a domain-specific service-role-only restaurant destructive audit migration', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260704000200_restaurant_destructive_admin_audit.sql')
      .replace(/\r\n/g, '\n');

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.restaurant_admin_destructive_audit_events');
    expect(migrationSource).toContain('before_snapshot jsonb NOT NULL');
    expect(migrationSource).toContain('after_snapshot jsonb NOT NULL');
    expect(migrationSource).toContain('correlation_id uuid NOT NULL UNIQUE');
    expect(migrationSource).toContain('request_metadata jsonb NOT NULL');
    expect(migrationSource).toContain('REVOKE ALL ON public.restaurant_admin_destructive_audit_events FROM public, anon, authenticated');
    expect(migrationSource).toContain('GRANT SELECT, INSERT ON public.restaurant_admin_destructive_audit_events TO service_role');
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.apply_restaurant_admin_destructive_action');
    expect(migrationSource).toContain("auth.role() <> 'service_role'");
    expect(migrationSource).toContain('FOR UPDATE');
    expect(migrationSource).toContain("status = 'deleted'");
    expect(migrationSource).toContain('updated_at = now()');
    expect(migrationSource).toContain('RETURN jsonb_build_object');
    expect(migrationSource).toContain('REVOKE ALL ON FUNCTION public.apply_restaurant_admin_destructive_action');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.apply_restaurant_admin_destructive_action');
    expect(migrationSource).toContain("NOTIFY pgrst, 'reload schema'");
    expect(migrationSource).not.toContain('admin_audit_events');
    expect(migrationSource).not.toContain('soft_delete_restaurant_links');
  });
});
