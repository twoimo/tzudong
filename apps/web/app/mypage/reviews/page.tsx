"use client";

import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { GlobalLoader } from "@/components/ui/global-loader";

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
  category: string | null;
}

interface RestaurantData {
  id: string;
  name: string;
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
  const searchParams = useSearchParams();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [editingReview, setEditingReview] = useState<MyReview | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [highlightedReviewId, setHighlightedReviewId] = useState<string | null>(null);

  // 내 리뷰 조회 - 무한 스크롤
  const {
    data: reviewsPages,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["my-reviews", user?.id, filterStatus],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { reviews: [], nextCursor: null };

      try {
        // 1. 현재 사용자의 모든 리뷰 조회
        const { data: reviewsData, error: reviewsError } = await supabase
          .from("reviews")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .range(pageParam, pageParam + 19) // 페이지당 20개
          .returns<ReviewData[]>();

        if (reviewsError) {
          console.error("리뷰 조회 실패:", reviewsError);
          return { reviews: [], nextCursor: null };
        }

        if (!reviewsData || reviewsData.length === 0) {
          return { reviews: [], nextCursor: null };
        }

        // 2. 레스토랑 정보 조회
        const restaurantIds = [...new Set(reviewsData.map((r) => r.restaurant_id))];
        const { data: restaurantsData } = await supabase
          .from("restaurants")
          .select("id, name:approved_name") // [수정] approved_name을 name으로 사용
          .in("id", restaurantIds)
          .returns<RestaurantData[]>();

        const restaurantsMap = new Map<string, string>(
          (restaurantsData || []).map((r) => [r.id, r.name])
        );

        // 3. 리뷰 데이터 매핑
        const reviews: MyReview[] = reviewsData.map((review) => ({
          id: review.id,
          restaurantId: review.restaurant_id,
          restaurantName: restaurantsMap.get(review.restaurant_id) || "알 수 없음",
          title: review.title,
          content: review.content,
          visitedAt: review.visited_at,
          createdAt: review.created_at,
          isVerified: review.is_verified || false,
          adminNote: review.admin_note,
          isPinned: review.is_pinned || false,
          isEditedByAdmin: review.is_edited_by_admin || false,
          foodPhotos: review.food_photos || [],
          categories: (Array.isArray(review.categories) && review.categories.length > 0)
            ? review.categories
            : (review.category ? [review.category] : []),
        }));

        const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;
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
  const allReviews = useMemo(() =>
    reviewsPages?.pages.flatMap((page) => page.reviews) || [],
    [reviewsPages?.pages]);

  // 상태별 필터링 (Memoization)
  const filteredReviews = useMemo(() => {
    return allReviews.filter((review) => {
      if (filterStatus === "all") return true;
      if (filterStatus === "approved") return review.isVerified;
      if (filterStatus === "rejected") return !review.isVerified && review.adminNote?.includes("거부");
      if (filterStatus === "pending") return !review.isVerified && (!review.adminNote || !review.adminNote.includes("거부"));
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
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [loadMoreReviews]);

  // URL 쿼리 파라미터 처리
  useEffect(() => {
    const status = searchParams.get('status');
    const reviewId = searchParams.get('reviewId');

    if (status && ['all', 'approved', 'pending', 'rejected'].includes(status)) {
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
        const element = document.getElementById(`review-${highlightedReviewId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 하이라이트 효과를 위해 클래스 추가 및 일정 시간 후 제거
          element.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
          setTimeout(() => {
            element.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
            setHighlightedReviewId(null); // 하이라이트 상태 초기화
          }, 3000);
        }
      });
    }
  }, [highlightedReviewId, reviewsPages]); // FilterStatus dependency removed as it might cause unwanted scrolling

  // 리뷰 삭제
  const handleDeleteReview = async (reviewId: string) => {
    if (!confirm("정말로 이 리뷰를 삭제하시겠습니까?")) {
      return;
    }

    const { error } = await supabase.from("reviews").delete().eq("id", reviewId);

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
      refetch();
      queryClient.invalidateQueries({ queryKey: ["user-reviews"] });
    }
  };

  // 로딩 상태
  if (isLoading) {
    return (
      <GlobalLoader
        message="리뷰를 불러오는 중..."
        subMessage="작성하신 리뷰 목록을 확인하고 있습니다"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" />
            리뷰 내역
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            총 {filteredReviews.length}개의 리뷰
          </p>
        </div>

        {/* 상태 필터 */}
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="approved">승인</SelectItem>
            <SelectItem value="pending">대기</SelectItem>
            <SelectItem value="rejected">거부</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 리뷰 목록 */}
      {filteredReviews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">아직 작성한 리뷰가 없습니다</p>
            <p className="text-sm mt-2">
              맛집 방문 후 리뷰를 남겨보세요!
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-250px)] min-[1600px]:h-[calc(100vh-170px)]">
          <div className="space-y-4">
            {filteredReviews.map((review, index) => (
              <Card
                key={review.id}
                id={`review-${review.id}`}
                ref={index === filteredReviews.length - 1 ? loadMoreRef : null}
                className={`overflow-hidden transition-all duration-500 ${review.isPinned ? "border-primary border-2" : ""}`}
              >
                <CardContent className="p-4">
                  {/* 헤더: 맛집명 + 상태 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-lg">{review.restaurantName}</h3>
                        <ReviewStatusBadge review={review} />
                        {review.isEditedByAdmin && (
                          <Badge variant="outline" className="border-orange-500 text-orange-500 text-xs">
                            관리자 수정됨
                          </Badge>
                        )}
                      </div>
                      {/* 카테고리 */}
                      {review.categories.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {review.categories.map((cat, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
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
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteReview(review.id)}
                        className="text-muted-foreground hover:text-destructive"
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
                          className="w-16 h-16 bg-muted rounded overflow-hidden"
                        >
                          <img
                            src={supabase.storage.from("review-photos").getPublicUrl(photo).data.publicUrl}
                            alt={`음식 사진 ${idx + 1}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
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
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      방문: {formatDate(review.visitedAt)}
                    </div>
                    <div>작성: {formatDate(review.createdAt)}</div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* 추가 로딩 표시 */}
            {isFetchingNextPage && (
              <div className="text-center py-4">
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full"></div>
                  <span className="text-sm text-muted-foreground">
                    더 불러오는 중...
                  </span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
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
    </div>
  );
}
