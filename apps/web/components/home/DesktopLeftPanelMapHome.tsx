'use client';
import { MapPanelHeader } from '@/components/home/map-panel-chrome';
import { markInitialLoadMilestone } from '@/lib/performance/initial-load-milestones';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { MapPin } from 'lucide-react';

import { StampCard } from '@/components/stamp/StampCard';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BrandSectionHeading } from '@/components/ui/brand-section-heading';
import { LoadingSurface } from "@/components/ui/loading-surface";
import { incrementSearchCount } from '@/lib/search-count';
import {
  attachPopularRankTrends,
  excludeRestaurantsAlreadyShown,
  fetchLatestRestaurantPage,
  fetchPopularRankSnapshots,
  fetchPopularRestaurants,
  getLatestRestaurantsQueryKey,
  getPopularRankSnapshotsQueryKey,
  getPopularRestaurantsQueryKey,
  type LatestRestaurantSort,
  type PopularRankTrend,
  POPULAR_RESTAURANTS_QUERY_KEY,
} from '@/lib/popular-restaurants';
import { homeMapResultStatusText, reconcileHomeMapContextualResults, type HomeMapResultSummary } from '@/lib/home-map-result-summary';
import type { Restaurant } from '@/types/restaurant';
import {
  HOME_MAP_CONTEXTUAL_DESKTOP_LIMIT,
  type HomeMapContextualRestaurantsPayload,
} from '@/lib/home-map-contextual-restaurants';

type DesktopLeftPanelMapHomeProps = {
  onRestaurantOpen: (restaurant: Restaurant) => void;
  resultSummary?: HomeMapResultSummary;
  selectedRegion?: string | null;
  isKoreanOnly?: boolean;
  contextualRestaurantsPayload?: HomeMapContextualRestaurantsPayload | null;
  onClearDiscoveryFilters?: () => void;
  onShowAllRegions?: () => void;
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
  { value: 'latest', label: '최신 영상순' },
  { value: 'oldest', label: '오래된 영상순' },
  { value: 'popular', label: '인기순' },
];


function getPopularRankTrendBadge(trend?: PopularRankTrend | null) {
  if (!trend || trend.trend === 'unknown' || trend.trend === 'same') return null;

  if (trend.trend === 'new') {
    return {
      label: '신규',
      title: '이전 집계 이후 인기 검색 순위에 새로 진입한 맛집',
      className: 'bg-brand-tangerine-tint text-brand-tangerine-ink',
    };
  }

  if (trend.rankDelta === null || trend.rankDelta === 0) return null;

  const isUp = trend.rankDelta > 0;

  return {
    label: `${isUp ? '▲' : '▼'}${Math.abs(trend.rankDelta)}`,
    title: `이전 집계보다 ${Math.abs(trend.rankDelta)}위 ${isUp ? '상승' : '하락'}`,
    className: isUp
      ? 'bg-brand-garden-tint text-brand-garden-text'
      : 'bg-muted text-muted-foreground',
  };
}

function DesktopRestaurantCardPreview() {
  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-card" aria-hidden="true">
      <div className="aspect-video w-full bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
      </div>
    </article>
  );
}

