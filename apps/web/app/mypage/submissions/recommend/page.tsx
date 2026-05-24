"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Trash2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { MyPageSectionSkeleton } from "@/components/mypage/MyPageSectionSkeleton";
import {
  MyPageEmptyState,
  MyPageErrorState,
  MyPageSectionFrame,
  myPageCardTitleClass,
  myPageFooterMetaClass,
  myPageInfoPanelClass,
  myPageInlineLinkClass,
  myPageListCardClass,
  myPageResponsiveListClass,
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
const REQUEST_DELETE_CONFIRMATION = "내역삭제";
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
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<RestaurantRequest | null>(
    null,
  );
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

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

  const deleteRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const response = await fetch("/api/mypage/submissions/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, type: "recommend" }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "쯔양 맛집 제보 삭제에 실패했습니다.");
      }
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      setDeleteConfirmation("");
      await queryClient.invalidateQueries({
        queryKey: ["myRecommendRequests", user?.id],
      });
      toast({
        title: "삭제 완료",
        description: "쯔양 맛집 제보 내역을 삭제했습니다.",
      });
    },
    onError: (error) => {
      toast({
        title: "삭제 실패",
        description:
          error instanceof Error
            ? error.message
            : "쯔양 맛집 제보 삭제에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteRequest = (request: RestaurantRequest) => {
    if (deleteConfirmation !== REQUEST_DELETE_CONFIRMATION) {
      toast({
        title: "삭제 확인 문구가 일치하지 않습니다",
        description: `${REQUEST_DELETE_CONFIRMATION}를 입력해야 삭제할 수 있습니다.`,
        variant: "destructive",
      });
      return;
    }

    deleteRequest.mutate(request.id);
  };

  const renderRequestCard = (request: RestaurantRequest) => {
    const displayAddress =
      request.road_address || request.jibun_address || request.origin_address;

    return (
      <Card key={request.id} className={myPageListCardClass}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
                <CardTitle className={myPageCardTitleClass}>
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeleteTarget(request);
                  setDeleteConfirmation("");
                }}
                className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive"
                aria-label={`${request.restaurant_name} 쯔양 맛집 제보 삭제 확인 열기`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* 맛집 정보 */}
          <div className={myPageInfoPanelClass}>
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
          <div className={myPageInfoPanelClass}>
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="mb-1 font-medium text-foreground">
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
                className={myPageInlineLinkClass}
              >
                관련 영상 보기
                <ExternalLink className="h-3 w-3 inline ml-1" />
              </a>
            </div>
          )}

          {/* 날짜 정보 */}
          <div className={myPageFooterMetaClass}>
            <span>
              추천일:{" "}
              {format(new Date(request.created_at), "yyyy년 M월 d일 HH:mm", {
                locale: ko,
              })}
            </span>
          </div>
          {deleteTarget?.id === request.id && (
            <div
              className="rounded-lg border border-destructive/25 bg-destructive/5 p-3"
              role="region"
              aria-label="쯔양 맛집 제보 삭제 확인"
            >
              <p className="text-sm font-semibold text-destructive">
                쯔양 맛집 제보 삭제 확인
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                삭제하려면 <strong>{REQUEST_DELETE_CONFIRMATION}</strong>를
                입력하세요.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  value={deleteConfirmation}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                  placeholder={REQUEST_DELETE_CONFIRMATION}
                  aria-label="쯔양 맛집 제보 삭제 확인 문구"
                  className="bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirmation("");
                  }}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    deleteRequest.isPending ||
                    deleteConfirmation !== REQUEST_DELETE_CONFIRMATION
                  }
                  onClick={() => handleDeleteRequest(request)}
                >
                  삭제
                </Button>
              </div>
            </div>
          )}
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
          className={myPageResponsiveListClass}
          data-mypage-responsive-list="submissions-recommend"
        >
          {requests.map(renderRequestCard)}
          <div
            ref={loadMoreRef}
            className="flex justify-center pt-4 md:col-span-2 xl:col-span-3"
          >
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                더 불러오는 중…
              </div>
            )}
          </div>
        </div>
      )}
    </MyPageSectionFrame>
  );
}
