'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, MessageSquareText, TrendingUp } from 'lucide-react';

import FeedContent, { type FeedRestaurantRecord } from '@/components/feed/FeedContent';
import { Skeleton } from '@/components/ui/skeleton';
import { incrementSearchCount } from '@/lib/search-count';
import {
  fetchPopularRestaurants,
  getPopularRestaurantsQueryKey,
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
export default function DesktopLeftPanelMapHome({
  onRestaurantOpen,
  onOpenUserProfile,
  onOpenAuth,
  selectedRegion,
  isKoreanOnly = true,
}: DesktopLeftPanelMapHomeProps) {
  const queryClient = useQueryClient();
  const [shouldLoadReviewFeed, setShouldLoadReviewFeed] = useState(false);
  const desktopLeftPanelHomePopularQueryKey = useMemo(
    () =>
      getPopularRestaurantsQueryKey({
        limit: POPULAR_RESTAURANT_LIMIT,
        selectedRegion,
        isKoreanOnly,
      }),
    [isKoreanOnly, selectedRegion],
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

  const handleFeedRestaurantOpen = useCallback(
    (restaurant: FeedRestaurantRecord) => {
      onRestaurantOpen(restaurant as unknown as Restaurant);
    },
    [onRestaurantOpen],
  );

  const requestReviewFeed = useCallback(() => {
    setShouldLoadReviewFeed(true);
  }, []);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      data-desktop-left-panel-map-home="true"
      aria-label="쯔동여지도 홈 추천과 리뷰"
    >
      <div
        className="shrink-0 border-b border-border bg-background px-3 py-3"
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

        <div className="space-y-1.5">
          {isLoading ? (
            Array.from({ length: POPULAR_RESTAURANT_LIMIT }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2"
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
                className="group flex w-full items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        className="flex min-h-0 flex-1 flex-col"
        data-desktop-left-panel-review-feed="true"
        onWheel={requestReviewFeed}
        onPointerDown={requestReviewFeed}
        onPointerEnter={requestReviewFeed}
        onFocusCapture={requestReviewFeed}
        onTouchMove={requestReviewFeed}
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 py-2">
          <MessageSquareText
            className="h-4 w-4 text-primary"
            aria-hidden="true"
          />
          <h2 className="text-sm font-bold text-foreground">사용자 맛집 리뷰</h2>
          <span className="text-[11px] text-muted-foreground">
            아래로 스크롤해 계속 보기
          </span>
        </div>
        {shouldLoadReviewFeed ? (
          <FeedContent
            variant="overlay"
            showHeader={false}
            hideFloatingButton
            hideReviewModal
            onOpenRestaurantDetail={handleFeedRestaurantOpen}
            onOpenUserProfile={onOpenUserProfile}
            onOpenAuth={onOpenAuth}
          />
        ) : (
          <button
            type="button"
            onClick={requestReviewFeed}
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
            aria-label="사용자 맛집 리뷰 불러오기"
          >
            <MessageSquareText className="h-6 w-6 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">
              사용자 리뷰를 이어서 볼 수 있어요
            </span>
            <span className="max-w-[16rem] text-xs leading-5">
              리뷰 영역에 마우스를 올리거나 스크롤하면 최신 리뷰를 불러옵니다.
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
