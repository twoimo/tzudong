'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
  excludeRestaurantsAlreadyShown,
  fetchLatestRestaurantPage,
  fetchPopularRestaurants,
  getLatestRestaurantsQueryKey,
  getPopularRestaurantsQueryKey,
  type LatestRestaurantSort,
  type PopularRankTrend,
  POPULAR_RESTAURANTS_QUERY_KEY,
} from '@/lib/popular-restaurants';
import type { Restaurant } from '@/types/restaurant';
import {
  HOME_MAP_CONTEXTUAL_DESKTOP_LIMIT,
  type HomeMapContextualRestaurantsPayload,
} from '@/lib/home-map-contextual-restaurants';

type DesktopLeftPanelMapHomeProps = {
  onRestaurantOpen: (restaurant: Restaurant) => void;
  selectedRegion?: string | null;
  isKoreanOnly?: boolean;
  contextualRestaurantsPayload?: HomeMapContextualRestaurantsPayload | null;
};

const POPULAR_RESTAURANT_LIMIT = 5;
const POPULAR_RESTAURANT_QUERY_LIMIT = 60;
const LATEST_RESTAURANT_INITIAL_RENDER_COUNT = 3;
const LATEST_RESTAURANT_RENDER_BATCH_SIZE = 3;
const LATEST_RESTAURANT_PAGE_FETCH_LIMIT = 12;
const latestRestaurantSortOptions: Array<{
  value: LatestRestaurantSort;
  label: string;
}> = [
  { value: 'latest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
  { value: 'popular', label: '인기순' },
];


function getPopularRankTrendBadge(trend?: PopularRankTrend | null) {
  if (!trend || trend.trend === 'unknown' || trend.trend === 'same') return null;

  if (trend.trend === 'new') {
    return {
      label: 'NEW',
      title: '이전 인기 검색 스냅샷에 없던 맛집',
      className: 'bg-primary/10 text-primary',
    };
  }

  if (trend.rankDelta === null || trend.rankDelta === 0) return null;

  const isUp = trend.rankDelta > 0;

  return {
    label: `${isUp ? '▲' : '▼'}${Math.abs(trend.rankDelta)}`,
    title: `이전 인기 검색 스냅샷 대비 ${Math.abs(trend.rankDelta)}위 ${isUp ? '상승' : '하락'}`,
    className: isUp
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-muted text-muted-foreground',
  };
}

function DesktopRestaurantCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <Skeleton className="h-3 w-40 rounded-full" />
      </div>
    </div>
  );
}

