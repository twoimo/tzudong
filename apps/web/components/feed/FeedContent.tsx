'use client';

import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Heart, MapPin, Calendar, User, MessageSquareText, Plus, Eye, EyeOff, Filter, Search, Edit, Share2, Check, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { FeedSkeleton } from "@/components/ui/skeleton-loaders";
import { useReviewLikesRealtime } from '@/hooks/use-review-likes-realtime';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { ReviewModal } from '@/components/reviews/ReviewModal';
import { ReviewEditModal } from '@/components/reviews/ReviewEditModal';
import { Carousel, CarouselContent, CarouselItem, CarouselOverlayPrevious, CarouselOverlayNext, type CarouselApi } from "@/components/ui/carousel";


// [PERF] 모듈 레벨 포맷터 캐시 - 매 호출시 Intl.DateTimeFormat 재생성 방지
const DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
});

// ========== Types ==========
export interface FeedReview {
    id: string;
    userId: string;
    restaurantId: string;
    restaurantName: string;
    userName: string;
    userAvatarUrl?: string;
    visitedAt: string;
    createdAt: string;
    content: string;
    photos: string[];
    categories: string[];
    likeCount: number;
    isLikedByUser: boolean;
    restaurant: any; // Full restaurant object
}

interface FeedContentProps {
    /** 'page': 전체 페이지 (모바일/태블릿), 'overlay': 오버레이 (데스크탑) */
    variant: 'page' | 'overlay';
    /** 오버레이 닫기 버튼 핸들러 */
    onClose?: () => void;
    /** 외부 리뷰 모달 핸들러 */
    onOpenReviewModal?: () => void;
    /** 내장 리뷰 모달 숨김 */
    hideReviewModal?: boolean;
    /** 플로팅 버튼 숨김 */
    hideFloatingButton?: boolean;
    /** 초기 하이라이트 리뷰 ID (Deep Link) */
    initialReviewId?: string | null;
    /** 맛집 상세 모달 열기 핸들러 (오버레이용) */
    onOpenRestaurantDetail?: (restaurant: any) => void;
    /** 유저 프로필 모달 열기 핸들러 (오버레이용) */
    onOpenUserProfile?: (userId: string) => void;
}


