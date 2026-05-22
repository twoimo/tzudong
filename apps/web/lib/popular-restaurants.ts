import { mergeRestaurants } from '@/hooks/use-restaurants';
import { supabase } from '@/integrations/supabase/client';
import type { Restaurant } from '@/types/restaurant';

export const POPULAR_RESTAURANTS_QUERY_KEY = ['popular-searches-weekly'] as const;
export const LATEST_RESTAURANTS_QUERY_KEY = ['latest-restaurants'] as const;
export const POPULAR_RANK_SNAPSHOTS_QUERY_KEY = [
  'popular-rank-snapshots',
] as const;

export const KOREAN_RESTAURANT_REGIONS = [
  '서울특별시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '광주광역시',
  '대전광역시',
  '울산광역시',
  '세종특별자치시',
  '경기도',
  '강원특별자치도',
  '충청북도',
  '충청남도',
  '전북특별자치도',
  '전라남도',
  '경상북도',
  '경상남도',
  '제주특별자치도',
] as const;

export const POPULAR_RESTAURANT_SELECT =
  'id, name:approved_name, approved_name, lat, lng, road_address, jibun_address, english_address, categories, phone, review_count, youtube_link, tzuyang_review, youtube_meta, status, created_at, updated_at, weekly_search_count, reasoning_basis';

export type LatestRestaurantSort = 'latest' | 'oldest' | 'popular';
export type PopularRankTrendState = 'up' | 'down' | 'same' | 'new' | 'unknown';

export type PopularRankTrend = {
  currentRank: number;
  previousRank: number | null;
  rankDelta: number | null;
  trend: PopularRankTrendState;
  previousWeeklySearchCount: number | null;
  weeklySearchCountDelta: number | null;
  snapshotCapturedAt: string | null;
};

export type PopularRestaurantWithTrend = Restaurant & {
  popularRankTrend?: PopularRankTrend;
};

type PopularRankSnapshotRow = {
  restaurant_id: string;
  rank: number;
  weekly_search_count: number;
  captured_at: string | null;
};

type PopularRankSnapshotPeriodRow = {
  period_start: string;
};

type PopularRankSnapshotResult = {
  snapshots: Map<string, PopularRankSnapshotRow>;
  hasSnapshotPeriod: boolean;
};

type SupabaseQueryError = {
  message?: string;
};

type SupabaseQueryResult<T> = {
  data: T | null;
  error: SupabaseQueryError | null;
};

