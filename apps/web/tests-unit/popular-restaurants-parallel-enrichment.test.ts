import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { enrichRestaurantsWithYouTubeKpiMetrics } from '../lib/home-map-youtube-kpi';
import { fetchPopularRestaurants } from '../lib/popular-restaurants';
import type { Restaurant } from '../types/restaurant';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Return the exact frozen input, so accidental source mutations cannot be
// hidden by JSON cloning at the synthetic transport boundary.
const json = (value: unknown, status = 200): Response =>
  Object.assign(new Response(null, { status }), { json: async () => value });
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const origin = 'https://parallel-enrichment.invalid';
const videoId = 'abcdefghijk';
const metrics = freeze({ metrics: [{
  videoId, title: 'Synthetic KPI', publishedAt: '2026-01-01', duration: 90,
  viewCount: 3_000_000, likeCount: 80_000, commentCount: 6_000,
}] });
const likes = freeze([
  { restaurant_id: 'likes', like_count: 10 },
  { restaurant_id: 'likes', like_count: 20 },
]);
const args = { limit: 5, selectedRegion: '서울특별시', isKoreanOnly: true };

function restaurant(id: string, changes: Partial<Restaurant> = {}): Restaurant {
  return {
    id, approved_name: id, name: id, status: 'approved',
    road_address: `서울특별시 ${id} 합성 주소`, categories: [],
    review_count: 0, weekly_search_count: 10, youtube_link: null, youtube_meta: null,
    ...changes,
  } as Restaurant;
}

let rows: Restaurant[];
let backfillRows: Restaurant[];
let primaryStatus: number;
let requests: URL[];
let kpiResponse: () => Promise<Response>;
let likesResponse: () => Promise<Response>;
let periodResponse: () => Promise<Response>;
const originalFetch = globalThis.fetch;
const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-unit-fixture-only';
  rows = freeze([
    restaurant('tie-b'), restaurant('search', { weekly_search_count: 40 }),
    restaurant('likes'), restaurant('kpi', { weekly_search_count: 2, youtube_link: `https://youtu.be/${videoId}` }),
    restaurant('tie-a'), restaurant('denied', { status: 'pending' }),
    restaurant('foreign', { road_address: '일본 Tokyo 합성 주소' }),
  ]);
  backfillRows = [];
  primaryStatus = 200;
  requests = [];
  kpiResponse = async () => json(metrics);
  likesResponse = async () => json(likes);
  periodResponse = async () => json([]);
  // All reads execute the actual REST/KPI helpers, with only fetch replaced.
  // Unknown endpoints fail locally; no module mock or real connection is used.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin) throw new Error('UNEXPECTED_SYNTHETIC_ORIGIN');
    requests.push(url);
    if (url.pathname === '/api/home/youtube-kpi') return kpiResponse();
    if (url.pathname === '/rest/v1/reviews') return likesResponse();
    if (url.pathname === '/rest/v1/restaurants') {
      return url.searchParams.has('weekly_search_count')
        ? json(rows, primaryStatus) : json(backfillRows);
    }
    if (url.pathname === '/rest/v1/restaurant_popular_rank_snapshots') {
      return url.searchParams.get('select') === 'period_start' ? periodResponse() : json([
        { restaurant_id: 'kpi', rank: 3, weekly_search_count: 1, captured_at: null },
        { restaurant_id: 'search', rank: 1, weekly_search_count: 30, captured_at: null },
      ]);
    }
    throw new Error('UNEXPECTED_SYNTHETIC_ENDPOINT');
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
});

