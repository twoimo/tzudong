import { mergeRestaurants } from '@/hooks/use-restaurants';
import { supabase } from '@/integrations/supabase/client';
import type { Restaurant } from '@/types/restaurant';

export const POPULAR_RESTAURANTS_QUERY_KEY = ['popular-searches-weekly'] as const;
export const LATEST_RESTAURANTS_QUERY_KEY = ['latest-restaurants'] as const;

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

export async function fetchPopularRestaurants({
  limit,
  fetchLimit = Math.max(limit * 4, 12),
  selectedRegion,
  isKoreanOnly = false,
}: RestaurantListArgs): Promise<Restaurant[]> {
  const { data, error } = await supabase
    .from('restaurants')
    .select(POPULAR_RESTAURANT_SELECT)
    .eq('status', 'approved')
    .gt('weekly_search_count', 0)
    .order('weekly_search_count', { ascending: false })
    .limit(fetchLimit);

  if (error) throw error;

  return mergeRestaurants((data ?? []) as Restaurant[])
    .filter(isApprovedRestaurant)
    .filter((restaurant) =>
      matchesRestaurantAddressContext(restaurant, selectedRegion, isKoreanOnly),
    )
    .sort(
      (a, b) => (b.weekly_search_count ?? 0) - (a.weekly_search_count ?? 0),
    )
    .slice(0, limit);
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
