import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider, QueryObserver, type QueryObserverOptions } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import DesktopLeftPanelMapHome from '../components/home/DesktopLeftPanelMapHome';
import {
  attachPopularRankTrends,
  fetchLatestRestaurantPage,
  fetchPopularRankSnapshots,
  fetchPopularRestaurants,
  getLatestRestaurantsQueryKey,
  getPopularRankSnapshotsQueryKey,
  getPopularRestaurantsQueryKey,
  POPULAR_RESTAURANTS_QUERY_KEY,
  type PopularRankSnapshotResult,
  type PopularRestaurantWithTrend,
} from '../lib/popular-restaurants';
import type { Restaurant } from '../types/restaurant';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const args = { limit: 5, selectedRegion: '서울특별시', isKoreanOnly: true };
const rows = [
  { id: 'low', approved_name: '낮은 식당', name: '낮은 식당', road_address: '서울특별시 종로구 가상길 2', weekly_search_count: 2 },
  { id: 'high', approved_name: '높은 식당', name: '높은 식당', road_address: '서울특별시 중구 가상길 1', weekly_search_count: 40 },
].map((row) => ({ ...row, status: 'approved', categories: [], review_count: 0 } as Restaurant));
const snapshotRows = [
  { restaurant_id: 'high', rank: 3, weekly_search_count: 20, captured_at: null },
  { restaurant_id: 'low', rank: 1, weekly_search_count: 3, captured_at: null },
];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const originalFetch = globalThis.fetch;
const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let requests: URL[];
let snapshotResponse: () => Promise<Response>;
let restaurantResponse: (url: URL) => Response;
const clients: QueryClient[] = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://deferred-trend-test.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'unit-fixture-only';
  requests = [];
  snapshotResponse = async () => json([{ period_start: '2026-01-01' }]);
  restaurantResponse = () => json(rows);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== 'deferred-trend-test.invalid') throw new Error('UNEXPECTED_TEST_ORIGIN');
    requests.push(url);
    if (url.pathname === '/rest/v1/restaurants') return restaurantResponse(url);
    if (url.pathname === '/rest/v1/reviews') return json([]);
    if (url.pathname === '/rest/v1/restaurant_popular_rank_snapshots') {
      return url.searchParams.get('select') === 'period_start'
        ? snapshotResponse()
        : json(snapshotRows);
    }
    throw new Error('UNEXPECTED_TEST_ENDPOINT');
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
  clients.splice(0).forEach((client) => client.clear());
});

function clientWithList(list?: PopularRestaurantWithTrend[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  clients.push(client);
  if (list) client.setQueryData(getPopularRestaurantsQueryKey({ ...args, includeRankTrends: false }), list);
  client.setQueryData(getLatestRestaurantsQueryKey({ ...args, limit: 12, sort: 'latest' }), {
    pages: [{ restaurants: [], nextOffset: null, hasMore: false }], pageParams: [0],
  });
  return client;
}

function renderHome(client: QueryClient, selectedRegion = args.selectedRegion) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DesktopLeftPanelMapHome selectedRegion={selectedRegion} isKoreanOnly onRestaurantOpen={() => {}} />
    </QueryClientProvider>,
  );
}