describe('popular restaurants parallel enrichment', () => {
  test('real KPI enrichment preserves IDs, membership, order and frozen source objects', async () => {
    const before = JSON.stringify(rows);
    const enriched = await enrichRestaurantsWithYouTubeKpiMetrics(rows);
    expect(enriched.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(enriched[0]).toBe(rows[0]);
    expect(enriched[3]).not.toBe(rows[3]);
    expect(enriched[3].youtube_meta).toMatchObject({ viewCount: 3_000_000 });
    expect(rows[3].youtube_meta).toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
  });

  for (const first of ['kpi', 'likes'] as const) {
    test(`starts both reads before either resolves; ${first} completes first without partial ranking`, async () => {
      const kpiStarted = deferred<void>();
      const kpi = deferred<Response>();
      const reviewLikes = deferred<Response>();
      let reviewsStarted = false;
      let settled = false;
      kpiResponse = () => { kpiStarted.resolve(); return kpi.promise; };
      likesResponse = () => { reviewsStarted = true; return reviewLikes.promise; };
      const before = JSON.stringify(rows);
      const limit = first === 'kpi' ? 4 : 5;
      const pending = fetchPopularRestaurants({ ...args, limit, includeRankTrends: false })
        .then((result) => { settled = true; return result; });
      try {
        await kpiStarted.promise;
        expect(reviewsStarted).toBe(true);
        expect(settled).toBe(false);
        const reviewRequest = requests.find((url) => url.pathname.endsWith('/reviews'))!;
        const requestedIds = JSON.parse(`[${reviewRequest.searchParams.get('restaurant_id')!.slice(4, -1)}]`);
        expect([...requestedIds].sort()).toEqual(['kpi', 'likes', 'search', 'tie-a', 'tie-b']);
        if (first === 'kpi') kpi.resolve(json(metrics));
        else reviewLikes.resolve(json(likes));
        await nextTurn();
        expect(settled).toBe(false);
        expect(requests.filter((url) => url.pathname.endsWith('/restaurants'))).toHaveLength(1);
        expect(requests.some((url) => url.pathname.endsWith('/restaurant_popular_rank_snapshots'))).toBe(false);
        if (first === 'kpi') reviewLikes.resolve(json(likes));
        else kpi.resolve(json(metrics));
        const result = await pending;
        expect(result.map((row) => row.id)).toEqual(['kpi', 'likes', 'search', 'tie-a', 'tie-b'].slice(0, limit));
        expect(result.every((row) => row.popularRankTrend?.trend === 'unknown')).toBe(true);
        expect(JSON.stringify(rows)).toBe(before);
      } finally {
        // Drain even a deliberately failing serial implementation before the
        // next test restores fetch; no unfinished reads escape this test.
        kpi.resolve(json(metrics)); reviewLikes.resolve(json(likes));
        await pending;
      }
    });
  }

  test('both reads finish before regional backfill; default trends still gate final readiness', async () => {
    rows = freeze([rows[1], rows[3]]);
    backfillRows = freeze([rows[0], restaurant('backfill'), restaurant('outside', { road_address: '부산광역시 합성 주소' })]);
    const before = JSON.stringify({ rows, backfillRows });
    const kpiStarted = deferred<void>();
    const kpi = deferred<Response>();
    const reviewLikes = deferred<Response>();
    const snapshotStarted = deferred<void>();
    const snapshot = deferred<Response>();
    let settled = false;
    kpiResponse = () => { kpiStarted.resolve(); return kpi.promise; };
    likesResponse = () => reviewLikes.promise;
    periodResponse = () => { snapshotStarted.resolve(); return snapshot.promise; };
    const pending = fetchPopularRestaurants({ ...args, limit: 3 })
      .then((result) => { settled = true; return result; });
    try {
      await kpiStarted.promise;
      kpi.resolve(json(metrics));
      await nextTurn();
      expect(requests.filter((url) => url.pathname.endsWith('/restaurants'))).toHaveLength(1);
      expect(settled).toBe(false);
      reviewLikes.resolve(json(likes));
      await snapshotStarted.promise;
      expect(settled).toBe(false);
      const restaurantRequests = requests.filter((url) => url.pathname.endsWith('/restaurants'));
      expect(restaurantRequests).toHaveLength(2);
      expect(restaurantRequests.every((url) => url.searchParams.get('or')?.includes('서울'))).toBe(true);
      snapshot.resolve(json([{ period_start: '2026-01-01' }]));
      const result = await pending;
      expect(result.map((row) => row.id)).toEqual(['kpi', 'search', 'backfill']);
      expect(result.map((row) => row.popularRankTrend?.trend)).toEqual(['up', 'down', 'new']);
      expect(JSON.stringify({ rows, backfillRows })).toBe(before);
    } finally {
      kpi.resolve(json(metrics)); reviewLikes.resolve(json(likes)); snapshot.resolve(json([]));
      await pending;
    }
  });

  for (const failure of ['denied-kpi', 'denied-likes', 'both-rejected'] as const) {
    test(`${failure} keeps the existing complete-list fallback`, async () => {
      const before = JSON.stringify(rows);
      if (failure === 'denied-kpi') kpiResponse = async () => json(null, 403);
      if (failure === 'denied-likes') likesResponse = async () => json(null, 403);
      if (failure === 'both-rejected') {
        kpiResponse = likesResponse = async () => { throw new Error('SYNTHETIC_OFFLINE'); };
      }
      const result = await fetchPopularRestaurants({ ...args, includeRankTrends: false });
      const expected = failure === 'denied-kpi' ? ['likes', 'search', 'tie-a', 'tie-b', 'kpi']
        : failure === 'denied-likes' ? ['kpi', 'search', 'likes', 'tie-a', 'tie-b']
        : ['search', 'likes', 'tie-a', 'tie-b', 'kpi'];
      expect(result.map((row) => row.id)).toEqual(expected);
      expect(result.every((row) => row.popularRankTrend?.trend === 'unknown')).toBe(true);
      expect(JSON.stringify(rows)).toBe(before);
    });
  }

  for (const empty of ['empty', 'fully-filtered'] as const) {
    test(`${empty} cohort makes no enrichment requests`, async () => {
      rows = empty === 'empty' ? [] : freeze([rows[5], rows[6]]);
      expect(await fetchPopularRestaurants({ ...args, includeRankTrends: false })).toEqual([]);
      expect(requests.every((url) => url.pathname.endsWith('/restaurants'))).toBe(true);
    });
  }

  test('denied primary cohort still rejects without enrichment or backfill', async () => {
    primaryStatus = 403;
    await expect(fetchPopularRestaurants(args)).rejects.toThrow('supabase_rest_rows_failed:403');
    expect(requests).toHaveLength(1);
  });
});
