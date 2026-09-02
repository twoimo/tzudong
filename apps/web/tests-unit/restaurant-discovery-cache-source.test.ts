import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('restaurant discovery cache invalidation contract', () => {
  test('admin approval/update/delete invalidates every public map and search surface', () => {
    const cacheSource = source('lib/restaurant-discovery-cache.ts');
    const adminSource = source('app/admin/evaluations/admin-evaluation-page.tsx');

    expect(cacheSource).toContain("RESTAURANT_SEARCH_QUERY_KEY_PREFIX = [");
    expect(cacheSource).toContain("'restaurant-search'");
    expect(cacheSource).toContain("RESTAURANTS_QUERY_KEY_PREFIX = ['restaurants']");
    expect(cacheSource).toContain("'mobile-control-restaurants'");
    expect(cacheSource).toContain("'global-restaurants-count'");
    expect(cacheSource).toContain("'all-restaurants'");
    expect(cacheSource).toContain("'unvisited-restaurants-all'");
    expect(cacheSource).toContain('POPULAR_RESTAURANTS_QUERY_KEY');
    expect(cacheSource).toContain('LATEST_RESTAURANTS_QUERY_KEY');
    expect(cacheSource).toContain('POPULAR_RANK_SNAPSHOTS_QUERY_KEY');
    expect(cacheSource).toContain('queryClient.invalidateQueries({ queryKey })');
    expect(cacheSource).toContain('RESTAURANT_DISCOVERY_INVALIDATED_EVENT');
    expect(cacheSource).toContain(
      'RESTAURANT_DISCOVERY_INVALIDATED_STORAGE_KEY',
    );
    expect(cacheSource).toContain(
      'window.dispatchEvent(new Event(RESTAURANT_DISCOVERY_INVALIDATED_EVENT))',
    );
    expect(cacheSource).toContain('window.localStorage.setItem(');

    expect(adminSource).toContain(
      "import { invalidateRestaurantDiscoveryQueries } from '@/lib/restaurant-discovery-cache';",
    );
    expect(
      adminSource.match(/invalidateRestaurantDiscoveryQueries\(queryClient\)/g)
        ?.length ?? 0,
    ).toBeGreaterThanOrEqual(8);
    expect(adminSource).not.toContain(
      "queryClient.invalidateQueries({ queryKey: ['restaurants'] });",
    );
  });

  test('desktop and mobile search refetches stale empty results instead of waiting for refresh', () => {
    const searchSource = source('components/search/RestaurantSearch.tsx');

    expect(searchSource).toContain('RESTAURANT_SEARCH_QUERY_KEY_PREFIX');
    expect(searchSource).toContain('RESTAURANT_DISCOVERY_INVALIDATED_EVENT');
    expect(searchSource).toContain(
      'RESTAURANT_DISCOVERY_INVALIDATED_STORAGE_KEY',
    );
    expect(searchSource).toContain('...RESTAURANT_SEARCH_QUERY_KEY_PREFIX');
    expect(searchSource).toContain('staleTime: 0');
    expect(searchSource).toContain('refetchOnMount: "always"');
    expect(searchSource).toContain('refetchOnWindowFocus: true');
    expect(searchSource).toContain('refetchOnReconnect: true');
    expect(searchSource).toContain('window.addEventListener("storage", handleStorage)');
    expect(searchSource).toContain('queryClient.invalidateQueries({');
    expect(searchSource).toContain('queryKey: RESTAURANT_SEARCH_QUERY_KEY_PREFIX');
    expect(searchSource).not.toContain('staleTime: 1000 * 60 * 5, // 5분간 캐시');
  });
});
