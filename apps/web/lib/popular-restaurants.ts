import { mergeRestaurants } from '@/hooks/use-restaurants';
import { supabase } from '@/integrations/supabase/client';
import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
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

const RESTAURANT_ADDRESS_FIELDS = [
  'road_address',
  'jibun_address',
  'english_address',
] as const;

const RESTAURANT_REGION_ADDRESS_KEYWORDS: Record<string, readonly string[]> = {
  서울특별시: ['서울특별시', '서울시', '서울'],
  부산광역시: ['부산광역시', '부산시', '부산'],
  대구광역시: ['대구광역시', '대구시', '대구'],
  인천광역시: ['인천광역시', '인천시', '인천'],
  광주광역시: ['광주광역시', '광주시', '광주'],
  대전광역시: ['대전광역시', '대전시', '대전'],
  울산광역시: ['울산광역시', '울산시', '울산'],
  세종특별자치시: ['세종특별자치시', '세종시', '세종'],
  경기도: ['경기도', '경기'],
  강원특별자치도: ['강원특별자치도', '강원도', '강원'],
  충청북도: ['충청북도', '충북'],
  충청남도: ['충청남도', '충남'],
  전북특별자치도: ['전북특별자치도', '전라북도', '전북'],
  전라남도: ['전라남도', '전남'],
  경상북도: ['경상북도', '경북'],
  경상남도: ['경상남도', '경남'],
  제주특별자치도: ['제주특별자치도', '제주도', '제주'],
  울릉도: ['울릉도', '울릉군', '울릉'],
  욕지도: ['욕지도', '욕지'],
};

const KOREAN_RESTAURANT_ADDRESS_KEYWORDS = Array.from(
  new Set(
    Object.values(RESTAURANT_REGION_ADDRESS_KEYWORDS)
      .flat()
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  ),
);

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
export function excludeRestaurantsAlreadyShown<T extends { id: string }>(
  restaurants: readonly T[],
  alreadyShownIds: ReadonlySet<string>,
): T[] {
  const seenRestaurantIds = new Set<string>();
  const remaining: T[] = [];

  for (const restaurant of restaurants) {
    if (seenRestaurantIds.has(restaurant.id)) continue;
    seenRestaurantIds.add(restaurant.id);
    if (alreadyShownIds.has(restaurant.id)) continue;
    remaining.push(restaurant);
  }

  if (remaining.length > 0) return remaining;

  seenRestaurantIds.clear();
  const fallback: T[] = [];
  for (const restaurant of restaurants) {
    if (seenRestaurantIds.has(restaurant.id)) continue;
    seenRestaurantIds.add(restaurant.id);
    fallback.push(restaurant);
  }
  return fallback;
}


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


type RestaurantListArgs = {
  limit: number;
  fetchLimit?: number;
  selectedRegion?: string | null;
  isKoreanOnly?: boolean;
  sort?: LatestRestaurantSort;
};

type LatestRestaurantPageArgs = Omit<RestaurantListArgs, 'limit'> & {
  fetchLimit: number;
  offset?: number;
};

export type LatestRestaurantPage = {
  restaurants: Restaurant[];
  nextOffset: number | null;
  hasMore: boolean;
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

const uniqueAddressKeywords = (keywords: readonly string[]) =>
  Array.from(
    new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)),
  );

export function getRestaurantRegionAddressKeywords(
  selectedRegion: string | null | undefined,
) {
  const normalizedRegion = selectedRegion?.trim();
  if (!normalizedRegion) return [];

  const domesticKeywords =
    RESTAURANT_REGION_ADDRESS_KEYWORDS[normalizedRegion];
  if (domesticKeywords) return uniqueAddressKeywords(domesticKeywords);

  const overseasRegion = OVERSEAS_REGIONS[normalizedRegion];
  if (overseasRegion) {
    return uniqueAddressKeywords([
      overseasRegion.country,
      ...overseasRegion.keywords,
    ]);
  }

  const overseasCountryKeywords = Object.values(OVERSEAS_REGIONS)
    .filter(
      (region) =>
        region.country === normalizedRegion ||
        region.label.startsWith(`${normalizedRegion}(`),
    )
    .flatMap((region) => [region.country, ...region.keywords]);
  if (overseasCountryKeywords.length > 0) {
    return uniqueAddressKeywords(overseasCountryKeywords);
  }

  return uniqueAddressKeywords([normalizedRegion]);
}

