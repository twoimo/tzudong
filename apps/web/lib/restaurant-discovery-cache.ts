import type { QueryClient } from '@tanstack/react-query';
import {
  LATEST_RESTAURANTS_QUERY_KEY,
  POPULAR_RANK_SNAPSHOTS_QUERY_KEY,
  POPULAR_RESTAURANTS_QUERY_KEY,
} from '@/lib/popular-restaurants';

export const RESTAURANTS_QUERY_KEY_PREFIX = ['restaurants'] as const;
export const RESTAURANT_SEARCH_QUERY_KEY_PREFIX = [
  'restaurant-search',
] as const;
export const MOBILE_CONTROL_RESTAURANTS_QUERY_KEY_PREFIX = [
  'mobile-control-restaurants',
] as const;
export const GLOBAL_RESTAURANTS_COUNT_QUERY_KEY_PREFIX = [
  'global-restaurants-count',
] as const;
export const STAMP_ALL_RESTAURANTS_QUERY_KEY_PREFIX = [
  'all-restaurants',
] as const;
export const UNVISITED_RESTAURANTS_QUERY_KEY_PREFIX = [
  'unvisited-restaurants-all',
] as const;
export const RESTAURANT_DISCOVERY_INVALIDATED_EVENT =
  'restaurant-discovery-invalidated';
export const RESTAURANT_DISCOVERY_INVALIDATED_STORAGE_KEY =
  'tzudong:restaurant-discovery-invalidated-at';

const RESTAURANT_DISCOVERY_QUERY_KEYS = [
  RESTAURANTS_QUERY_KEY_PREFIX,
  RESTAURANT_SEARCH_QUERY_KEY_PREFIX,
  MOBILE_CONTROL_RESTAURANTS_QUERY_KEY_PREFIX,
  GLOBAL_RESTAURANTS_COUNT_QUERY_KEY_PREFIX,
  POPULAR_RESTAURANTS_QUERY_KEY,
  LATEST_RESTAURANTS_QUERY_KEY,
  POPULAR_RANK_SNAPSHOTS_QUERY_KEY,
  STAMP_ALL_RESTAURANTS_QUERY_KEY_PREFIX,
  UNVISITED_RESTAURANTS_QUERY_KEY_PREFIX,
] as const;

export const invalidateRestaurantDiscoveryQueries = (
  queryClient: QueryClient,
) => {
  const invalidation = Promise.all(
    RESTAURANT_DISCOVERY_QUERY_KEYS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );

  void invalidation.finally(() => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new Event(RESTAURANT_DISCOVERY_INVALIDATED_EVENT));

    try {
      window.localStorage.setItem(
        RESTAURANT_DISCOVERY_INVALIDATED_STORAGE_KEY,
        String(Date.now()),
      );
    } catch {
      // localStorage를 사용할 수 없는 환경에서는 같은 탭 무효화만 수행합니다.
    }
  });

  return invalidation;
};
