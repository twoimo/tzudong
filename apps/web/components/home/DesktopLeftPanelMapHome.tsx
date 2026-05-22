'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, MapPin, TrendingUp } from 'lucide-react';

import { StampCard } from '@/components/stamp/StampCard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { incrementSearchCount } from '@/lib/search-count';
import {
  fetchLatestRestaurants,
  fetchPopularRestaurants,
  getLatestRestaurantsQueryKey,
  getPopularRestaurantsQueryKey,
  type LatestRestaurantSort,
  POPULAR_RESTAURANTS_QUERY_KEY,
} from '@/lib/popular-restaurants';
import type { Restaurant } from '@/types/restaurant';

type DesktopLeftPanelMapHomeProps = {
  onRestaurantOpen: (restaurant: Restaurant) => void;
  onOpenUserProfile?: (userId: string) => void;
  onOpenAuth?: () => void;
  selectedRegion?: string | null;
  isKoreanOnly?: boolean;
};

const POPULAR_RESTAURANT_LIMIT = 3;
const POPULAR_RESTAURANT_QUERY_LIMIT = 12;
const LATEST_RESTAURANT_LIMIT = 10;
const LATEST_RESTAURANT_QUERY_LIMIT = 24;
const LATEST_RESTAURANT_DEDUPED_QUERY_LIMIT =
  LATEST_RESTAURANT_LIMIT + POPULAR_RESTAURANT_LIMIT;
