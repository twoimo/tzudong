import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('dashboard public Supabase visibility contracts', () => {
  test('anon dashboard restaurant reads are explicitly approved-only', () => {
    const supabaseSource = source('lib/dashboard/supabase.ts');

    expect(supabaseSource).toContain("type KeyRole = 'anon' | 'service'");
    expect(supabaseSource).toContain("keyRole === 'anon'");
    expect(supabaseSource).toContain(".eq('status', 'approved')");
    expect(supabaseSource).toContain("const { data, error } = await scopedQuery.range(from, to);");
    expect(supabaseSource).toContain('Public dashboard APIs must match the public home/map visibility contract');
  });

  test('public dashboard endpoints use anon-scoped rows rather than service-role rows', () => {
    const summarySource = source('lib/dashboard/summary.ts');
    const summaryRouteSource = source('app/api/dashboard/summary/route.ts');
    const restaurantsRouteSource = source('app/api/dashboard/restaurants/route.ts');
    const videoRouteSource = source('app/api/dashboard/video/[videoId]/route.ts');

    expect(summarySource).toContain("getRestaurantRows(forceRefresh, 'anon')");
    expect(summarySource).toContain("getRestaurantRows(false, 'anon')");
    expect(summaryRouteSource).toContain('getDashboardSummary(false)');
    expect(restaurantsRouteSource).toContain('getDashboardRestaurants({');
    expect(videoRouteSource).toContain('getDashboardVideoDetail(safeVideoId)');
    expect(summaryRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(restaurantsRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(videoRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  test('client-side home/map restaurant visibility remains approved-only for parity', () => {
    const restaurantsHookSource = source('hooks/use-restaurants.tsx');

    expect(restaurantsHookSource).toContain("['status', 'eq.approved']");
    expect(restaurantsHookSource).toContain('fetchSupabaseRows');
    expect(restaurantsHookSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