type PopularRankSnapshotQuery<T> = {
  eq: (
    column: string,
    value: string | number | boolean | null,
  ) => PopularRankSnapshotQuery<T>;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => PopularRankSnapshotQuery<T>;
  limit: (count: number) => PopularRankSnapshotQuery<T>;
  maybeSingle: () => Promise<SupabaseQueryResult<T>>;
  then: <TResult1 = SupabaseQueryResult<T[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: SupabaseQueryResult<T[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

type PopularRankSnapshotTable = {
  select: <T>(columns: string) => PopularRankSnapshotQuery<T>;
};

type PopularRankSnapshotClient = {
  from: (table: 'restaurant_popular_rank_snapshots') => PopularRankSnapshotTable;
};

type RestaurantListArgs = {
  limit: number;
  fetchLimit?: number;
  selectedRegion?: string | null;
  isKoreanOnly?: boolean;
  sort?: LatestRestaurantSort;
};

export const getPopularRestaurantsQueryKey = ({
  limit,
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs) => [
  ...POPULAR_RESTAURANTS_QUERY_KEY,
  limit,
  selectedRegion ?? 'all',
  isKoreanOnly ? 'korean' : 'global',
];

export const getPopularRankScopeKey = ({
  selectedRegion,
  isKoreanOnly = false,
}: Pick<RestaurantListArgs, 'selectedRegion' | 'isKoreanOnly'>) =>
  `${isKoreanOnly ? 'domestic' : 'global'}:${selectedRegion ?? 'all'}`;

export const getPopularRankSnapshotsQueryKey = ({
  limit,
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs) => [
  ...POPULAR_RANK_SNAPSHOTS_QUERY_KEY,
  limit,
  getPopularRankScopeKey({ selectedRegion, isKoreanOnly }),
];

export const getLatestRestaurantsQueryKey = ({
  limit,
  selectedRegion,
  isKoreanOnly = false,
  sort = 'latest',
}: RestaurantListArgs) => [
  ...LATEST_RESTAURANTS_QUERY_KEY,
  limit,
  sort,
  selectedRegion ?? 'all',
  isKoreanOnly ? 'korean' : 'global',
];

const isApprovedRestaurant = (restaurant: Restaurant) =>
  restaurant.status === 'approved';

const matchesRestaurantAddressContext = (
  restaurant: Restaurant,
  selectedRegion: string | null | undefined,
  isKoreanOnly: boolean,
) => {
  const address =
    restaurant.road_address ||
    restaurant.jibun_address ||
    restaurant.english_address ||
    '';

  if (selectedRegion && !address.includes(selectedRegion)) return false;

  if (!isKoreanOnly) return true;

  return KOREAN_RESTAURANT_REGIONS.some((region) => address.includes(region));
};

const getPopularRankSnapshotsTable = () =>
  (supabase as unknown as PopularRankSnapshotClient).from(
    'restaurant_popular_rank_snapshots',
  );

const fetchPopularRankSnapshots = async ({
  limit,
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs) => {
  const scopeKey = getPopularRankScopeKey({ selectedRegion, isKoreanOnly });
  const table = getPopularRankSnapshotsTable();

  const { data: latestPeriod, error: latestPeriodError } = await table
    .select<PopularRankSnapshotPeriodRow>('period_start')
    .eq('scope_key', scopeKey)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestPeriodError) throw latestPeriodError;
  if (!latestPeriod?.period_start) {
    return {
      snapshots: new Map<string, PopularRankSnapshotRow>(),
      hasSnapshotPeriod: false,
    } satisfies PopularRankSnapshotResult;
  }

  const { data, error } = await table
    .select<PopularRankSnapshotRow>(
      'restaurant_id, rank, weekly_search_count, captured_at',
    )
    .eq('scope_key', scopeKey)
    .eq('period_start', latestPeriod.period_start)
    .order('rank', { ascending: true })
    .limit(Math.max(limit * 4, 20));

  if (error) throw error;

  return {
    snapshots: new Map(
      (data ?? []).map((snapshot) => [snapshot.restaurant_id, snapshot]),
    ),
    hasSnapshotPeriod: true,
  } satisfies PopularRankSnapshotResult;
};

export const attachPopularRankTrends = (
  restaurants: Restaurant[],
  snapshots: Map<string, PopularRankSnapshotRow>,
  hasSnapshotPeriod: boolean,
): PopularRestaurantWithTrend[] =>
  restaurants.map((restaurant, index) => {
    const currentRank = index + 1;
    const snapshot = snapshots.get(restaurant.id);
    const previousRank = hasSnapshotPeriod ? (snapshot?.rank ?? null) : null;
    const rankDelta = previousRank === null ? null : previousRank - currentRank;
    const trend: PopularRankTrendState =
      !hasSnapshotPeriod
        ? 'unknown'
        : rankDelta === null
          ? 'new'
          : rankDelta > 0
          ? 'up'
          : rankDelta < 0
            ? 'down'
            : 'same';
    const previousWeeklySearchCount = hasSnapshotPeriod
      ? (snapshot?.weekly_search_count ?? null)
      : null;
    const weeklySearchCount = restaurant.weekly_search_count ?? 0;

    return {
      ...restaurant,
      popularRankTrend: {
        currentRank,
        previousRank,
        rankDelta,
        trend,
        previousWeeklySearchCount,
        weeklySearchCountDelta:
          previousWeeklySearchCount === null
            ? null
            : weeklySearchCount - previousWeeklySearchCount,
        snapshotCapturedAt: snapshot?.captured_at ?? null,
      },
    };
  });

export async function fetchPopularRestaurants({
  limit,
  fetchLimit = Math.max(limit * 4, 12),
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs): Promise<PopularRestaurantWithTrend[]> {
  const { data, error } = await supabase
    .from('restaurants')
    .select(POPULAR_RESTAURANT_SELECT)
    .eq('status', 'approved')
    .gt('weekly_search_count', 0)
    .order('weekly_search_count', { ascending: false })
    .limit(fetchLimit);

  if (error) throw error;

  const restaurants = mergeRestaurants((data ?? []) as Restaurant[])
    .filter(isApprovedRestaurant)
    .filter((restaurant) =>
      matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
    )
    .sort(
      (a, b) => (b.weekly_search_count ?? 0) - (a.weekly_search_count ?? 0),
    )
    .slice(0, limit);

  try {
    const { snapshots, hasSnapshotPeriod } = await fetchPopularRankSnapshots({
      limit,
      selectedRegion,
      isKoreanOnly,
    });

    return attachPopularRankTrends(restaurants, snapshots, hasSnapshotPeriod);
  } catch (error) {
    console.warn('인기 맛집 순위 스냅샷 조회 실패:', error);
    return attachPopularRankTrends(restaurants, new Map(), false);
  }
}

export async function fetchLatestRestaurants({
  limit,
  fetchLimit = Math.max(limit * 3, 18),
  selectedRegion,
  isKoreanOnly = false,
  sort = 'latest',
}: RestaurantListArgs): Promise<Restaurant[]> {
  const query = supabase
    .from('restaurants')
    .select(POPULAR_RESTAURANT_SELECT)
    .eq('status', 'approved');
  const orderedQuery =
    sort === 'popular'
      ? query
          .order('weekly_search_count', { ascending: false })
          .order('created_at', { ascending: false })
      : query.order('created_at', { ascending: sort === 'oldest' });
  const { data, error } = await orderedQuery.limit(fetchLimit);

  if (error) throw error;

  return mergeRestaurants((data ?? []) as Restaurant[])
    .filter(isApprovedRestaurant)
    .filter((restaurant) =>
      matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
    )
    .sort((a, b) => {
      if (sort === 'popular') {
        const popularityDelta =
          (b.weekly_search_count ?? 0) - (a.weekly_search_count ?? 0);
        if (popularityDelta !== 0) return popularityDelta;
      }

      const bTime = Date.parse(b.created_at ?? b.updated_at ?? '') || 0;
      const aTime = Date.parse(a.created_at ?? a.updated_at ?? '') || 0;
      return sort === 'oldest' ? aTime - bTime : bTime - aTime;
    })
    .slice(0, limit);
}