const isApprovedRestaurant = (restaurant: Restaurant) =>
  restaurant.status === 'approved';

export const matchesRestaurantAddressContext = (
  restaurant: Restaurant,
  selectedRegion: string | null | undefined,
  isKoreanOnly: boolean,
) => {
  const address = [
    restaurant.road_address,
    restaurant.jibun_address,
    restaurant.english_address,
  ]
    .filter(Boolean)
    .join(' ');

  const selectedRegionKeywords =
    getRestaurantRegionAddressKeywords(selectedRegion);
  if (
    selectedRegionKeywords.length > 0 &&
    !selectedRegionKeywords.some((keyword) => address.includes(keyword))
  ) {
    return false;
  }

  if (!isKoreanOnly) return true;

  return KOREAN_RESTAURANT_ADDRESS_KEYWORDS.some((keyword) =>
    address.includes(keyword),
  );
};

const escapePostgrestLikePattern = (value: string) =>
  value.replace(/[%_]/g, (character) => `\\${character}`);

const normalizePostgrestOrTerm = (term: string) =>
  escapePostgrestLikePattern(term).replace(/[(),]/g, ' ').trim();

export function buildRestaurantRegionAddressOrFilter(
  selectedRegion: string | null | undefined,
  wildcard: '%' | '*' = '%',
) {
  const keywords = getRestaurantRegionAddressKeywords(selectedRegion)
    .map(normalizePostgrestOrTerm)
    .filter(Boolean);

  if (keywords.length === 0) return null;

  return keywords
    .flatMap((keyword) =>
      RESTAURANT_ADDRESS_FIELDS.map(
        (field) => `${field}.ilike.${wildcard}${keyword}${wildcard}`,
      ),
    )
    .join(',');
}

const applyRestaurantRegionAddressFilter = <T>(
  query: T & { or: (filters: string) => T },
  selectedRegion: string | null | undefined,
) => {
  const regionAddressFilter =
    buildRestaurantRegionAddressOrFilter(selectedRegion);

  return regionAddressFilter ? query.or(regionAddressFilter) : query;
};

const isPopularRankSnapshotsTable = (
  value: unknown,
): value is PopularRankSnapshotTable =>
  typeof value === 'object'
  && value !== null
  && 'select' in value
  && typeof value.select === 'function';

const getPopularRankSnapshotsTable = (): PopularRankSnapshotTable => {
  const client: { from?: unknown } = supabase;
  if (typeof client.from !== 'function') {
    throw new Error('POPULAR_RANK_SNAPSHOTS_UNAVAILABLE');
  }

  const table: unknown = client.from('restaurant_popular_rank_snapshots');
  if (!isPopularRankSnapshotsTable(table)) {
    throw new Error('POPULAR_RANK_SNAPSHOTS_UNAVAILABLE');
  }

  return table;
};
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

