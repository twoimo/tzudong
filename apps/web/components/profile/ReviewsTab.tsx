'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    MessageSquare,
    Calendar,
    CheckCircle,
    Clock,
    XCircle,
    Trash2,
    AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

export default function ReviewsTab() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    // 내 리뷰 조회 - 무한 스크롤
    const {
        data: reviewsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        refetch,
    } = useInfiniteQuery({
        queryKey: ["my-reviews", user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user?.id) return { reviews: [], nextCursor: null };

            try {
                const { data: reviewsData, error: reviewsError } = await supabase
                    .from("reviews")
                    .select("*")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false })
                    .range(pageParam, pageParam + 19);

                if (reviewsError) throw reviewsError;
                if (!reviewsData || reviewsData.length === 0) return { reviews: [], nextCursor: null };

                // 레스토랑 정보 조회
                const restaurantIds = [...new Set(reviewsData.map((r: any) => r.restaurant_id))];
                const { data: restaurantsData } = await supabase
                    .from("restaurants")
                    .select("id, name")
                    .in("id", restaurantIds);

                const restaurantsMap = new Map<string, string>(
                    (restaurantsData || []).map((r: any) => [r.id, r.name])
                );

                const reviews: MyReview[] = reviewsData.map((review: any) => ({
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
                    categories: review.categories || [],
                }));

                const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;
                return { reviews, nextCursor };
            } catch (error) {
                console.error("리뷰 조회 오류:", error);
                return { reviews: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!user?.id,
    });

    const allReviews = reviewsPages?.pages.flatMap((page) => page.reviews) || [];
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreReviews = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMoreReviews();
            },
            { threshold: 0.1 }
        );
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [loadMoreReviews]);

    const handleDeleteReview = async (reviewId: string) => {
        if (!confirm("정말로 이 리뷰를 삭제하시겠습니까?")) return;

        const { error } = await supabase.from("reviews").delete().eq("id", reviewId);

        if (error) {
            toast.error(error.message || "삭제 실패");
        } else {
            toast.success("리뷰를 삭제했습니다");
            refetch();
            queryClient.invalidateQueries({ queryKey: ["user-reviews"] });
        }
    };

    const renderStatusBadge = (review: MyReview) => {
        if (review.isVerified) {
            return <Badge variant="default" className="gap-1 bg-green-600 text-[10px] h-5"><CheckCircle className="h-2 w-2" /> 승인</Badge>;
        }
        if (review.adminNote?.includes("거부")) {
            return <Badge variant="destructive" className="gap-1 text-[10px] h-5"><XCircle className="h-2 w-2" /> 거부</Badge>;
        }
        return <Badge variant="secondary" className="gap-1 text-[10px] h-5"><Clock className="h-2 w-2" /> 대기</Badge>;
    };

    if (isLoading) {
        return (
            <div className="text-center py-12 text-muted-foreground bg-muted/10 h-full flex items-center justify-center">
                로딩 중...
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-muted/10">
            {allReviews.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                    <MessageSquare className="h-10 w-10 mb-3 opacity-50" />
                    <p className="text-sm font-medium">아직 작성한 리뷰가 없습니다</p>
                    <p className="text-xs mt-1">맛집 방문 후 리뷰를 남겨보세요!</p>
                </div>
            ) : (
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-3 pb-4">
                        {allReviews.map((review, index) => (
                            <Card
                                key={review.id}
                                ref={index === allReviews.length - 1 ? loadMoreRef : null}
                                className={`overflow-hidden ${review.isPinned ? "border-primary border-2" : ""}`}
                            >
                                <CardContent className="p-3">
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <h3 className="font-bold text-sm truncate">{review.restaurantName}</h3>
                                                {renderStatusBadge(review)}
                                            </div>
                                            {review.categories.length > 0 && (
                                                <div className="flex gap-1">
                                                    {review.categories.map((cat, idx) => (
                                                        <Badge key={idx} variant="secondary" className="text-[10px] px-1 h-4">
                                                            {cat}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteReview(review.id)}
                                            className="h-6 w-6 text-muted-foreground hover:text-destructive -mr-1 -mt-1 p-0"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>

                                    <p className="text-xs text-foreground mb-2 whitespace-pre-wrap line-clamp-3">
                                        {review.content}
                                    </p>

                                    {/* 사진 섬네일들 */}
                                    {review.foodPhotos.length > 0 && (
                                        <div className="flex gap-2 mb-2 overflow-x-auto pb-1 scrollbar-hide">
                                            {review.foodPhotos.map((photo, idx) => (
                                                <div key={idx} className="w-12 h-12 bg-muted rounded overflow-hidden flex-shrink-0">
                                                    <img
                                                        src={supabase.storage.from("review-photos").getPublicUrl(photo).data.publicUrl}
                                                        alt={`사진 ${idx}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {review.adminNote?.includes("거부") && (
                                        <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded mb-2">
                                            <div className="flex items-center gap-1 mb-0.5">
                                                <AlertCircle className="h-3 w-3 text-red-600" />
                                                <span className="text-xs font-medium text-red-700 dark:text-red-300">
                                                    거부 사유
                                                </span>
                                            </div>
                                            <p className="text-xs text-red-600 dark:text-red-400">
                                                {review.adminNote.startsWith("거부: ") ? review.adminNote.substring(4) : review.adminNote}
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t mt-1">
                                        <span>방문: {new Date(review.visitedAt).toLocaleDateString()}</span>
                                        <span>작성: {new Date(review.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {isFetchingNextPage && (
                            <div className="text-center py-2 text-xs text-muted-foreground">더 불러오는 중...</div>
                        )}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
}
