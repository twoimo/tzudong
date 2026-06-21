"use client";

import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  Trash2,
  AlertCircle,
  Edit,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { ReviewEditModal } from "@/components/reviews/ReviewEditModal";
import { MyPageSectionSkeleton } from "@/components/mypage/MyPageSectionSkeleton";
import {
  MyPageEmptyState,
  MyPageErrorState,
  MyPageSectionFrame,
  myPageCardTitleClass,
  myPageFooterMetaClass,
  myPageListCardClass,
  myPageListContentClass,
  myPageResponsiveListClass,
} from "@/components/mypage/MyPageSectionFrame";
import { findCanonicalVisitedRestaurant } from "@/lib/restaurant-visit-matching";
import type { Restaurant } from "@/types/restaurant";

const REVIEW_DELETE_CONFIRMATION = "리뷰삭제";

// 리뷰 데이터 타입 정의
interface MyReview {
  id: string;
  restaurantId: string;
  restaurantName: string;
  title: string;
  content: string;
  visitedAt: string;
  createdAt: string;
  isVerified: boolean;
  adminNote: string | null;
  isPinned: boolean;
  isEditedByAdmin: boolean;
  foodPhotos: string[];
  categories: string[];
}

interface ReviewData {
  id: string;
  restaurant_id: string;
  title: string;
  content: string;
  visited_at: string;
  created_at: string;
  is_verified: boolean;
  admin_note: string | null;
  is_pinned: boolean;
  is_edited_by_admin: boolean;
  food_photos: string[] | null;
  categories: string[] | null;
}

interface RestaurantData {
  id: string;
  name: string;
  approved_name?: string | null;
  road_address?: string | null;
  jibun_address?: string | null;
  status?: string | null;
}

function getRestaurantDisplayName(
  restaurant: RestaurantData | null | undefined,
): string {
  return restaurant?.name || restaurant?.approved_name || "알 수 없음";
}

// 날짜 포맷 함수 (컴포넌트 외부로 이동)
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};
const PAGE_SIZE = 15;
const MY_REVIEWS_SELECT =
  "id,restaurant_id,title,content,visited_at,created_at,is_verified,admin_note,is_pinned,is_edited_by_admin,food_photos,categories";
const EMPTY_SEARCH_PARAMS = new URLSearchParams();

// 상태 배지 컴포넌트 (Memoization)
const ReviewStatusBadge = memo(({ review }: { review: MyReview }) => {
  if (review.isVerified) {
    return (
      <Badge variant="default" className="gap-1 bg-green-600">
        <CheckCircle className="h-3 w-3" />
        승인
      </Badge>
    );
  }
  if (review.adminNote?.includes("거부")) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        거부
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" />
      대기
    </Badge>
  );
});
ReviewStatusBadge.displayName = "ReviewStatusBadge";