export default function DesktopLeftPanelMapHome({
  onRestaurantOpen,
  resultSummary,
  selectedRegion,
  isKoreanOnly = true,
  contextualRestaurantsPayload = null,
  onClearDiscoveryFilters,
  onShowAllRegions,
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
        includeRankTrends: false,
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
  const {
    data: popularRestaurantRows,
    isLoading,
    isSuccess: isPopularListReady,
    isPlaceholderData: isPopularListPlaceholder,
    isError: isPopularListError,
    isFetching: isPopularListFetching,
    refetch: refetchPopularRestaurants,
  } = useQuery({
    enabled: !resultSummary?.active,
    queryKey: desktopLeftPanelHomePopularQueryKey,
    queryFn: () => fetchPopularRestaurants({
      limit: POPULAR_RESTAURANT_LIMIT,
      fetchLimit: POPULAR_RESTAURANT_QUERY_LIMIT,
      selectedRegion,
      isKoreanOnly,
      includeRankTrends: false,
    }),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  // Historical rank metadata must never gate the primary list or its ready state.
  const { data: rankSnapshots, isError: isRankSnapshotError } = useQuery({
    queryKey: getPopularRankSnapshotsQueryKey({
      limit: POPULAR_RESTAURANT_LIMIT,
      selectedRegion,
      isKoreanOnly,
    }),
    queryFn: () => fetchPopularRankSnapshots({
      limit: POPULAR_RESTAURANT_LIMIT,
      selectedRegion,
      isKoreanOnly,
    }),
    enabled: !resultSummary?.active && isPopularListReady && !isPopularListPlaceholder && Boolean(popularRestaurantRows?.length),
    // The shared provider retains previous query data; never carry trends across scopes.
    placeholderData: undefined,
    retry: false,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  const popularRestaurants = useMemo(() => {
    const restaurants = popularRestaurantRows ?? [];
    return rankSnapshots && !isPopularListPlaceholder && !isRankSnapshotError
      ? attachPopularRankTrends(restaurants, rankSnapshots.snapshots, rankSnapshots.hasSnapshotPeriod)
      : restaurants;
  }, [popularRestaurantRows, rankSnapshots, isPopularListPlaceholder, isRankSnapshotError]);
  const {
    data: latestRestaurantPages,
    fetchNextPage: fetchNextLatestRestaurantPage,
    hasNextPage: hasNextLatestRestaurantPage,
    isFetchingNextPage: isFetchingNextLatestRestaurantPage,
    isLoading: isLatestLoading,
    isError: isLatestError,
    isFetchNextPageError: isLatestNextPageError,
    isFetching: isLatestFetching,
    refetch: refetchLatestRestaurants,
  } = useInfiniteQuery({
    enabled: !resultSummary?.active,
    queryKey: desktopLeftPanelHomeLatestQueryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchLatestRestaurantPage({
      offset: Number(pageParam) || 0,
      fetchLimit: LATEST_RESTAURANT_PAGE_FETCH_LIMIT,
      sort: latestRestaurantSort,
      selectedRegion,
      isKoreanOnly,
    }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });
  useEffect(() => {
    if (resultSummary?.active ? resultSummary.status === 'pending' : isLoading || isLatestLoading) return;
    document.documentElement.dataset.homePanelReady = "true";
    markInitialLoadMilestone('desktopPanelSettled');
  }, [isLatestLoading, isLoading, resultSummary?.active, resultSummary?.status]);
  useEffect(() => () => {
    delete document.documentElement.dataset.homePanelReady;
  }, []);
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
  const currentContextualPayload = useMemo(() => resultSummary
    ? reconcileHomeMapContextualResults(resultSummary, contextualRestaurantsPayload, isKoreanOnly ? 'domestic' : 'overseas')
    : contextualRestaurantsPayload, [resultSummary, contextualRestaurantsPayload, isKoreanOnly]);
  const contextualRestaurants = useMemo(
    () =>
      isKoreanOnly && currentContextualPayload?.mode === 'domestic' && currentContextualPayload.isEligible
        ? currentContextualPayload.restaurants.slice(0, HOME_MAP_CONTEXTUAL_DESKTOP_LIMIT)
        : [],
    [currentContextualPayload, isKoreanOnly],
  );
  const hasContextualRestaurants = contextualRestaurants.length > 0;
  const visibleMarkerRestaurantCount =
    currentContextualPayload?.totalVisibleCount ?? contextualRestaurants.length;
  const hasBufferedLatestRestaurants =
    visibleLatestRestaurantCount < visibleLatestRestaurants.length;
  const hasMoreLatestRestaurants =
    hasBufferedLatestRestaurants || Boolean(hasNextLatestRestaurantPage);

  useEffect(() => {
    setVisibleLatestRestaurantCount(LATEST_RESTAURANT_INITIAL_RENDER_COUNT);
  }, [isKoreanOnly, latestRestaurantSort, selectedRegion]);

  const showMoreLatestRestaurants = useCallback(() => {
    if (resultSummary?.active) return;
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
    resultSummary?.active,
  ]);

  useEffect(() => {
    if (
      resultSummary?.active ||
      isLatestLoading ||
      visibleLatestRestaurants.length > 0 ||
      !hasNextLatestRestaurantPage ||
      isLatestNextPageError ||
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
    isLatestNextPageError,
    visibleLatestRestaurants.length,
    resultSummary?.active,
  ]);

  useEffect(() => {
    const loadMoreNode = latestRestaurantLoadMoreRef.current;
    if (
      !loadMoreNode ||
      isLatestLoading ||
      isLatestNextPageError ||
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
    isLatestNextPageError,
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

  if (resultSummary?.active) {
    return (
      <section className="h-full min-h-0 overflow-y-auto bg-background" data-home-filter-results="true" aria-label="현재 지도 필터 결과" aria-busy={resultSummary.status === 'pending'}>
        <MapPanelHeader title="필터 결과" titleIcon={<MapPin />} count={resultSummary.count ?? undefined} countUnit="곳" />
        <p className="px-3 py-2 text-sm text-muted-foreground" role={resultSummary.status === 'error' ? 'alert' : 'status'}>{homeMapResultStatusText(resultSummary)}</p>
        {resultSummary.status === 'ready' && resultSummary.count === 0 && (onClearDiscoveryFilters || onShowAllRegions) && (
          <div className="px-3 pb-4">
            <p className="mb-3 text-sm leading-6 text-muted-foreground">선택한 위치에서 조건을 넓혀 찾아보세요.</p>
            {onClearDiscoveryFilters && <Button type="button" variant="outline" className="mb-2 min-h-11 w-full" onClick={onClearDiscoveryFilters}>
              테마·카테고리 해제
            </Button>}
            {onShowAllRegions && <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onShowAllRegions}>
              전체 지역 보기
            </Button>}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 px-3 pb-3">
          {resultSummary.restaurants.map((restaurant) => (
            <StampCard key={restaurant.id} restaurant={restaurant} isVisited={false} isUserStampsReady={false}
              currentThumbnailIndex={restaurantThumbnailIndexes[restaurant.id] ?? 0}
              onThumbnailChange={handleRestaurantThumbnailChange} onClick={handleRestaurantOpen}
              size="default" stampSize="compact" showAddress layout="list" categoryFallback="맛집" />
          ))}
        </div>
      </section>
    );
  }

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
            className="border-b border-border/70"
            data-desktop-left-panel-visible-marker-restaurants="true"
          >
            <MapPanelHeader
              title="맛집 목록"
              titleIcon={<MapPin />}
              count={visibleMarkerRestaurantCount}
              countUnit="곳"
            />

            <div className="grid grid-cols-1 gap-3 px-3 py-3">
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
            className="bg-background px-4 pb-4 pt-4"
            data-desktop-left-panel-popular-restaurants="true"
          >
          <div className="mb-3">
            <BrandSectionHeading title="많이 찾는 맛집" />
          </div>

          <div className="divide-y divide-border/70">
            {isLoading ? (
              <div data-desktop-left-panel-popular-skeleton="true">
                <LoadingSurface label="인기 검색 맛집 로딩 중" className="divide-y divide-border/70">
                  <div className="divide-y divide-border/70">
                    {Array.from({ length: POPULAR_RESTAURANT_LIMIT }, (_, index) => (
                      <article key={index} className="flex min-h-14 items-center gap-3 py-2" aria-hidden="true">
                        <span className="h-6 w-6 rounded bg-muted" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="h-4 w-2/3 rounded bg-muted" />
                          <div className="h-3 w-4/5 rounded bg-muted" />
                        </div>
                      </article>
                    ))}
                  </div>
                </LoadingSurface>
              </div>
            ) : isPopularListError ? (
              <div className="py-4">
                <p className="text-sm leading-6 text-muted-foreground" role="alert">인기 맛집을 불러오지 못했습니다.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 min-h-11"
                  disabled={isPopularListFetching}
                  onClick={() => void refetchPopularRestaurants()}
                >
                  {isPopularListFetching ? '불러오는 중…' : '다시 불러오기'}
                </Button>
              </div>
            ) : popularRestaurants.length === 0 ? (
              <div className="py-4 text-sm leading-6 text-muted-foreground">
                {selectedRegion ? `${selectedRegion}에 표시할 인기 맛집이 없습니다.` : '아직 인기 검색 순위가 없습니다.'}
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
                    className="group flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-3 text-left hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                    aria-label={`${restaurant.name} 인기 맛집 상세 보기`}
                  >
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center text-sm font-semibold tabular-nums text-muted-foreground"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                          {restaurant.name}
                        </span>
                        {trendBadge ? (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-bold leading-none ${trendBadge.className}`}
                            title={trendBadge.title}
                            aria-label={trendBadge.title}
                          >
                            {trendBadge.label}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
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
          className="border-t border-border/70 px-4 pt-4"
          data-desktop-left-panel-latest-restaurants="true"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <BrandSectionHeading title="영상 속 맛집" />
            <Select
              value={latestRestaurantSort}
              onValueChange={(value) =>
                setLatestRestaurantSort(value as LatestRestaurantSort)
              }
            >
              <SelectTrigger
                className="!h-11 !w-auto min-w-24 shrink-0 gap-2 rounded-lg border-border bg-background !px-3 !text-xs font-medium text-foreground shadow-none hover:bg-secondary focus:ring-2 focus:ring-ring [&>span]:line-clamp-1"
                aria-label="영상 속 맛집 정렬"
              >
                <SelectValue placeholder="정렬" />
              </SelectTrigger>
              <SelectContent
                align="end"
                className="z-[190] min-w-[92px] rounded-2xl border-border bg-card p-1 font-sans shadow-sm"
              >
                {latestRestaurantSortOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="min-h-11 rounded-lg py-3 pl-8 pr-3 text-sm"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {isLatestLoading || (visibleLatestRestaurants.length === 0 && isFetchingNextLatestRestaurantPage) ? (
              <div data-desktop-left-panel-latest-skeleton="true">
                <LoadingSurface className="grid grid-cols-1 gap-3" label="최근 추가된 맛집 로딩 중">
                  <div className="grid grid-cols-1 gap-3">
                    {Array.from({ length: LATEST_RESTAURANT_INITIAL_RENDER_COUNT }, (_, index) => (
                      <DesktopRestaurantCardPreview key={index} />
                    ))}
                  </div>
                </LoadingSurface>
              </div>
            ) : isLatestError && visibleLatestRestaurants.length === 0 ? (
              <div className="py-4">
                <p className="text-sm leading-6 text-muted-foreground" role="alert">최근 맛집을 불러오지 못했습니다.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 min-h-11"
                  disabled={isLatestFetching}
                  onClick={() => void refetchLatestRestaurants()}
                >
                  {isLatestFetching ? '불러오는 중…' : '다시 불러오기'}
                </Button>
              </div>
            ) : visibleLatestRestaurants.length === 0 ? (
              <div className="py-4 text-sm leading-6 text-muted-foreground">
                <p>{popularRestaurants.length > 0
                  ? '위 목록 외에 추가로 표시할 맛집이 없습니다.'
                  : selectedRegion ? `${selectedRegion}에 표시할 맛집이 없습니다.` : '아직 표시할 맛집이 없습니다.'}</p>
                {onShowAllRegions && <Button type="button" variant="outline" className="mt-3 min-h-11 w-full" onClick={onShowAllRegions}>
                  전체 지역 보기
                </Button>}
              </div>
            ) : (
              <>
                {renderedLatestRestaurants.map((restaurant, index) => (
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
                    thumbnailPriority={index === 0}
                    showAddress
                    categoryFallback="맛집"
                  />
                ))}
                {hasMoreLatestRestaurants ? (
                  <div
                    ref={latestRestaurantLoadMoreRef}
                    className="py-1 text-center"
                    data-desktop-left-panel-latest-load-more="true"
                  >
                    {isFetchingNextLatestRestaurantPage ? (
                      <LoadingSurface className="grid grid-cols-1 gap-3" label="최근 추가된 맛집 추가 로딩 중">
                        <DesktopRestaurantCardPreview />
                      </LoadingSurface>
                    ) : (
                      <>
                      {isLatestNextPageError && <p className="mb-2 text-sm leading-6 text-muted-foreground" role="alert">추가 맛집을 불러오지 못했습니다.</p>}
                      <button
                        type="button"
                        onClick={showMoreLatestRestaurants}
                        className="min-h-11 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        aria-label="최근 추가된 맛집 더 보기"
                      >
                        {isLatestNextPageError ? '다시 불러오기' : '맛집 더 보기'}
                      </button>
                      </>
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
