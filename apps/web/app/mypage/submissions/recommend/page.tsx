"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExternalLink,
  Youtube,
  MapPin,
  Store,
  Phone,
  Tag,
  Heart,
  MessageSquare,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { MyPageSectionSkeleton } from "@/components/mypage/MyPageSectionSkeleton";
import {
  MyPageEmptyState,
  MyPageErrorState,
  MyPageSectionFrame,
  myPageListCardClass,
} from "@/components/mypage/MyPageSectionFrame";

interface RestaurantRequest {
  id: string;
  user_id: string;
  restaurant_name: string;
  origin_address: string | null;
  road_address: string | null;
  jibun_address: string | null;
  english_address: string | null;
  phone: string | null;
  categories: string[] | null;
  recommendation_reason: string;
  youtube_link: string | null;
  lat: number | null;
  lng: number | null;
  geocoding_success: boolean;
  created_at: string;
}

const PAGE_SIZE = 15;
const RESTAURANT_REQUEST_SELECT = [
  "id",
  "user_id",
  "restaurant_name",
  "origin_address",
  "road_address",
  "jibun_address",
  "english_address",
  "phone",
  "categories",
  "recommendation_reason",
  "youtube_link",
  "lat",
  "lng",
  "geocoding_success",
  "created_at",
].join(", ");

export default function RecommendSubmissionsPage() {
  const { user } = useAuth();

  const {
    data: requestsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["myRecommendRequests", user?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { data: [], nextCursor: null };

      const { data, error } = await supabase
        .from("restaurant_requests")
        .select(RESTAURANT_REQUEST_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;

      return {
        data: data as RestaurantRequest[],
        nextCursor:
          data && data.length === PAGE_SIZE ? pageParam + PAGE_SIZE : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!user?.id,
    initialPageParam: 0,
  });

  const requests = requestsData?.pages.flatMap((page) => page.data) || [];
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [loadMore]);

  const renderRequestCard = (request: RestaurantRequest) => {
    const displayAddress =
      request.road_address || request.jibun_address || request.origin_address;

    return (
      <Card key={request.id} className={myPageListCardClass}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Store className="h-4 w-4 text-muted-foreground shrink-0" />
                <CardTitle className="text-lg">
                  {request.restaurant_name}
                </CardTitle>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 지오코딩 상태 표시 */}
              {request.geocoding_success ? (
                <Badge
                  variant="outline"
                  className="gap-1 text-green-600 border-green-300"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  위치확인
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1 text-amber-600 border-amber-300"
                >
                  <XCircle className="h-3 w-3" />
                  위치미확인
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* 맛집 정보 */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            {displayAddress && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p>{displayAddress}</p>
                  {/* 주소 상세 정보가 있으면 표시 */}
                  {request.road_address &&
                    request.jibun_address &&
                    request.road_address !== request.jibun_address && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        (지번) {request.jibun_address}
                      </p>
                    )}
                </div>
              </div>
            )}
            {request.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm">{request.phone}</p>
              </div>
            )}
            {request.categories && request.categories.length > 0 && (
              <div className="flex items-start gap-2">
                <Tag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {request.categories.map((cat, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {cat}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 추천 이유 */}
          <div className="bg-pink-50 dark:bg-pink-950/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-pink-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-pink-700 dark:text-pink-300 mb-1">
                  추천 이유
                </p>
                <p className="text-sm">{request.recommendation_reason}</p>
              </div>
            </div>
          </div>

          {/* 관련 유튜브 영상 */}
          {request.youtube_link && (
            <div className="flex items-center gap-2">
              <Youtube className="h-4 w-4 text-red-500" />
              <a
                href={request.youtube_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-500 hover:underline truncate"
              >
                관련 영상 보기
                <ExternalLink className="h-3 w-3 inline ml-1" />
              </a>
            </div>
          )}

          {/* 날짜 정보 */}
          <div className="flex items-center text-xs text-muted-foreground pt-2 border-t">
            <span>
              추천일:{" "}
              {format(new Date(request.created_at), "yyyy년 M월 d일 HH:mm", {
                locale: ko,
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return <MyPageSectionSkeleton label="쯔양 맛집 제보 내역을 불러오는 중…" />;
  }

  if (isError) {
    return (
      <MyPageErrorState
        title="쯔양 맛집 제보를 불러오지 못했습니다"
        description="추천한 맛집 목록을 다시 불러오려면 잠시 후 재시도해주세요."
      />
    );
  }

  return (
    <MyPageSectionFrame
      icon={Heart}
      eyebrow="제보 관리"
      title="쯔양 맛집 제보"
      description="쯔양에게 추천한 맛집과 위치 확인 상태를 차분하게 확인합니다."
      countLabel={`총 ${requests.length}건`}
      data-section="submissions-recommend"
    >
      {requests.length === 0 ? (
        <MyPageEmptyState
          icon={Heart}
          title="아직 쯔양에게 추천한 맛집이 없습니다"
          description="추천한 맛집은 이곳에서 다시 확인할 수 있습니다."
        />
      ) : (
        <div
          className="grid gap-3 xl:grid-cols-2"
          data-mypage-responsive-list="submissions-recommend"
        >
          {requests.map(renderRequestCard)}
          <div
            ref={loadMoreRef}
            className="flex justify-center pt-4 xl:col-span-2"
          >
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                더 불러오는 중...
              </div>
            )}
          </div>
        </div>
      )}
    </MyPageSectionFrame>
  );
}