describe('home deferred popularity trends', () => {
  test('the actual home query stays disabled until primary data is ready and starts after readiness', async () => {
    const client = clientWithList();
    const queryKey = getPopularRankSnapshotsQueryKey(args);
    const optionsFromHome = () => {
      renderHome(client);
      const query = client.getQueryCache().find({ queryKey });
      if (!query) throw new Error('HOME_SNAPSHOT_QUERY_MISSING');
      return query.options as QueryObserverOptions<PopularRankSnapshotResult>;
    };
    const observer = new QueryObserver(client, optionsFromHome());
    const unsubscribe = observer.subscribe(() => {});
    try {
      await Promise.resolve();
      expect(requests).toHaveLength(0);
      const list = await fetchPopularRestaurants({ ...args, includeRankTrends: false });
      client.setQueryData(getPopularRestaurantsQueryKey({ ...args, includeRankTrends: false }), list);
      const started = deferred<void>();
      snapshotResponse = async () => { started.resolve(); return json([]); };
      observer.setOptions(optionsFromHome());
      await started.promise;
      expect(requests.filter((request) => request.pathname.endsWith('restaurant_popular_rank_snapshots'))).toHaveLength(1);
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  test('returns and renders the primary list while snapshots are pending, then adds badges without reordering', async () => {
    const gate = deferred<Response>();
    snapshotResponse = () => gate.promise;
    const list = await fetchPopularRestaurants({ ...args, includeRankTrends: false });
    expect(requests.some((request) => request.pathname.endsWith('restaurant_popular_rank_snapshots'))).toBe(false);
    expect(list.map((row) => row.id)).toEqual(['high', 'low']);
    const client = clientWithList(list);
    const pending = client.fetchQuery({ queryKey: getPopularRankSnapshotsQueryKey(args), queryFn: () => fetchPopularRankSnapshots(args) });
    try {
      const before = renderHome(client);
      expect(before).toContain('높은 식당 인기 맛집 상세 보기');
      expect(before).toContain('낮은 식당 인기 맛집 상세 보기');
      expect(before).not.toContain('인기 검색 맛집 로딩 중');
      expect(before).not.toContain('이전 인기 검색 스냅샷 대비');
    } finally {
      gate.resolve(json([{ period_start: '2026-01-01' }]));
    }
    const snapshot = await pending;
    const after = renderHome(client);
    expect(after).toContain('이전 인기 검색 스냅샷 대비 2위 상승');
    expect(after).toContain('이전 인기 검색 스냅샷 대비 1위 하락');
    expect(after.indexOf('높은 식당 인기 맛집 상세 보기')).toBeLessThan(after.indexOf('낮은 식당 인기 맛집 상세 보기'));
    expect(attachPopularRankTrends(list, snapshot.snapshots, snapshot.hasSnapshotPeriod).map((row) => row.id)).toEqual(list.map((row) => row.id));
    expect(list.every((row) => row.popularRankTrend?.trend === 'unknown')).toBe(true);
  });

  test.each([401, 403])('snapshot %s denial preserves the rendered primary list and default API fallback', async (status) => {
    snapshotResponse = async () => json({ code: '42501' }, status);
    const list = await fetchPopularRestaurants({ ...args, includeRankTrends: false });
    const client = clientWithList(list);
    await expect(client.fetchQuery({ queryKey: getPopularRankSnapshotsQueryKey(args), queryFn: () => fetchPopularRankSnapshots(args) }))
      .rejects.toThrow(`supabase_rest_rows_failed:${status}`);
    const html = renderHome(client);
    expect(html).toContain('높은 식당 인기 맛집 상세 보기');
    expect(html).not.toContain('인기 검색 맛집 로딩 중');
    expect(html).not.toContain('이전 인기 검색 스냅샷 대비');
    const legacy = await fetchPopularRestaurants(args);
    expect(legacy.map((row) => row.id)).toEqual(list.map((row) => row.id));
    expect(legacy.every((row) => row.popularRankTrend?.trend === 'unknown')).toBe(true);
  });

  test('default API still waits for snapshots and returns normal trend metadata', async () => {
    const gate = deferred<Response>();
    const started = deferred<void>();
    snapshotResponse = () => { started.resolve(); return gate.promise; };
    let settled = false;
    const pending = fetchPopularRestaurants(args).then((list) => { settled = true; return list; });
    await started.promise;
    try { expect(settled).toBe(false); }
    finally { gate.resolve(json([{ period_start: '2026-01-01' }])); }
    const list = await pending;
    expect(list.map((row) => row.popularRankTrend?.trend)).toEqual(['up', 'down']);
  });

  test('separates home and default caches, keeps prefix invalidation, and scopes snapshots by region and limit', async () => {
    const legacy = getPopularRestaurantsQueryKey(args);
    const home = getPopularRestaurantsQueryKey({ ...args, includeRankTrends: false });
    expect(legacy).toEqual([...POPULAR_RESTAURANTS_QUERY_KEY, 5, '서울특별시', 'korean']);
    expect(getPopularRestaurantsQueryKey({ ...args, includeRankTrends: true })).toEqual(legacy);
    expect(home).not.toEqual(legacy);
    expect(getPopularRankSnapshotsQueryKey(args)).not.toEqual(getPopularRankSnapshotsQueryKey({ ...args, selectedRegion: '부산광역시' }));
    expect(getPopularRankSnapshotsQueryKey(args)).not.toEqual(getPopularRankSnapshotsQueryKey({ ...args, limit: 10 }));
    expect(getPopularRankSnapshotsQueryKey(args)).not.toEqual(getPopularRankSnapshotsQueryKey({ ...args, isKoreanOnly: false }));
    const client = clientWithList([]);
    client.setQueryData(legacy, []);
    await client.invalidateQueries({ queryKey: POPULAR_RESTAURANTS_QUERY_KEY });
    expect(client.getQueryState(home)?.isInvalidated).toBe(true);
    expect(client.getQueryState(legacy)?.isInvalidated).toBe(true);
  });

  test('late snapshots from a different region cannot decorate the current home list', async () => {
    const list = await fetchPopularRestaurants({ ...args, includeRankTrends: false });
    const client = clientWithList(list);
    const snapshot = await fetchPopularRankSnapshots(args);
    client.setQueryData(getPopularRankSnapshotsQueryKey({ ...args, selectedRegion: '부산광역시' }), snapshot);
    expect(renderHome(client)).not.toContain('이전 인기 검색 스냅샷 대비');
    client.setQueryData(getPopularRankSnapshotsQueryKey(args), snapshot);
    expect(renderHome(client)).toContain('이전 인기 검색 스냅샷 대비 2위 상승');
  });

  test('retains scope filters and regional backfill membership in both API modes', async () => {
    const foreign = { ...rows[1], id: 'foreign', approved_name: '해외 식당', name: '해외 식당', road_address: '일본 Osaka', weekly_search_count: 100 };
    restaurantResponse = (url) => json(url.searchParams.has('weekly_search_count') ? [rows[1], foreign] : rows);
    const base = await fetchPopularRestaurants({ ...args, includeRankTrends: false });
    const legacy = await fetchPopularRestaurants(args);
    expect(base.map((row) => row.id)).toEqual(['high', 'low']);
    expect(legacy.map((row) => row.id)).toEqual(base.map((row) => row.id));
    expect(new Set(base.map((row) => row.id)).size).toBe(base.length);
    expect(requests.filter((url) => url.pathname.endsWith('/restaurants')).every((url) => url.searchParams.get('or')?.includes('서울'))).toBe(true);
  });

  test('does not change latest-list raw-page continuation or ordering', async () => {
    const page = await fetchLatestRestaurantPage({ ...args, fetchLimit: 2, offset: 4, sort: 'popular' });
    expect(page.restaurants.map((row) => row.id)).toEqual(['high', 'low']);
    expect(page.nextOffset).toBe(6);
    expect(page.hasMore).toBe(true);
    expect(requests.some((url) => url.pathname.endsWith('restaurant_popular_rank_snapshots'))).toBe(false);
    restaurantResponse = () => json([]);
    const empty = await fetchLatestRestaurantPage({ ...args, fetchLimit: 2, offset: 6 });
    expect(empty).toEqual({ restaurants: [], nextOffset: null, hasMore: false });
  });
});