async function fetchRegionalPopularBackfillRestaurants({
  fetchLimit,
  selectedRegion,
  isKoreanOnly = false,
}: Pick<
  RestaurantListArgs,
  'fetchLimit' | 'selectedRegion' | 'isKoreanOnly'
>): Promise<Restaurant[]> {
  if (!selectedRegion) return [];

  const query = supabase
    .from('restaurants')
    .select(POPULAR_RESTAURANT_SELECT)
    .eq('status', 'approved');
  const regionScopedQuery = applyRestaurantRegionAddressFilter(
    query,
    selectedRegion,
  );
  const { data, error } = await regionScopedQuery
    .order('review_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(fetchLimit ?? 20)
    .overrideTypes<Restaurant[], { merge: false }>();

  if (error) throw error;

  return mergeRestaurants(data ?? [])
    .filter(isApprovedRestaurant)
    .filter((restaurant) =>
      matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
    )
    .sort((a, b) => {
      const reviewDelta = (b.review_count ?? 0) - (a.review_count ?? 0);
      if (reviewDelta !== 0) return reviewDelta;

      const bTime = Date.parse(b.created_at ?? b.updated_at ?? '') || 0;
      const aTime = Date.parse(a.created_at ?? a.updated_at ?? '') || 0;
      return bTime - aTime;
    });
}

export async function fetchPopularRestaurants({
  limit,
  fetchLimit = Math.max(limit * 4, 12),
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs): Promise<PopularRestaurantWithTrend[]> {
  const query = supabase
    .from('restaurants')
    .select(POPULAR_RESTAURANT_SELECT)
    .eq('status', 'approved')
    .gt('weekly_search_count', 0);
  const regionScopedQuery = applyRestaurantRegionAddressFilter(
    query,
    selectedRegion,
  );
  const { data, error } = await regionScopedQuery
    .order('weekly_search_count', { ascending: false })
    .limit(fetchLimit)
    .overrideTypes<Restaurant[], { merge: false }>();

  if (error) throw error;

  const restaurants = mergeRestaurants(data ?? [])
    .filter(isApprovedRestaurant)
    .filter((restaurant) =>
      matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
    )
    .sort(
      (a, b) => (b.weekly_search_count ?? 0) - (a.weekly_search_count ?? 0),
    )
    .slice(0, limit);

  if (selectedRegion && restaurants.length < limit) {
    const existingIds = new Set(restaurants.map((restaurant) => restaurant.id));
    const backfillRestaurants = await fetchRegionalPopularBackfillRestaurants({
      fetchLimit,
      selectedRegion,
      isKoreanOnly,
    });

    restaurants.push(
      ...backfillRestaurants
        .filter((restaurant) => !existingIds.has(restaurant.id))
        .slice(0, limit - restaurants.length),
    );
  }

  try {
    const { snapshots, hasSnapshotPeriod } = await fetchPopularRankSnapshots({
      limit,
      selectedRegion,
      isKoreanOnly,
    });

    return attachPopularRankTrends(restaurants, snapshots, hasSnapshotPeriod);
  } catch (error) {
    console.warn('인기 맛집 순위 스냅샷 조회 실패:');
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
  const regionScopedQuery = applyRestaurantRegionAddressFilter(
    query,
    selectedRegion,
  );
  const orderedQuery =
    sort === 'popular'
      ? regionScopedQuery
          .order('weekly_search_count', { ascending: false })
          .order('created_at', { ascending: false })
      : regionScopedQuery.order('created_at', { ascending: sort === 'oldest' });
  const { data, error } = await orderedQuery
    .limit(fetchLimit)
    .overrideTypes<Restaurant[], { merge: false }>();

  if (error) throw error;

  return mergeRestaurants(data ?? [])
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

export async function fetchLatestRestaurantPage({
  fetchLimit,
  offset = 0,
  selectedRegion,
  isKoreanOnly = false,
  sort = 'latest',
}: LatestRestaurantPageArgs): Promise<LatestRestaurantPage> {
  const pageSize = Math.max(1, fetchLimit);
  const pageOffset = Math.max(0, offset);
  const query = supabase
    .from('restaurants')
    .select(POPULAR_RESTAURANT_SELECT)
    .eq('status', 'approved');
  const regionScopedQuery = applyRestaurantRegionAddressFilter(
    query,
    selectedRegion,
  );
  const orderedQuery =
    sort === 'popular'
      ? regionScopedQuery
          .order('weekly_search_count', { ascending: false })
          .order('created_at', { ascending: false })
      : regionScopedQuery.order('created_at', { ascending: sort === 'oldest' });
  const { data, error } = await orderedQuery
    .range(
      pageOffset,
      pageOffset + pageSize - 1,
    )
    .overrideTypes<Restaurant[], { merge: false }>();

  if (error) throw error;

  const rawRestaurants = data ?? [];
  const restaurants = mergeRestaurants(rawRestaurants)
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
    });
  const hasMore = rawRestaurants.length === pageSize;

  return {
    restaurants,
    nextOffset: hasMore ? pageOffset + pageSize : null,
    hasMore,
  };
}