export default function DesktopLeftPanelMapHome({
  onRestaurantOpen,
  selectedRegion,
  isKoreanOnly = true,
  contextualRestaurantsPayload = null,
}: DesktopLeftPanelMapHomeProps) {
  const queryClient = useQueryClient();
  const [restaurantThumbnailIndexes, setRestaurantThumbnailIndexes] = useState<
    Record<string, number>
  >({});
  const [latestRestaurantSort, setLatestRestaurantSort] =
    useState<LatestRestaurantSort>('latest');
  const [visibleLatestRestaurantCount, setVisibleLatestRestaurantCount] =
    useState(LATEST_RESTAURANT_INITIAL_RENDER_COUNT);
  const latestRestaurantScrollRootRef = useRef<HTMLDivElement | null>(null);
  const latestRestaurantLoadMoreRef = useRef<HTMLDivElement | null>(null);
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
        limit: LATEST_RESTAURANT_PAGE_FETCH_LIMIT,
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
      } catch {
        return [];
      }
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  const {
    data: latestRestaurantPages,
    fetchNextPage: fetchNextLatestRestaurantPage,
    hasNextPage: hasNextLatestRestaurantPage,
    isFetchingNextPage: isFetchingNextLatestRestaurantPage,
    isLoading: isLatestLoading,
  } = useInfiniteQuery({
    queryKey: desktopLeftPanelHomeLatestQueryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      try {
        return await fetchLatestRestaurantPage({
          offset: Number(pageParam) || 0,
          fetchLimit: LATEST_RESTAURANT_PAGE_FETCH_LIMIT,
          sort: latestRestaurantSort,
          selectedRegion,
          isKoreanOnly,
        });
      } catch {
        return {
          restaurants: [],
          nextOffset: null,
          hasMore: false,
        };
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  const latestRestaurants = useMemo(
    () =>
      latestRestaurantPages?.pages.flatMap((page) => page.restaurants) ?? [],
    [latestRestaurantPages],
  );
  const visibleLatestRestaurants = useMemo(() => {
    return excludeRestaurantsAlreadyShown(
      latestRestaurants,
      new Set(popularRestaurants.map((restaurant) => restaurant.id)),
    );
  }, [latestRestaurants, popularRestaurants]);
  const renderedLatestRestaurants = useMemo(
    () => visibleLatestRestaurants.slice(0, visibleLatestRestaurantCount),
    [visibleLatestRestaurantCount, visibleLatestRestaurants],
  );
  const contextualRestaurants = useMemo(
    () =>
      isKoreanOnly && contextualRestaurantsPayload?.mode === 'domestic' && contextualRestaurantsPayload.isEligible
        ? contextualRestaurantsPayload.restaurants.slice(0, HOME_MAP_CONTEXTUAL_DESKTOP_LIMIT)
        : [],
    [contextualRestaurantsPayload, isKoreanOnly],
  );
  const hasContextualRestaurants = contextualRestaurants.length > 0;
  const visibleMarkerRestaurantCount =
    contextualRestaurantsPayload?.totalVisibleCount ?? contextualRestaurants.length;
  const hasBufferedLatestRestaurants =
    visibleLatestRestaurantCount < visibleLatestRestaurants.length;
  const hasMoreLatestRestaurants =
    hasBufferedLatestRestaurants || Boolean(hasNextLatestRestaurantPage);

  useEffect(() => {
    setVisibleLatestRestaurantCount(LATEST_RESTAURANT_INITIAL_RENDER_COUNT);
  }, [isKoreanOnly, latestRestaurantSort, selectedRegion]);

  const showMoreLatestRestaurants = useCallback(() => {
    if (hasBufferedLatestRestaurants) {
      setVisibleLatestRestaurantCount((currentCount) =>
        Math.min(
          currentCount + LATEST_RESTAURANT_RENDER_BATCH_SIZE,
          visibleLatestRestaurants.length,
        ),
      );
      return;
    }

    if (hasNextLatestRestaurantPage && !isFetchingNextLatestRestaurantPage) {
      void fetchNextLatestRestaurantPage();
    }
  }, [
    fetchNextLatestRestaurantPage,
    hasBufferedLatestRestaurants,
    hasNextLatestRestaurantPage,
    isFetchingNextLatestRestaurantPage,
    visibleLatestRestaurants.length,
  ]);

  useEffect(() => {
    if (
      isLatestLoading ||
      visibleLatestRestaurants.length > 0 ||
      !hasNextLatestRestaurantPage ||
      isFetchingNextLatestRestaurantPage
    ) {
      return;
    }

    void fetchNextLatestRestaurantPage();
  }, [
    fetchNextLatestRestaurantPage,
    hasNextLatestRestaurantPage,
    isFetchingNextLatestRestaurantPage,
    isLatestLoading,
    visibleLatestRestaurants.length,
  ]);

  useEffect(() => {
    const loadMoreNode = latestRestaurantLoadMoreRef.current;
    if (
      !loadMoreNode ||
      isLatestLoading ||
      !hasMoreLatestRestaurants ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          showMoreLatestRestaurants();
        }
      },
      {
        root: latestRestaurantScrollRootRef.current,
        rootMargin: '240px 0px',
      },
    );
    const seenRestaurantIds = new Set<string>();
    const dedupedRestaurants: Restaurant[] = [];

    observer.observe(loadMoreNode);

    return () => {
      observer.disconnect();
    };
  }, [
    hasMoreLatestRestaurants,
    isLatestLoading,
    showMoreLatestRestaurants,
    renderedLatestRestaurants.length,
  ]);

  const handleRestaurantOpen = useCallback(
    (restaurant: Restaurant) => {
      incrementSearchCount(restaurant.id).catch((error) => {
        console.warn('좌측 패널 인기 맛집 검색 집계 실패:');
      });
      queryClient.invalidateQueries({ queryKey: POPULAR_RESTAURANTS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: desktopLeftPanelHomePopularQueryKey,
      });
      onRestaurantOpen(restaurant);
    },
    [desktopLeftPanelHomePopularQueryKey, onRestaurantOpen, queryClient],
  );

  const handleRestaurantThumbnailChange = useCallback(
    (id: string, index: number) => {
      setRestaurantThumbnailIndexes((current) => ({
        ...current,
        [id]: index,
      }));
    },
    [],
  );

  return (
    <section
      className="h-full min-h-0 bg-background"
      data-desktop-left-panel-map-home="true"
      aria-label="쯔동여지도 홈 추천과 최신 맛집"
    >
      <div
        className="h-full overflow-y-auto pb-4"
        ref={latestRestaurantScrollRootRef}
        data-desktop-left-panel-home-scroll="true"
      >
        {hasContextualRestaurants ? (
          <div
            className="border-b border-border/70 px-3 pb-2 pt-3"
            data-desktop-left-panel-visible-marker-restaurants="true"
          >
            <div className="mb-1 flex min-w-0 items-center justify-between gap-2 px-1">
              <h2 className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold leading-5 text-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">맛집 목록</span>
              </h2>
              <span
                className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold leading-4 text-primary-foreground"
                aria-label={`맛집 목록 ${visibleMarkerRestaurantCount}곳`}
              >
                {visibleMarkerRestaurantCount}곳
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {contextualRestaurants.map((restaurant) => (
                <StampCard
                  key={restaurant.id}
                  restaurant={restaurant}
                  isVisited={false}
                  isUserStampsReady={false}
                  currentThumbnailIndex={
                    restaurantThumbnailIndexes[restaurant.id] ?? 0
                  }
                  onThumbnailChange={handleRestaurantThumbnailChange}
                  onClick={handleRestaurantOpen}
                  size="default"
                  stampSize="compact"
                  showAddress
                  layout="list"
                  categoryFallback="맛집"
                />
              ))}
            </div>
          </div>
        ) : null}
        {!hasContextualRestaurants ? (
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
                처음 방문해도 바로 눌러볼 만한 맛집 5곳
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
              TOP 5
            </span>
          </div>

          <div className="divide-y divide-border/70">
            {isLoading ? (
              <div
                className="divide-y divide-border/70"
                role="status"
                aria-live="polite"
                aria-label="인기 검색 맛집 로딩 중"
                data-desktop-left-panel-popular-skeleton="true"
              >
                {Array.from({ length: POPULAR_RESTAURANT_LIMIT }, (_, index) => (
                  <div key={index} className="flex items-center gap-2 px-1 py-2">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Skeleton className="h-4 w-24 rounded-full" />
                      <Skeleton className="h-3 w-40 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : popularRestaurants.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                인기 검색 데이터가 쌓이면 여기에서 바로 보여드릴게요.
              </div>
            ) : (
              popularRestaurants.map((restaurant, index) => {
                const trendBadge = getPopularRankTrendBadge(
                  restaurant.popularRankTrend,
                );

                return (
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
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                          {restaurant.name}
                        </span>
                        {trendBadge ? (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${trendBadge.className}`}
                            title={trendBadge.title}
                            aria-label={trendBadge.title}
                          >
                            {trendBadge.label}
                          </span>
                        ) : null}
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
                );
              })
            )}
          </div>
          </div>
        ) : null}

        {!hasContextualRestaurants ? (
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
                먼저 3곳을 보여주고 스크롤하면 이어서 불러와요
              </p>
            </div>
            <Select
              value={latestRestaurantSort}
              onValueChange={(value) =>
                setLatestRestaurantSort(value as LatestRestaurantSort)
              }
            >
              <SelectTrigger
                className="!h-7 !w-[4.75rem] shrink-0 gap-1 rounded-full border-primary/15 bg-primary/10 !px-2 !text-[10px] !leading-none font-semibold text-primary shadow-none hover:bg-primary/15 focus:ring-1 focus:ring-primary [&>span]:line-clamp-1 [&>span]:text-[10px] [&>svg]:!h-3 [&>svg]:!w-3"
                aria-label="최근 맛집 정렬"
              >
                <SelectValue placeholder="정렬" />
              </SelectTrigger>
              <SelectContent
                align="end"
                className="z-[190] min-w-[92px] rounded-2xl border-border bg-card p-1 font-sans shadow-xl"
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
              <div
                className="grid grid-cols-1 gap-3"
                role="status"
                aria-live="polite"
                aria-label="최근 추가된 맛집 로딩 중"
                data-desktop-left-panel-latest-skeleton="true"
              >
                {Array.from(
                  { length: LATEST_RESTAURANT_INITIAL_RENDER_COUNT },
                  (_, index) => (
                    <DesktopRestaurantCardSkeleton key={index} />
                  ),
                )}
              </div>
            ) : visibleLatestRestaurants.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-xs text-muted-foreground">
                {process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === '1'
                  ? '로컬 작업장에는 공개 지도용 승인 맛집이 아직 없습니다. pending은 여기 올리지 않고, 확정된 행만 hosted_data_plane으로 프로덕션에 올립니다.'
                  : '새로 추가된 맛집이 준비되면 최신순으로 보여드릴게요.'}
              </div>
            ) : (
              <>
                {renderedLatestRestaurants.map((restaurant) => (
                  <StampCard
                    key={restaurant.id}
                    restaurant={restaurant}
                    isVisited={false}
                    isUserStampsReady={false}
                    currentThumbnailIndex={
                      restaurantThumbnailIndexes[restaurant.id] ?? 0
                    }
                    onThumbnailChange={handleRestaurantThumbnailChange}
                    onClick={handleRestaurantOpen}
                    size="default"
                    stampSize="compact"
                    showAddress
                    categoryFallback="맛집"
                  />
                ))}
                {hasMoreLatestRestaurants ? (
                  <div
                    ref={latestRestaurantLoadMoreRef}
                    className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-3 text-center"
                    data-desktop-left-panel-latest-load-more="true"
                  >
                    {isFetchingNextLatestRestaurantPage ? (
                      <div
                        className="grid grid-cols-1 gap-3"
                        role="status"
                        aria-live="polite"
                        aria-label="최근 추가된 맛집 추가 로딩 중"
                      >
                        <DesktopRestaurantCardSkeleton />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={showMoreLatestRestaurants}
                        className="text-xs font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        aria-label="최근 추가된 맛집 더 보기"
                      >
                        스크롤하면 더 보여드릴게요
                      </button>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        ) : null}
      </div>
    </section>
  );
}