const latestRestaurantSortOptions: Array<{
  value: LatestRestaurantSort;
  label: string;
}> = [
  { value: 'latest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
  { value: 'popular', label: '인기순' },
];
export default function DesktopLeftPanelMapHome({
  onRestaurantOpen,
  selectedRegion,
  isKoreanOnly = true,
}: DesktopLeftPanelMapHomeProps) {
  const queryClient = useQueryClient();
  const [latestThumbnailIndexes, setLatestThumbnailIndexes] = useState<
    Record<string, number>
  >({});
  const [latestRestaurantSort, setLatestRestaurantSort] =
    useState<LatestRestaurantSort>('latest');
  const desktopLeftPanelHomePopularQueryKey = useMemo(
    () =>
      getPopularRestaurantsQueryKey({
        limit: POPULAR_RESTAURANT_LIMIT,
        selectedRegion,
        isKoreanOnly,
      }),
    [isKoreanOnly, selectedRegion],
  );
  const desktopLeftPanelHomeLatestQueryKey = useMemo(
    () =>
      getLatestRestaurantsQueryKey({
        limit: LATEST_RESTAURANT_DEDUPED_QUERY_LIMIT,
        sort: latestRestaurantSort,
        selectedRegion,
        isKoreanOnly,
      }),
    [isKoreanOnly, latestRestaurantSort, selectedRegion],
  );
  const { data: popularRestaurants = [], isLoading } = useQuery({
    queryKey: desktopLeftPanelHomePopularQueryKey,
    queryFn: async () => {
      try {
        return await fetchPopularRestaurants({
          limit: POPULAR_RESTAURANT_LIMIT,
          fetchLimit: POPULAR_RESTAURANT_QUERY_LIMIT,
          selectedRegion,
          isKoreanOnly,
        });
      } catch (error) {
        console.warn('좌측 패널 인기 맛집 조회 실패:', error);
        return [];
      }
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  const { data: latestRestaurants = [], isLoading: isLatestLoading } = useQuery({
    queryKey: desktopLeftPanelHomeLatestQueryKey,
    queryFn: async () => {
      try {
        return await fetchLatestRestaurants({
          limit: LATEST_RESTAURANT_DEDUPED_QUERY_LIMIT,
          fetchLimit: LATEST_RESTAURANT_QUERY_LIMIT,
          sort: latestRestaurantSort,
          selectedRegion,
          isKoreanOnly,
        });
      } catch (error) {
        console.warn('좌측 패널 최신 맛집 조회 실패:', error);
        return [];
      }
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  const visibleLatestRestaurants = useMemo(() => {
    const popularRestaurantIds = new Set(
      popularRestaurants.map((restaurant) => restaurant.id),
    );

    return latestRestaurants
      .filter((restaurant) => !popularRestaurantIds.has(restaurant.id))
      .slice(0, LATEST_RESTAURANT_LIMIT);
  }, [latestRestaurants, popularRestaurants]);

  const handleRestaurantOpen = useCallback(
    (restaurant: Restaurant) => {
      incrementSearchCount(restaurant.id).catch((error) => {
        console.warn('좌측 패널 인기 맛집 검색 집계 실패:', error);
      });
      queryClient.invalidateQueries({ queryKey: POPULAR_RESTAURANTS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: desktopLeftPanelHomePopularQueryKey,
      });
      onRestaurantOpen(restaurant);
    },
    [desktopLeftPanelHomePopularQueryKey, onRestaurantOpen, queryClient],
  );

  const handleLatestThumbnailChange = useCallback((id: string, index: number) => {
    setLatestThumbnailIndexes((current) => ({
      ...current,
      [id]: index,
    }));
  }, []);

  return (
    <section
      className="h-full min-h-0 bg-background"
      data-desktop-left-panel-map-home="true"
      aria-label="쯔동여지도 홈 추천과 최신 맛집"
    >
      <div
        className="h-full overflow-y-auto pb-4"
        data-desktop-left-panel-home-scroll="true"
      >
        <div
          className="bg-background px-3 pb-2 pt-3"
          data-desktop-left-panel-popular-restaurants="true"
        >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>인기 검색 맛집</span>
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              처음 방문해도 바로 눌러볼 만한 맛집 3곳
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
            TOP 3
          </span>
        </div>

        <div className="divide-y divide-border/70">
          {isLoading ? (
            Array.from({ length: POPULAR_RESTAURANT_LIMIT }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-1 py-2"
              >
                <Skeleton className="h-6 w-6 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1">
                  <Skeleton className="h-4 w-24 rounded-full" />
                  <Skeleton className="h-3 w-40 rounded-full" />
                </div>
              </div>
            ))
          ) : popularRestaurants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
              인기 검색 데이터가 쌓이면 여기에서 바로 보여드릴게요.
            </div>
          ) : (
            popularRestaurants.map((restaurant, index) => (
              <button
                key={restaurant.id}
                type="button"
                onClick={() => handleRestaurantOpen(restaurant)}
                className="group flex w-full items-center gap-2 px-1 py-2 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                aria-label={`${restaurant.name} 인기 맛집 상세 보기`}
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {restaurant.name}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {restaurant.road_address ||
                        restaurant.jibun_address ||
                        restaurant.english_address ||
                        '주소 없음'}
                    </span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        </div>

        <div
          className="px-3 pt-1"
          data-desktop-left-panel-latest-restaurants="true"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>최근 추가된 맛집</span>
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              도장 카드처럼 한눈에 보는 맛집 10곳
            </p>
          </div>
          <Select
            value={latestRestaurantSort}
            onValueChange={(value) =>
              setLatestRestaurantSort(value as LatestRestaurantSort)
            }
          >
            <SelectTrigger
              className="h-8 w-[88px] shrink-0 rounded-full border-primary/15 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary shadow-none hover:bg-primary/15 focus:ring-primary [&>span]:line-clamp-1"
              aria-label="최근 맛집 정렬"
            >
              <SelectValue placeholder="정렬" />
            </SelectTrigger>
            <SelectContent
              align="end"
              className="z-[190] min-w-[92px] rounded-2xl border-border bg-card p-1 font-serif shadow-xl"
            >
              {latestRestaurantSortOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="rounded-xl py-2 pl-7 pr-2 text-xs font-semibold"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {isLatestLoading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="flex items-center justify-between gap-2 p-2">
                  <Skeleton className="h-4 w-28 rounded-full" />
                  <Skeleton className="h-4 w-12 rounded-full" />
                </div>
              </div>
            ))
          ) : visibleLatestRestaurants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-xs text-muted-foreground">
              새로 추가된 맛집이 준비되면 최신순으로 보여드릴게요.
            </div>
          ) : (
            visibleLatestRestaurants.map((restaurant) => (
              <StampCard
                key={restaurant.id}
                restaurant={restaurant}
                isVisited={false}
                isUserStampsReady={false}
                currentThumbnailIndex={latestThumbnailIndexes[restaurant.id] ?? 0}
                onThumbnailChange={handleLatestThumbnailChange}
                onClick={handleRestaurantOpen}
                size="default"
                stampSize="compact"
                showAddress
                categoryFallback="맛집"
              />
            ))
          )}
          </div>
        </div>
      </div>
    </section>
  );
}
