import { mergeRestaurants } from '@/hooks/use-restaurants';
import { fetchSupabaseRows, postgrestIn } from '@/lib/supabase-rest-client';
import { comparePopularRestaurants } from '@/lib/popular-restaurant-score';
import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
import { sanitizePostgrestOrTerm } from '@/lib/overseas-region-matching';
import type { Restaurant } from '@/types/restaurant';

export const POPULAR_RESTAURANTS_QUERY_KEY = ['popular-searches-composite-v1'] as const;
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
  'id, name:approved_name, approved_name, lat, lng, road_address, jibun_address, english_address, categories, phone, review_count, youtube_link, tzuyang_review, youtube_meta, status, created_at, updated_at, weekly_search_count';

export type LatestRestaurantSort = 'latest' | 'oldest' | 'popular';

export function latestRestaurantSortTime(
  restaurant: Pick<Restaurant, 'created_at' | 'updated_at' | 'youtube_meta'>,
  sort: LatestRestaurantSort,
): number {
  if (sort === 'popular') {
    return Date.parse(restaurant.created_at ?? restaurant.updated_at ?? '') || 0;
  }

  const meta = restaurant.youtube_meta;
  const publishedAt =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as { publishedAt?: unknown }).publishedAt
      : undefined;
  const publishedTime =
    typeof publishedAt === 'string' ? Date.parse(publishedAt) : Number.NaN;
  if (Number.isFinite(publishedTime)) return publishedTime;
  return sort === 'oldest' ? Number.POSITIVE_INFINITY : 0;
}
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

