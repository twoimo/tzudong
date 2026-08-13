'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { MessageSquareText, Plus, Eye, EyeOff, Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { FeedSkeleton } from "@/components/ui/skeleton-loaders";
import { useReviewLikesRealtime } from '@/hooks/use-review-likes-realtime';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { useMobileBottomNavAutoHide } from '@/hooks/use-mobile-bottom-nav-auto-hide';
import { findCanonicalVisitedRestaurant } from '@/lib/restaurant-visit-matching';
import { readPublicProfileSummaries } from '@/lib/public-profile-read';

const ReviewModal = dynamic(
    () => import('@/components/reviews/ReviewModal').then((mod) => ({ default: mod.ReviewModal })),
    { ssr: false }
);
const ReviewEditModal = dynamic(
    () => import('@/components/reviews/ReviewEditModal').then((mod) => ({ default: mod.ReviewEditModal })),
    { ssr: false }
);

export type FeedRestaurantRecord = Record<string, unknown> & {
    id: string;
    name?: string | null;
    approved_name?: string | null;
    road_address?: string | null;
    jibun_address?: string | null;
    status?: string | null;
};

interface FeedReviewRow {
    id: string;
    user_id: string;
    restaurant_id: string;
    visited_at: string;
    created_at: string;
    content: string;
    food_photos?: string[] | null;
    categories?: string[] | null;
    category?: string | null;
    like_count?: number | null;
}

interface FeedReviewLikeRow {
    review_id: string;
}


const FEED_REVIEW_SELECT = 'id,user_id,restaurant_id,visited_at,created_at,content,food_photos,categories,like_count';
const FEED_RESTAURANT_SELECT = 'id,name:approved_name,approved_name,road_address,jibun_address,english_address,phone,categories,review_count,youtube_link,tzuyang_review,youtube_meta,lat,lng,status,created_at,updated_at';

function getFeedRestaurantDisplayName(restaurant: FeedRestaurantRecord | null | undefined): string {
    return String(restaurant?.name || restaurant?.approved_name || '알 수 없음');
}