export default function ReviewsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS;
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [editingReview, setEditingReview] = useState<MyReview | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [highlightedReviewId, setHighlightedReviewId] = useState<string | null>(
    null,
  );
  const [deleteReviewTarget, setDeleteReviewTarget] = useState<MyReview | null>(
    null,
  );
  const [deleteReviewConfirmation, setDeleteReviewConfirmation] = useState("");

  // 내 리뷰 조회 - 무한 스크롤
  const {
    data: reviewsPages,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["my-reviews", user?.id, filterStatus],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { reviews: [], nextCursor: null };

      try {
        // 1. 현재 사용자의 모든 리뷰 조회
        const { data: reviewsData, error: reviewsError } = await supabase
          .from("reviews")
          .select(MY_REVIEWS_SELECT)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .range(pageParam, pageParam + PAGE_SIZE - 1) // 페이지당 15개
          .returns<ReviewData[]>();

        if (reviewsError) {
          console.error("리뷰 조회 실패:", reviewsError);
          return { reviews: [], nextCursor: null };
        }

        if (!reviewsData || reviewsData.length === 0) {
          return { reviews: [], nextCursor: null };
        }

        // 2. 레스토랑 정보 조회
        const restaurantIds = [
          ...new Set(reviewsData.map((r) => r.restaurant_id)),
        ];
        const { data: restaurantsData } = await supabase
          .from("restaurants")
          .select(
            "id, name:approved_name, approved_name, road_address, jibun_address, status",
          ) // [수정] approved_name을 name으로 사용
          .in("id", restaurantIds)
          .returns<RestaurantData[]>();

        const restaurantsMap = new Map<string, RestaurantData>(
          (restaurantsData || []).map((restaurant) => [
            restaurant.id,
            restaurant,
          ]),
        );
        const reviewedRestaurantNames = [
          ...new Set(
            (restaurantsData || [])
              .map((restaurant) =>
                (restaurant.approved_name || restaurant.name || "").trim(),
              )
              .filter(Boolean),
          ),
        ];
        const { data: approvedRestaurantRows } =
          reviewedRestaurantNames.length > 0
            ? await supabase
                .from("restaurants")
                .select(
                  "id, name:approved_name, approved_name, road_address, jibun_address, status",
                )
                .eq("status", "approved")
                .in("approved_name", reviewedRestaurantNames)
                .returns<RestaurantData[]>()
            : { data: [] };
        const approvedRestaurants = approvedRestaurantRows || [];

        // 3. 리뷰 데이터 매핑
        const reviews: MyReview[] = reviewsData.map((review) => {
          const reviewedRestaurant =
            restaurantsMap.get(review.restaurant_id) ?? null;
          const canonicalRestaurant =
            reviewedRestaurant?.status === "approved"
              ? reviewedRestaurant
              : ((findCanonicalVisitedRestaurant({
                  reviewedRestaurant: reviewedRestaurant as Restaurant | null,
                  reviewedRestaurantId: review.restaurant_id,
                  approvedRestaurants: approvedRestaurants as Restaurant[],
                }) as RestaurantData | null) ?? reviewedRestaurant);

          return {
            id: review.id,
            restaurantId: canonicalRestaurant?.id ?? review.restaurant_id,
            restaurantName: getRestaurantDisplayName(canonicalRestaurant),
            title: review.title,
            content: review.content,
            visitedAt: review.visited_at,
            createdAt: review.created_at,
            isVerified: review.is_verified || false,
            adminNote: review.admin_note,
            isPinned: review.is_pinned || false,
            isEditedByAdmin: review.is_edited_by_admin || false,
            foodPhotos: review.food_photos || [],
            categories:
              Array.isArray(review.categories) && review.categories.length > 0
                ? review.categories
                : [],
          };
        });

        const nextCursor =
          reviewsData.length === PAGE_SIZE ? pageParam + PAGE_SIZE : null;
        return { reviews, nextCursor };
      } catch (error) {
        console.error("리뷰 데이터 조회 중 오류:", error);
        return { reviews: [], nextCursor: null };
      }
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor,
    initialPageParam: 0,
    enabled: !!user?.id,
  });

  // 모든 페이지 데이터 평탄화 (Memoization)
  const allReviews = useMemo(
    () => reviewsPages?.pages.flatMap((page) => page.reviews) || [],
    [reviewsPages?.pages],
  );

  // 상태별 필터링 (Memoization)
  const filteredReviews = useMemo(() => {
    return allReviews.filter((review) => {
      if (filterStatus === "all") return true;
      if (filterStatus === "approved") return review.isVerified;
      if (filterStatus === "rejected")
        return !review.isVerified && review.adminNote?.includes("거부");
      if (filterStatus === "pending")
        return (
          !review.isVerified &&
          (!review.adminNote || !review.adminNote.includes("거부"))
        );
      return true;
    });
  }, [allReviews, filterStatus]);

  // 무한 스크롤 Intersection Observer
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const loadMoreReviews = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreReviews();
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [loadMoreReviews]);

  // URL 쿼리 파라미터 처리
  useEffect(() => {
    const status = searchParams.get("status");
    const reviewId = searchParams.get("reviewId");

    if (status && ["all", "approved", "pending", "rejected"].includes(status)) {
      setFilterStatus(status);
    }

    if (reviewId) {
      setHighlightedReviewId(reviewId);
    }
  }, [searchParams]);

  // 하이라이트된 리뷰로 스크롤
  useEffect(() => {
    if (highlightedReviewId && reviewsPages) {
      // 렌더링이 완료된 후 실행하기 위해 requestAnimationFrame 사용
      requestAnimationFrame(() => {
        const element = document.getElementById(
          `review-${highlightedReviewId}`,
        );
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          // 하이라이트 효과를 위해 클래스 추가 및 일정 시간 후 제거
          element.classList.add("ring-2", "ring-primary", "ring-offset-2");
          setTimeout(() => {
            element.classList.remove("ring-2", "ring-primary", "ring-offset-2");
            setHighlightedReviewId(null); // 하이라이트 상태 초기화
          }, 3000);
        }
      });
    }
  }, [highlightedReviewId, reviewsPages]); // FilterStatus dependency removed as it might cause unwanted scrolling

  // 리뷰 삭제
  const handleDeleteReview = async (reviewId: string) => {
    if (!user?.id) return;

    if (deleteReviewConfirmation !== REVIEW_DELETE_CONFIRMATION) {
      toast({
        title: "삭제 확인 문구가 일치하지 않습니다",
        description: `${REVIEW_DELETE_CONFIRMATION}를 입력해야 리뷰를 삭제할 수 있습니다.`,
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase
      .from("reviews")
      .delete()
      .eq("id", reviewId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "삭제 실패",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "삭제 완료",
        description: "리뷰를 삭제했습니다",
      });
      setDeleteReviewTarget(null);
      setDeleteReviewConfirmation("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["user-reviews"] });
    }
  };

  // 로딩 상태
  if (isLoading) {
    return <MyPageSectionSkeleton label="리뷰를 불러오는 중…" />;
  }

  if (isError) {
    return (
      <MyPageErrorState
        title="리뷰를 불러오지 못했습니다"
        description="작성한 리뷰 목록을 다시 불러오려면 잠시 후 재시도해주세요."
      />
    );
  }

  return (
    <MyPageSectionFrame
      icon={MessageSquare}
      eyebrow="내 활동"
      title="나의 리뷰 내역"
      description="작성한 리뷰와 검수 상태를 차분한 카드 흐름으로 확인합니다."
      countLabel={`총 ${filteredReviews.length}개`}
      action={
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger
            className="h-9 w-[104px] rounded-full border-0 bg-transparent px-2 text-xs shadow-none md:h-10 md:w-[140px] md:border md:bg-background md:px-3 md:text-sm"
            aria-label="리뷰 상태 필터"
          >
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="approved">승인</SelectItem>
            <SelectItem value="pending">대기</SelectItem>
            <SelectItem value="rejected">거부</SelectItem>
          </SelectContent>
        </Select>
      }
      data-section="reviews"
    >
      {filteredReviews.length === 0 ? (
        <MyPageEmptyState
          icon={MessageSquare}
          title="아직 작성한 리뷰가 없습니다"
          description="맛집 방문 후 리뷰를 남기면 이곳에서 상태를 확인할 수 있습니다."
        />
      ) : (
        <div
          className={myPageResponsiveListClass}
          data-mypage-responsive-list="reviews"
        >
          {filteredReviews.map((review, index) => (
            <Card
              key={review.id}
              id={`review-${review.id}`}
              ref={index === filteredReviews.length - 1 ? loadMoreRef : null}
              className={`${myPageListCardClass} transition-all duration-500 ${review.isPinned ? "border-primary border-2" : ""}`}
            >
              <CardContent className={myPageListContentClass}>
                {/* 헤더: 맛집명 + 상태 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={myPageCardTitleClass}>
                        {review.restaurantName}
                      </h3>
                      <ReviewStatusBadge review={review} />
                      {review.isEditedByAdmin && (
                        <Badge
                          variant="outline"
                          className="border-orange-500 text-orange-500 text-xs"
                        >
                          관리자 수정됨
                        </Badge>
                      )}
                    </div>
                    {/* 카테고리 */}
                    {review.categories.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {review.categories.map((cat, idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="text-xs"
                          >
                            {cat}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 수정/삭제 버튼 */}
                  <div className="flex gap-1">
                    {/* 수정 또는 재제출 버튼 */}
                    {review.adminNote?.includes("거부") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingReview(review);
                          setIsEditModalOpen(true);
                        }}
                        className="text-amber-600 hover:text-amber-700 gap-1"
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span className="hidden sm:inline">재제출</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingReview(review);
                          setIsEditModalOpen(true);
                        }}
                        className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-foreground"
                        aria-label={`${review.restaurantName} 리뷰 수정`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteReviewTarget(review);
                        setDeleteReviewConfirmation("");
                      }}
                      className="h-11 w-11 touch-manipulation text-muted-foreground hover:text-destructive"
                      aria-label={`${review.restaurantName} 리뷰 삭제 확인 열기`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* 리뷰 내용 */}
                <p className="text-sm text-foreground mb-3 whitespace-pre-wrap line-clamp-3">
                  {review.content}
                </p>

                {/* 음식 사진 섬네일 */}
                {(review.foodPhotos || []).length > 0 && (
                  <div className="flex gap-2 mb-3">
                    {(review.foodPhotos || []).slice(0, 4).map((photo, idx) => (
                      <div
                        key={idx}
                        className="relative w-16 h-16 bg-muted rounded overflow-hidden"
                      >
                        <Image
                          src={
                            supabase.storage
                              .from("review-photos")
                              .getPublicUrl(photo).data.publicUrl
                          }
                          alt={`음식 사진 ${idx + 1}`}
                          fill
                          sizes="64px"
                          className="object-cover"
                          onError={(e) => {
                            (
                              e.currentTarget as HTMLImageElement
                            ).style.display = "none";
                          }}
                        />
                      </div>
                    ))}
                    {(review.foodPhotos || []).length > 4 && (
                      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
                        +{(review.foodPhotos || []).length - 4}
                      </div>
                    )}
                  </div>
                )}

                {/* 거부 사유 */}
                {review.adminNote?.includes("거부") && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700 dark:text-red-300">
                        거부 사유
                      </span>
                    </div>
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {review.adminNote.startsWith("거부: ")
                        ? review.adminNote.substring(4)
                        : review.adminNote}
                    </p>
                  </div>
                )}

                {/* 푸터: 날짜 정보 */}
                <div className={myPageFooterMetaClass}>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    방문: {formatDate(review.visitedAt)}
                  </div>
                  <div>작성: {formatDate(review.createdAt)}</div>
                </div>

                {deleteReviewTarget?.id === review.id && (
                  <div
                    className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3"
                    role="region"
                    aria-label="리뷰 삭제 확인"
                  >
                    <p className="text-sm font-semibold text-destructive">
                      리뷰 삭제 확인
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      모바일과 데스크탑에서 동일하게 확인 문구를 입력한 뒤
                      삭제합니다. 삭제하려면{" "}
                      <strong>{REVIEW_DELETE_CONFIRMATION}</strong>를
                      입력하세요.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <Input
                        value={deleteReviewConfirmation}
                        onChange={(event) =>
                          setDeleteReviewConfirmation(event.target.value)
                        }
                        placeholder={REVIEW_DELETE_CONFIRMATION}
                        aria-label="리뷰 삭제 확인 문구"
                        className="bg-background"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setDeleteReviewTarget(null);
                          setDeleteReviewConfirmation("");
                        }}
                      >
                        취소
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={
                          deleteReviewConfirmation !==
                          REVIEW_DELETE_CONFIRMATION
                        }
                        onClick={() => handleDeleteReview(review.id)}
                      >
                        삭제
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {/* 추가 로딩 표시 */}
          {isFetchingNextPage && (
            <div className="py-4 text-center md:col-span-2 xl:col-span-3">
              <div className="flex items-center justify-center gap-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                <span className="text-sm text-muted-foreground">
                  더 불러오는 중…
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Review Edit Modal */}
      <ReviewEditModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingReview(null);
        }}
        review={editingReview}
        onSuccess={() => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ["user-reviews"] });
        }}
      />
    </MyPageSectionFrame>
  );
}