export function buildRestaurantRegionAddressOrFilter(
  selectedRegion: string | null | undefined,
  wildcard: '%' | '*' = '%',
) {
  const keywords = getRestaurantRegionAddressKeywords(selectedRegion)
    .map(sanitizePostgrestOrTerm)
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

type RestQuery = Array<[string, string | number | boolean]>;

const applyRestaurantRegionAddressFilter = (
  query: RestQuery,
  selectedRegion: string | null | undefined,
): RestQuery => {
  const regionAddressFilter =
    buildRestaurantRegionAddressOrFilter(selectedRegion);

  return regionAddressFilter ? [...query, ['or', `(${regionAddressFilter})`]] : query;
};

// Rank snapshots are a public read, so they use the REST client instead of the auth browser client.
const fetchPopularRankSnapshots = async ({
  limit,
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs) => {
  const scopeKey = getPopularRankScopeKey({ selectedRegion, isKoreanOnly });
  const periods = await fetchSupabaseRows<PopularRankSnapshotPeriodRow>(
    'restaurant_popular_rank_snapshots',
    [
      ['select', 'period_start'],
      ['scope_key', `eq.${scopeKey}`],
      ['order', 'period_start.desc'],
      ['limit', 1],
    ],
  );
  const latestPeriod = periods[0];
  if (!latestPeriod?.period_start) {
    return {
      snapshots: new Map<string, PopularRankSnapshotRow>(),
      hasSnapshotPeriod: false,
    } satisfies PopularRankSnapshotResult;
  }

  const data = await fetchSupabaseRows<PopularRankSnapshotRow>(
    'restaurant_popular_rank_snapshots',
    [
      ['select', 'restaurant_id, rank, weekly_search_count, captured_at'],
      ['scope_key', `eq.${scopeKey}`],
      ['period_start', `eq.${latestPeriod.period_start}`],
      ['order', 'rank.asc'],
      ['limit', Math.max(limit * 4, 20)],
    ],
  );

  return {
    snapshots: new Map(
      data.map((snapshot) => [snapshot.restaurant_id, snapshot]),
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

async function attachPopularYouTubeMetrics(restaurants: Restaurant[]): Promise<Restaurant[]> {
  try {
    const { enrichRestaurantsWithYouTubeKpiMetrics } = await import('@/lib/home-map-youtube-kpi');
    return await enrichRestaurantsWithYouTubeKpiMetrics(restaurants);
  } catch {
    return restaurants;
  }
}

async function fetchReviewLikeTotals(restaurantIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const ids = [...new Set(restaurantIds.filter(Boolean))];
  if (ids.length === 0) return totals;

  let data: Array<{ restaurant_id: string | null; like_count: number | null }>;
  try {
    data = await fetchSupabaseRows('reviews', [
      ['select', 'restaurant_id, like_count'],
      ['restaurant_id', postgrestIn(ids)],
    ]);
  } catch {
    return totals;
  }

  for (const row of data) {
    const restaurantId = row.restaurant_id;
    if (!restaurantId) continue;
    totals.set(restaurantId, (totals.get(restaurantId) ?? 0) + (row.like_count ?? 0));
  }

  return totals;
}

async function fetchRegionalPopularBackfillRestaurants({
  fetchLimit,
  selectedRegion,
  isKoreanOnly = false,
}: Pick<
  RestaurantListArgs,
  'fetchLimit' | 'selectedRegion' | 'isKoreanOnly'
>): Promise<Restaurant[]> {
  if (!selectedRegion) return [];

  const data = await fetchSupabaseRows<Restaurant>(
    'restaurants',
    applyRestaurantRegionAddressFilter(
      [
        ['select', POPULAR_RESTAURANT_SELECT],
        ['status', 'eq.approved'],
        ['order', 'review_count.desc'],
        ['order', 'created_at.desc'],
        ['limit', fetchLimit ?? 20],
      ],
      selectedRegion,
    ),
  );

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
  const data = await fetchSupabaseRows<Restaurant>(
    'restaurants',
    applyRestaurantRegionAddressFilter(
      [
        ['select', POPULAR_RESTAURANT_SELECT],
        ['status', 'eq.approved'],
        ['weekly_search_count', 'gt.0'],
        ['order', 'weekly_search_count.desc'],
        ['limit', fetchLimit],
      ],
      selectedRegion,
    ),
  );

  const restaurants = (await attachPopularYouTubeMetrics(
    mergeRestaurants(data ?? [])
      .filter(isApprovedRestaurant)
      .filter((restaurant) =>
        matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
      ),
  ))
    .sort((a, b) => (b.weekly_search_count ?? 0) - (a.weekly_search_count ?? 0));

  const reviewLikesById = await fetchReviewLikeTotals(restaurants.map((restaurant) => restaurant.id));
  restaurants.sort((a, b) => comparePopularRestaurants(a, b, reviewLikesById));
  restaurants.splice(limit);

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

export async function fetchLatestRestaurantPage({
  fetchLimit,
  offset = 0,
  selectedRegion,
  isKoreanOnly = false,
  sort = 'latest',
}: LatestRestaurantPageArgs): Promise<LatestRestaurantPage> {
  const pageSize = Math.max(1, fetchLimit);
  const pageOffset = Math.max(0, offset);
  const data = await fetchSupabaseRows<Restaurant>(
    'restaurants',
    applyRestaurantRegionAddressFilter(
      [
        ['select', POPULAR_RESTAURANT_SELECT],
        ['status', 'eq.approved'],
        ...(sort === 'popular'
          ? ([
              ['order', 'weekly_search_count.desc'],
              ['order', 'created_at.desc'],
            ] as RestQuery)
          : ([
              [
                'order',
                `youtube_meta->>publishedAt.${sort === 'oldest' ? 'asc' : 'desc'}.nullslast`,
              ],
            ] as RestQuery)),
        ['limit', pageSize],
        ['offset', pageOffset],
      ],
      selectedRegion,
    ),
  );

  const rawRestaurants = data ?? [];
  const mergedRestaurants = await attachPopularYouTubeMetrics(
    mergeRestaurants(rawRestaurants)
      .filter(isApprovedRestaurant)
      .filter((restaurant) =>
        matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
      ),
  );
  const reviewLikesById = sort === 'popular'
    ? await fetchReviewLikeTotals(mergedRestaurants.map((restaurant) => restaurant.id))
    : new Map<string, number>();
  const restaurants = mergedRestaurants
    .sort((a, b) => {
      if (sort === 'popular') {
        return comparePopularRestaurants(a, b, reviewLikesById);
      }

      const bTime = latestRestaurantSortTime(b, sort);
      const aTime = latestRestaurantSortTime(a, sort);
      return sort === 'oldest' ? aTime - bTime : bTime - aTime;
    });
  const hasMore = rawRestaurants.length === pageSize;

  return {
    restaurants,
    nextOffset: hasMore ? pageOffset + pageSize : null,
    hasMore,
  };
}
