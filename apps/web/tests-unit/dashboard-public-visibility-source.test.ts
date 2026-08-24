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
    expect(supabaseSource).toContain('getDashboardRestaurantRowsPage');
    expect(supabaseSource).toContain(".select(DASHBOARD_RESTAURANT_SELECT, { count: 'exact' })");
    expect(supabaseSource).toContain(".not('lat', 'is', null).not('lng', 'is', null)");
    expect(supabaseSource).toContain(".order('updated_at', { ascending: false })");
    expect(supabaseSource).toContain('Public dashboard APIs must match the public home/map visibility contract');
  });

  test('restaurants Data API migration restricts browser reads to approved rows', () => {
    const migrationSource = source('../../backend/supabase/migrations/20260627150000_restrict_restaurants_public_select_approved.sql');

    expect(migrationSource).toContain('alter table public.restaurants enable row level security');
    expect(migrationSource).toContain('drop policy if exists "Enable read access for all users"');
    expect(migrationSource).toContain('restaurants_public_approved_select');
    expect(migrationSource).toContain("using (status = 'approved')");
    expect(migrationSource).toContain('restaurants_authenticated_admin_update');
    expect(migrationSource).toContain('public.is_user_admin((select auth.uid()))');
    expect(migrationSource).toContain("notify pgrst, 'reload schema'");
  });

  test('public dashboard endpoints use anon-scoped rows rather than service-role rows', () => {
    const summarySource = source('lib/dashboard/summary.ts');
    const summaryRouteSource = source('app/api/dashboard/summary/route.ts');
    const restaurantsRouteSource = source('app/api/dashboard/restaurants/route.ts');
    const videoRouteSource = source('app/api/dashboard/video/[videoId]/route.ts');

    expect(summarySource).toContain("getRestaurantRows(forceRefresh, 'anon')");
    expect(summarySource).toContain("getRestaurantRows(false, 'anon')");
    expect(summarySource).toContain('canUseDirectRestaurantPageQuery');
    expect(summarySource).toContain('getDashboardRestaurantRowsPage({');
    expect(summarySource).toContain("}, 'anon');");
    expect(summaryRouteSource).toContain('getDashboardSummary(false)');
    expect(restaurantsRouteSource).toContain('getDashboardRestaurants({');
    expect(videoRouteSource).toContain('getDashboardVideoDetail(safeVideoId)');
    expect(summaryRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(restaurantsRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(videoRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  test('dashboard summary cache keeps anon row fallback and explicit rollback metadata', () => {
    const summarySource = source('lib/dashboard/summary.ts');
    const summaryRouteSource = source('app/api/dashboard/summary/route.ts');
    const dashboardTypesSource = source('types/dashboard.ts');

    expect(summarySource).toContain('DASHBOARD_SUMMARY_CACHE_ENABLED');
    expect(summarySource).toContain('dashboardSummaryCache');
    expect(summarySource).toContain("getRestaurantRows(forceRefresh, 'anon')");
    expect(summarySource).toContain("source: 'row-derived-cache'");
    expect(summarySource).toContain('buildDashboardSummaryChecksum(rows)');
    expect(summarySource).toContain('SUMMARY_VIDEO_LIMIT');
    expect(summarySource).toContain('clearDashboardSummaryCache');
    expect(summaryRouteSource).toContain('X-Dashboard-Summary-Checksum');
    expect(summaryRouteSource).toContain('X-Dashboard-Summary-Cache-Status');
    expect(summaryRouteSource).toContain('X-Dashboard-Summary-Video-Limit');
    expect(dashboardTypesSource).toContain('DashboardSummaryFreshness');
    expect(dashboardTypesSource).toContain("cacheStatus: 'bypass' | 'miss' | 'hit' | 'shared'");
  });

  test('client-side home/map restaurant visibility remains approved-only for parity', () => {
    const restaurantsHookSource = source('hooks/use-restaurants.tsx');

    expect(restaurantsHookSource).toContain("['status', 'eq.approved']");
    expect(restaurantsHookSource).toContain('fetchSupabaseRows');
    expect(restaurantsHookSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
  test('public list and search restaurant reads stay approved-only', () => {
    const stampSource = source('app/stamp/page.tsx');
    const categoryFilterSource = source('components/filters/CategoryFilter.tsx');
    const popularSource = source('lib/popular-restaurants.ts');
    const feedSource = source('components/feed/FeedContent.tsx');

    expect(stampSource).toContain(".eq('status', 'approved')");
    expect(stampSource).toContain(".ilike('approved_name'");
    expect(categoryFilterSource).toContain("['status', 'eq.approved']");
    expect(popularSource).toContain(".eq('status', 'approved')");
    expect(feedSource).toContain(".eq('status', 'approved')");
    expect(stampSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(categoryFilterSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  test('public treemap endpoint uses anon-scoped reads instead of service-role reads', () => {
    const treemapSource = source('lib/public-insights/treemap.ts');
    const treemapRouteSource = source('app/api/insights/treemap/route.ts');

    expect(treemapRouteSource).toContain('getInsightTreemapData(period, { filterByPeriod, metricMode })');
    expect(treemapSource).toContain('function createPublicTreemapSupabaseClient()');
    expect(treemapSource).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(treemapSource).toContain('MAX_PUBLIC_TREEMAP_ROWS = 500');
    expect(treemapSource).toContain('while (rows.length < MAX_PUBLIC_TREEMAP_ROWS)');
    expect(treemapSource).not.toContain('createSupabaseServiceRoleClient');
    expect(treemapSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