// ========== Main Component ==========
export default function FeedContent({
    variant,
    onClose,
    onOpenReviewModal,
    hideReviewModal,
    hideFloatingButton,
    initialReviewId,
    onOpenRestaurantDetail,
    onOpenUserProfile,
}: FeedContentProps) {

    const { user } = useAuth();
    const router = useRouter();
    const queryClient = useQueryClient();
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [optimisticLikes, setOptimisticLikes] = useState<Record<string, { count: number; isLiked: boolean }>>({});
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [showMyReviewsOnly, setShowMyReviewsOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);
    const [editingReview, setEditingReview] = useState<{
        id: string;
        restaurantId: string;
        restaurantName: string;
        content: string;
        categories: string[];
        foodPhotos: string[];
        isVerified: boolean;
        adminNote: string | null;
    } | null>(null);

    const isLoggedIn = !!user;
    const isOverlay = variant === 'overlay';
    const queryKey = isOverlay ? 'review-feed-overlay' : 'review-feed';
    const reviewIdPrefix = isOverlay ? 'overlay-review' : 'review';

    // [REALTIME] 좋아요 실시간 반영
    useReviewLikesRealtime();

    // [리뷰 공유] 스크롤 타겟
    const searchParams = useSearchParams();
    const targetReviewId = searchParams?.get('review') || null;
    const [highlightedReviewId, setHighlightedReviewId] = useState<string | null>(null);

    // [성능 최적화] 검색어 디바운싱 (300ms)
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 300);
        return () => clearTimeout(handler);
    }, [searchQuery]);

    // [리뷰 공유] URL 파라미터로 스크롤 (마운트 시)
    useEffect(() => {
        // URL에서 review 파라미터 직접 확인 (overlay일 때만 searchParams가 null일 수 있음)
        const urlParams = new URLSearchParams(window.location.search);
        const urlReviewId = urlParams.get('review');
        const effectiveReviewId = initialReviewId || urlReviewId;

        if (effectiveReviewId) {
            setHighlightedReviewId(effectiveReviewId);

            let attempts = 0;

            const maxAttempts = 30;

            const scrollToElement = () => {
                const element = document.getElementById(`${reviewIdPrefix}-${effectiveReviewId}`);
                if (element) {
                    // [MOBILE/DESKTOP] 공통 스크롤 로직
                    // block: 'center'는 화면 중앙에 위치시킴
                    requestAnimationFrame(() => {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });

                    // 강조 효과 해제 타이머
                    setTimeout(() => setHighlightedReviewId(null), 3000);
                } else if (attempts < maxAttempts) {
                    attempts++;
                    // 재시도 간격 200ms -> 30회 = 6초
                    setTimeout(scrollToElement, 200);
                }
            };

            setTimeout(scrollToElement, 500);
        }
    }, [reviewIdPrefix]);

    // 리뷰 작성 핸들러
    const handleWriteReview = useCallback(() => {
        if (!user) {
            toast({
                title: '로그인이 필요합니다',
                description: '리뷰를 작성하려면 로그인이 필요합니다.',
                variant: 'destructive',
            });
            return;
        }
        if (onOpenReviewModal) {
            onOpenReviewModal();
        } else {
            setIsReviewModalOpen(true);
        }
    }, [user, onOpenReviewModal]);

    // 리뷰 피드 데이터 조회 (무한 스크롤)
    const {
        data: feedPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: [queryKey, user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select('*')
                .eq('is_verified', true)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19) as any;

            if (reviewsError || !reviewsData || reviewsData.length === 0) {
                return { reviews: [], nextCursor: null };
            }

            const userIds = [...new Set(reviewsData.map((r: any) => r.user_id))];
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname, avatar_url')
                .in('user_id', userIds) as any;
            const profilesMap = new Map((profilesData || []).map((p: any) =>
                [p.user_id, { nickname: p.nickname, avatarUrl: p.avatar_url }]
            ));

            const restaurantIds = [...new Set(reviewsData.map((r: any) => r.restaurant_id))];
            const { data: restaurantsData } = await supabase
                .from('restaurants')
                .select('*')
                .in('id', restaurantIds) as any;

            const restaurantsMap = new Map<string, any>((restaurantsData || []).map((r: any) => {
                const mappedR = { ...r };
                // approved_name을 name으로 사용 (호환성)
                if (mappedR.approved_name) {
                    mappedR.name = mappedR.approved_name;
                }
                return [r.id, mappedR];
            }));

            const reviewIds = reviewsData.map((r: any) => r.id);
            let userLikesMap = new Map<string, boolean>();

            if (user) {
                const { data: userLikesData } = await supabase
                    .from('review_likes')
                    .select('review_id')
                    .in('review_id', reviewIds)
                    .eq('user_id', user.id) as any;

                userLikesMap = new Map(
                    (userLikesData || []).map((like: any) => [like.review_id, true])
                );
            }

            const reviews: FeedReview[] = reviewsData.map((review: any) => {
                const profileInfo = (profilesMap.get(review.user_id) || { nickname: '탈퇴한 사용자', avatarUrl: undefined }) as { nickname: string; avatarUrl?: string };
                return {
                    id: review.id,
                    userId: review.user_id,
                    restaurantId: review.restaurant_id,
                    restaurantName: restaurantsMap.get(review.restaurant_id)?.name || '알 수 없음',
                    restaurant: restaurantsMap.get(review.restaurant_id),
                    userName: profileInfo.nickname || '탈퇴한 사용자',
                    userAvatarUrl: profileInfo.avatarUrl,
                    visitedAt: review.visited_at,
                    createdAt: review.created_at,
                    content: review.content,
                    photos: review.food_photos || [],
                    categories: (Array.isArray(review.categories) && review.categories.length > 0)
                        ? review.categories
                        : (review.category ? [review.category] : []),
                    likeCount: review.like_count || 0,
                    isLikedByUser: userLikesMap.get(review.id) || false,
                };
            });

            const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;
            return { reviews, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
    });

    const allReviews = useMemo(() => {
        let reviews = feedPages?.pages.flatMap(page => page.reviews) || [];
        if (showMyReviewsOnly && user?.id) {
            reviews = reviews.filter(review => review.userId === user.id);
        }
        if (debouncedQuery.trim()) {
            const query = debouncedQuery.trim().toLowerCase();
            reviews = reviews.filter(review =>
                review.restaurantName.toLowerCase().includes(query) ||
                review.userName.toLowerCase().includes(query) ||
                review.content.toLowerCase().includes(query)
            );
        }
        return reviews;
    }, [feedPages, showMyReviewsOnly, user?.id, debouncedQuery]);

    // 무한 스크롤
    const loadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMore]);

    // 좋아요 토글
    const toggleLike = useCallback(async (reviewId: string, currentIsLiked: boolean, currentCount: number, reviewUserId: string) => {
        if (!user) {
            toast({
                title: '로그인 필요',
                description: '좋아요를 누르려면 로그인이 필요합니다.',
                variant: 'destructive',
            });
            return;
        }

        setOptimisticLikes(prev => ({
            ...prev,
            [reviewId]: {
                count: currentIsLiked ? currentCount - 1 : currentCount + 1,
                isLiked: !currentIsLiked,
            }
        }));

        try {
            if (currentIsLiked) {
                await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id);
            } else {
                await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id } as any);

                if (reviewUserId && reviewUserId !== user.id) {
                    try {
                        const { data: profileData } = await (supabase.from('profiles') as any)
                            .select('nickname')
                            .eq('user_id', user.id)
                            .single();

                        const likerName = (profileData as any)?.nickname || '누군가';

                        await (supabase as any).rpc('create_user_notification', {
                            p_user_id: reviewUserId,
                            p_type: 'review_like',
                            p_title: '리뷰에 좋아요가 눌렸어요!',
                            p_message: `${likerName}님이 당신의 리뷰에 좋아요를 눌렀습니다.`,
                            p_data: { reviewId }
                        });
                    } catch (notifError) {
                        console.error('알림 생성 실패:', notifError);
                    }
                }
            }
            queryClient.invalidateQueries({ queryKey: [queryKey] });
        } catch (error) {
            console.error('좋아요 토글 실패:', error);
            setOptimisticLikes(prev => ({
                ...prev,
                [reviewId]: { count: currentCount, isLiked: currentIsLiked }
            }));
        }
    }, [user, queryClient, queryKey]);

    // 맛집으로 이동
    const goToRestaurant = useCallback((restaurantId: string, restaurant?: any) => {
        // [오버레이] onOpenRestaurantDetail이 있으면 사이드 패널로 열기
        if (isOverlay && onOpenRestaurantDetail && restaurant) {
            onOpenRestaurantDetail(restaurant);
            return;
        }

        if (isOverlay && onClose) {
            onClose();
        }
        router.push(`/?restaurant=${restaurantId}`);
    }, [router, isOverlay, onClose, onOpenRestaurantDetail]);

    // [PERF] 날짜 포맷 - 모듈 레벨 formatter 캐시 사용
    const formatDate = useCallback((dateString: string) => {
        return DATE_FORMATTER.format(new Date(dateString));
    }, []);

    return (
        <div className={cn(
            "flex flex-col h-full",
            !isOverlay && "bg-muted/30 overflow-y-auto"
        )} data-testid="feed-content-container">
            <div className={cn(
                "w-full mx-auto bg-background flex flex-col relative",
                isOverlay ? "h-full" : "min-h-full md:border-x md:border-border md:shadow-sm max-w-2xl"
            )}>
                {/* 헤더 */}
                <div className="border-b border-border bg-background p-6 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                                <MessageSquareText className="h-6 w-6 text-primary" />
                                쯔동여지도 리뷰
                                <span className="text-sm font-normal text-muted-foreground">
                                    ({allReviews.length}개)
                                </span>
                            </h1>
                            <p className="text-sm text-muted-foreground mt-1">
                                {isLoggedIn
                                    ? "맛집 방문 후기를 공유해보세요!"
                                    : "로그인하여 리뷰를 작성해보세요!"
                                }
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {isLoggedIn && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-full hover:bg-muted"
                                    onClick={() => setShowMyReviewsOnly(!showMyReviewsOnly)}
                                    title={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}
                                >
                                    {showMyReviewsOnly ? (
                                        <EyeOff className="h-5 w-5 text-primary" />
                                    ) : (
                                        <Eye className="h-5 w-5 text-muted-foreground" />
                                    )}
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                                title="검색 필터"
                            >
                                <Filter className="h-4 w-4" />
                            </Button>
                            {isOverlay && onClose && (
                                <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 hover:bg-muted rounded-full">
                                    <X className="h-5 w-5" />
                                </Button>
                            )}
                        </div>
                    </div>
                    {isFilterExpanded && (
                        <div className="mt-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="맛집명, 작성자, 내용 검색..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* 피드 목록 */}
                {/* [FIX] 모바일 하단 네비게이션 높이 고려하여 패딩 증가 */}
                <div className={cn(
                    "flex-1 pb-[calc(var(--mobile-bottom-nav-height,60px)+2rem)] md:pb-8",
                    isOverlay && "overflow-y-auto"
                )}>
                    {isLoading ? (
                        <FeedSkeleton count={4} />
                    ) : allReviews.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <p>아직 승인된 리뷰가 없습니다.</p>
                        </div>
                    ) : (
                        <div className="space-y-4 p-4">
                            {allReviews.map((review) => {
                                const optimistic = optimisticLikes[review.id];
                                const likeCount = optimistic?.count ?? review.likeCount;
                                const isLiked = optimistic?.isLiked ?? review.isLikedByUser;

                                return (
                                    <ReviewCard
                                        key={review.id}
                                        idPrefix={reviewIdPrefix}
                                        isHighlighted={highlightedReviewId === review.id}
                                        review={{
                                            id: review.id,
                                            userId: review.userId,
                                            userName: review.userName,
                                            userAvatarUrl: review.userAvatarUrl,
                                            restaurantId: review.restaurantId,
                                            restaurantName: review.restaurantName,
                                            content: review.content,
                                            photos: review.photos.map(p => ({ url: p, type: 'image' })),
                                            visitedAt: review.visitedAt,
                                            submittedAt: review.createdAt,
                                            isVerified: true,
                                            categories: review.categories,
                                            // Optimistic updates
                                            likeCount: likeCount,
                                            isLikedByUser: isLiked,
                                        }}
                                        onLike={(reviewId) => toggleLike(reviewId, isLiked, likeCount, review.userId)}
                                        onRestaurantClick={() => goToRestaurant(review.restaurantId, review.restaurant)}
                                        currentUserId={user?.id}
                                        onEditReview={setEditingReview}
                                        onUserClick={onOpenUserProfile}
                                    />
                                );
                            })}
                            <div ref={loadMoreRef} className={cn(
                                "flex items-center justify-center transition-all duration-300",
                                isFetchingNextPage ? "h-20" : "h-4"
                            )}>
                                {isFetchingNextPage && (
                                    <div className="flex items-center gap-2">
                                        <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                                        <span className="text-sm text-muted-foreground">더 불러오는 중...</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 플로팅 리뷰 작성 버튼 */}
                {isLoggedIn && !hideFloatingButton && (() => {
                    const FloatingButton = (
                        <Button
                            onClick={handleWriteReview}
                            className={cn(
                                "h-14 w-14 rounded-full shadow-lg bg-gradient-primary hover:opacity-90",
                                isOverlay
                                    ? "absolute right-8 bottom-8 z-[100]"
                                    : "fixed right-4 bottom-20 md:right-8 md:bottom-8 z-50"
                            )}
                            size="icon"
                        >
                            <Plus className="h-6 w-6" />
                        </Button>
                    );

                    return isOverlay
                        ? FloatingButton
                        : (typeof document !== 'undefined' && createPortal(FloatingButton, document.body));
                })()}

                {/* 리뷰 작성 모달 */}
                {!hideReviewModal && (
                    <ReviewModal
                        isOpen={isReviewModalOpen}
                        onClose={() => setIsReviewModalOpen(false)}
                        restaurant={null}
                        onSuccess={() => {
                            queryClient.invalidateQueries({ queryKey: [queryKey] });
                            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
                        }}
                    />
                )}

                {/* 리뷰 수정 모달 */}
                <ReviewEditModal
                    isOpen={!!editingReview}
                    onClose={() => setEditingReview(null)}
                    review={editingReview}
                    onSuccess={() => {
                        queryClient.invalidateQueries({ queryKey: [queryKey] });
                        setEditingReview(null);
                    }}
                />
            </div>
        </div>
    );
}