function normalizeFeedRestaurantRecord(restaurantRow: FeedRestaurantRecord): FeedRestaurantRecord {
    const mappedRestaurant: FeedRestaurantRecord = { ...restaurantRow };

    if (mappedRestaurant.approved_name) {
        mappedRestaurant.name = mappedRestaurant.approved_name;
    }

    return mappedRestaurant;
}

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
    restaurant: FeedRestaurantRecord | null; // Full restaurant object
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
    onOpenRestaurantDetail?: (restaurant: FeedRestaurantRecord) => void;
    /** 유저 프로필 모달 열기 핸들러 (오버레이용) */
    onOpenUserProfile?: (userId: string) => void;
    /** 로그인 모달 열기 */
    onOpenAuth?: () => void;
    /** 헤더/필터 영역 표시 여부 */
    showHeader?: boolean;
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
    onOpenAuth,
    showHeader = true,
}: FeedContentProps) {

    const { user } = useAuth();
    const router = useRouter();
    const queryClient = useQueryClient();
    const feedScrollRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const loopAppendLockRef = useRef(false);
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
    const [loopItemCount, setLoopItemCount] = useState(0);

    const isLoggedIn = !!user;
    const isOverlay = variant === 'overlay';
    const queryKey = isOverlay ? 'review-feed-overlay' : 'review-feed';
    const reviewIdPrefix = isOverlay ? 'overlay-review' : 'review';


    const feedBottomNavAutoHide = useMobileBottomNavAutoHide({
        scrollRef: feedScrollRef,
        source: 'review-feed-scroll',
        disabled: isOverlay,
    });

    // [REALTIME] 좋아요 실시간 반영
    useReviewLikesRealtime();

    // [리뷰 공유] 스크롤 타겟
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
    }, [reviewIdPrefix, initialReviewId]);

    // 리뷰 작성 핸들러
    const handleWriteReview = useCallback(() => {
        if (!user) {
            if (onOpenAuth) {
                onOpenAuth();
                return;
            }

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
    }, [user, onOpenReviewModal, onOpenAuth]);

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
            const REVIEW_PAGE_SIZE = 15;

            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select(FEED_REVIEW_SELECT)
                .eq('is_verified', true)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + (REVIEW_PAGE_SIZE - 1));

            const typedReviewsData = (reviewsData ?? []) as FeedReviewRow[];

            if (reviewsError || typedReviewsData.length === 0) {
                return { reviews: [], nextCursor: null };
            }

            const userIds = [...new Set(typedReviewsData.map((reviewRow) => reviewRow.user_id))];
            const restaurantIds = [...new Set(typedReviewsData.map((reviewRow) => reviewRow.restaurant_id))];
            const reviewIds = typedReviewsData.map((reviewRow) => reviewRow.id);
            const [profilesData, restaurantsResult, userLikesResult] = await Promise.all([
                readPublicProfileSummaries(supabase, userIds).catch(() => []),
                supabase
                    .from('restaurants')
                    .select(FEED_RESTAURANT_SELECT)
                    .in('id', restaurantIds),
                user
                    ? supabase
                        .from('review_likes')
                        .select('review_id')
                        .in('review_id', reviewIds)
                        .eq('user_id', user.id)
                    : Promise.resolve({ data: [] }),
            ]);

            const profilesMap = new Map(profilesData.map((profileRow) =>
                [profileRow.user_id, { nickname: profileRow.nickname, avatarUrl: profileRow.avatar_url }]
            ));

            const restaurantsData = (restaurantsResult.data ?? []) as FeedRestaurantRecord[];
            const restaurantsMap = new Map<string, FeedRestaurantRecord>((restaurantsData || []).map((restaurantRow) => {
                return [restaurantRow.id, normalizeFeedRestaurantRecord(restaurantRow)];
            }));

            const reviewedRestaurantNames = [
                ...new Set(
                    [...restaurantsMap.values()]
                        .map((restaurant) => String(restaurant.approved_name || restaurant.name || '').trim())
                        .filter(Boolean)
                ),
            ];
            const { data: approvedRestaurantRowsRaw } = reviewedRestaurantNames.length > 0
                ? await supabase
                    .from('restaurants')
                    .select(FEED_RESTAURANT_SELECT)
                    .eq('status', 'approved')
                    .in('approved_name', reviewedRestaurantNames)
                : { data: [] };
            const approvedRestaurants = ((approvedRestaurantRowsRaw ?? []) as FeedRestaurantRecord[])
                .map(normalizeFeedRestaurantRecord);

            const resolveFeedRestaurant = (reviewRow: FeedReviewRow) => {
                const reviewedRestaurant = restaurantsMap.get(reviewRow.restaurant_id) ?? null;
                if (reviewedRestaurant?.status === 'approved') return reviewedRestaurant;

                return findCanonicalVisitedRestaurant({
                    reviewedRestaurant: reviewedRestaurant as never,
                    reviewedRestaurantId: reviewRow.restaurant_id,
                    approvedRestaurants: approvedRestaurants as never,
                }) as FeedRestaurantRecord | null ?? reviewedRestaurant;
            };

            let userLikesMap = new Map<string, boolean>();

            if (user) {
                const userLikesDataRaw = userLikesResult.data;
                const userLikesData = (userLikesDataRaw ?? []) as FeedReviewLikeRow[];

                userLikesMap = new Map(
                    userLikesData.map((likeRow) => [likeRow.review_id, true])
                );
            }

            const reviews: FeedReview[] = typedReviewsData.map((reviewRow) => {
                const profileInfo = (profilesMap.get(reviewRow.user_id) || { nickname: '탈퇴한 사용자', avatarUrl: undefined }) as { nickname: string; avatarUrl?: string };
                const restaurant = resolveFeedRestaurant(reviewRow);
                return {
                    id: reviewRow.id,
                    userId: reviewRow.user_id,
                    restaurantId: restaurant?.id ?? reviewRow.restaurant_id,
                    restaurantName: getFeedRestaurantDisplayName(restaurant),
                    restaurant,
                    userName: profileInfo.nickname || '탈퇴한 사용자',
                    userAvatarUrl: profileInfo.avatarUrl,
                    visitedAt: reviewRow.visited_at,
                    createdAt: reviewRow.created_at,
                    content: reviewRow.content,
                    photos: reviewRow.food_photos || [],
                    categories: (Array.isArray(reviewRow.categories) && reviewRow.categories.length > 0)
                        ? reviewRow.categories
                        : [],
                    likeCount: reviewRow.like_count || 0,
                    isLikedByUser: userLikesMap.get(reviewRow.id) || false,
                };
            });

            const nextCursor = typedReviewsData.length === REVIEW_PAGE_SIZE ? pageParam + REVIEW_PAGE_SIZE : null;
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

    const isLoopRepeatMode = !hasNextPage && allReviews.length > 0;
    const effectiveLoopItemCount = useMemo(() => {
        if (!isLoopRepeatMode) {
            return allReviews.length;
        }

        return Math.max(loopItemCount, allReviews.length);
    }, [allReviews.length, isLoopRepeatMode, loopItemCount]);

    const renderedReviewItems = useMemo(() => {
        if (!isLoopRepeatMode || allReviews.length === 0) {
            return allReviews.map((review, index) => ({
                review,
                listIndex: index,
                loopIndex: 0,
            }));
        }

        return Array.from({ length: effectiveLoopItemCount }, (_, index) => ({
            review: allReviews[index % allReviews.length],
            listIndex: index,
            loopIndex: Math.floor(index / allReviews.length),
        }));
    }, [allReviews, effectiveLoopItemCount, isLoopRepeatMode]);

    useEffect(() => {
        setLoopItemCount(allReviews.length);
        loopAppendLockRef.current = false;
    }, [allReviews, hasNextPage]);

    // 무한 스크롤
    const loadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
            return;
        }

        if (!hasNextPage && allReviews.length > 0 && !loopAppendLockRef.current) {
            loopAppendLockRef.current = true;
            const repeatBatchSize = Math.max(6, Math.min(18, allReviews.length));

            setLoopItemCount((prev) => Math.max(prev, allReviews.length) + repeatBatchSize);

            setTimeout(() => {
                loopAppendLockRef.current = false;
            }, 180);
        }
    }, [allReviews.length, fetchNextPage, hasNextPage, isFetchingNextPage]);

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
    const toggleLike = useCallback(async (reviewId: string, currentIsLiked: boolean, currentCount: number) => {
        if (!user) {
            if (onOpenAuth) {
                onOpenAuth();
                return;
            }

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
                const { error } = await supabase
                    .from('review_likes')
                    .delete()
                    .eq('review_id', reviewId)
                    .eq('user_id', user.id);

                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('review_likes' as never)
                    .insert({ review_id: reviewId, user_id: user.id } as never);

                if (error) throw error;

                try {
                    const notificationResponse = await fetch('/api/notifications/review-like', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reviewId }),
                    });

                    if (!notificationResponse.ok) {
                        // 알림 실패는 이미 적용된 좋아요를 되돌리지 않는다.
                    }
                } catch {
                    // 네트워크 오류는 이미 적용된 좋아요를 되돌리지 않는다.
                }
            }
            queryClient.invalidateQueries({ queryKey: [queryKey] });
        } catch (error) {
            console.error('좋아요 토글 실패:');
            setOptimisticLikes(prev => ({
                ...prev,
                [reviewId]: { count: currentCount, isLiked: currentIsLiked }
            }));
            throw error;
        }
    }, [user, onOpenAuth, queryClient, queryKey]);

    // 맛집으로 이동
    const goToRestaurant = useCallback((restaurantId: string, restaurant?: FeedRestaurantRecord | null) => {
        // 리뷰 페이지/오버레이 안에서 맛집 상세를 열 수 있으면 현재 화면을 유지한다.
        if (onOpenRestaurantDetail && restaurant) {
            onOpenRestaurantDetail(restaurant);
            return;
        }

        if (isOverlay && onClose) {
            onClose();
        }
        router.push(`/?restaurant=${restaurantId}`);
    }, [router, isOverlay, onClose, onOpenRestaurantDetail]);

    return (
        <div
            ref={feedScrollRef}
            className={cn(
                "flex flex-col h-full",
                !isOverlay && "bg-muted/30 overflow-y-auto"
            )}
            data-testid="feed-content-container"
            onScroll={feedBottomNavAutoHide.onScroll}
            onTouchStart={feedBottomNavAutoHide.onTouchStart}
            onTouchMove={feedBottomNavAutoHide.onTouchMove}
        >
            <div className={cn(
                "w-full mx-auto bg-background flex flex-col relative",
                isOverlay ? "h-full" : "min-h-full md:border-x md:border-border md:shadow-sm max-w-2xl"
            )}>
                {/* 헤더 */}
                {showHeader && (
                    <div className="shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 basis-[min(11rem,100%)]">
                                <h1 className="flex min-w-0 flex-wrap items-center gap-1.5 text-[1.0625rem] font-bold leading-tight text-primary text-balance xs:text-xl sm:gap-2 sm:text-2xl">
                                    <MessageSquareText className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
                                    <span className="min-w-0 truncate">쯔동여지도 리뷰</span>
                                    <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">
                                        ({allReviews.length}개)
                                    </span>
                                </h1>
                                <p className="mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground xs:text-sm">
                                    {isLoggedIn
                                        ? "맛집 방문 후기를 공유해보세요!"
                                        : "로그인하여 리뷰를 작성해보세요!"
                                    }
                                </p>
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                                {isLoggedIn && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                                        onClick={() => setShowMyReviewsOnly(!showMyReviewsOnly)}
                                        title={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}
                                        aria-label={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}
                                    >
                                        {showMyReviewsOnly ? (
                                            <EyeOff className="h-5 w-5 text-primary" aria-hidden="true" />
                                        ) : (
                                            <Eye className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                                        )}
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                                    className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                                    title="검색 필터"
                                    aria-label={isFilterExpanded ? "검색 필터 접기" : "검색 필터 펼치기"}
                                >
                                    <Filter className="h-4 w-4" aria-hidden="true" />
                                </Button>
                                {isOverlay && onClose && (
                                    <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted" aria-label="리뷰 패널 닫기">
                                        <X className="h-5 w-5" aria-hidden="true" />
                                    </Button>
                                )}
                            </div>
                        </div>
                        {isFilterExpanded && (
                            <div className="mt-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                    <Input
                                        aria-label="리뷰 검색"
                                        name="feed-review-search"
                                        autoComplete="off"
                                        placeholder="맛집명, 작성자, 내용 검색…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="border-0 bg-muted/45 shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
                                        style={{ paddingLeft: '2.5rem' }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 피드 목록 */}
                {/* [FIX] 모바일 하단 네비게이션 높이 고려하여 패딩 증가 */}
                <div className={cn(
                    "flex-1 pb-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+2rem)] md:pb-8",
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
                            {renderedReviewItems.map(({ review, listIndex, loopIndex }) => {
                                const optimistic = optimisticLikes[review.id];
                                const likeCount = optimistic?.count ?? review.likeCount;
                                const isLiked = optimistic?.isLiked ?? review.isLikedByUser;
                                const cardIdPrefix = loopIndex === 0 ? reviewIdPrefix : `${reviewIdPrefix}-loop-${loopIndex}`;

                                return (
                                    <ReviewCard
                                        key={`${review.id}-${loopIndex}-${listIndex}`}
                                        idPrefix={cardIdPrefix}
                                        isHighlighted={loopIndex === 0 && highlightedReviewId === review.id}
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
                                        onLike={(reviewId, currentIsLiked, currentCount) => toggleLike(reviewId, currentIsLiked, currentCount)}
                                        onRestaurantClick={() => goToRestaurant(review.restaurantId, review.restaurant)}
                                        currentUserId={user?.id}
                                        onEditReview={setEditingReview}
                                        onUserClick={onOpenUserProfile}
                                    />
                                );
                            })}
                            <div ref={loadMoreRef} className={cn(
                                "flex items-center justify-center",
                                isFetchingNextPage ? "h-20" : "h-4"
                            )}>
                                {isFetchingNextPage && (
                                    <div className="flex items-center gap-2" role="status" aria-live="polite">
                                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
                                        <span className="text-sm text-muted-foreground">더 불러오는 중…</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 플로팅 리뷰 작성 버튼 */}
                {!hideFloatingButton && (() => {
                    const FloatingButton = (
                        <Button
                            onClick={handleWriteReview}
                            className={cn(
                                "h-14 w-14 rounded-full shadow-lg bg-gradient-primary hover:opacity-90",
                                isOverlay
                                    ? "absolute right-8 bottom-8 z-[100]"
                                    : "fixed right-4 bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)] z-[80] pointer-events-auto md:right-8 md:bottom-8"
                            )}
                            size="icon"
                            aria-label="리뷰 작성"
                        >
                            <Plus className="h-6 w-6" />
                        </Button>
                    );

                    return isOverlay
                        ? FloatingButton
                        : (typeof document !== 'undefined' && createPortal(FloatingButton, document.body));
                })()}

                {/* 리뷰 작성 모달 */}
                {!hideReviewModal && isReviewModalOpen && (
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
                {editingReview && (
                    <ReviewEditModal
                        isOpen={!!editingReview}
                        onClose={() => setEditingReview(null)}
                        review={editingReview}
                        onSuccess={() => {
                            queryClient.invalidateQueries({ queryKey: [queryKey] });
                            setEditingReview(null);
                        }}
                    />
                )}
            </div>
        </div>
    );
}
