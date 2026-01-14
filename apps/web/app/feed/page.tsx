'use client';

import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Heart, MapPin, Calendar, User, MessageSquareText, Plus, Eye, EyeOff, Filter, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { GlobalLoader } from "@/components/ui/global-loader";
import { useReviewLikesRealtime } from '@/hooks/use-review-likes-realtime';
import { ReviewModal } from '@/components/reviews/ReviewModal';

interface FeedReview {
    id: string;
    userId: string;
    restaurantId: string;
    restaurantName: string;
    userName: string;
    visitedAt: string;
    createdAt: string;
    content: string;
    photos: string[];
    likeCount: number;
    isLikedByUser: boolean;
}

export default function FeedPage() {
    const { user } = useAuth();
    const router = useRouter();
    const queryClient = useQueryClient();
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [optimisticLikes, setOptimisticLikes] = useState<Record<string, { count: number; isLiked: boolean }>>({});
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [showMyReviewsOnly, setShowMyReviewsOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);

    const isLoggedIn = !!user;

    // [REALTIME] 좋아요 실시간 반영
    useReviewLikesRealtime();

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
        setIsReviewModalOpen(true);
    }, [user]);


    // 리뷰 피드 데이터 조회 (무한 스크롤)
    const {
        data: feedPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['review-feed', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            // 1. 승인된 리뷰 조회
            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select('*')
                .eq('is_verified', true)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19) as any;

            if (reviewsError) {
                console.error('리뷰 조회 실패:', reviewsError);
                return { reviews: [], nextCursor: null };
            }

            if (!reviewsData || reviewsData.length === 0) {
                return { reviews: [], nextCursor: null };
            }

            // 2. 사용자 정보 조회
            const userIds = [...new Set(reviewsData.map((r: any) => r.user_id))];
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', userIds) as any;
            const profilesMap = new Map((profilesData || []).map((p: any) => [p.user_id, p.nickname]));

            // 3. 맛집 정보 조회
            const restaurantIds = [...new Set(reviewsData.map((r: any) => r.restaurant_id))];
            const { data: restaurantsData } = await supabase
                .from('restaurants')
                .select('id, name')
                .in('id', restaurantIds) as any;
            const restaurantsMap = new Map((restaurantsData || []).map((r: any) => [r.id, r.name]));

            // 4. 좋아요 정보 조회
            const reviewIds = reviewsData.map((r: any) => r.id);
            const { data: likesData } = await supabase
                .from('review_likes')
                .select('review_id, user_id')
                .in('review_id', reviewIds) as any;

            const likesMap = new Map<string, { count: number; isLiked: boolean }>();
            reviewIds.forEach((reviewId: string) => {
                const likesForReview = likesData?.filter((like: any) => like.review_id === reviewId) || [];
                const isLiked = user ? likesForReview.some((like: any) => like.user_id === user.id) : false;
                likesMap.set(reviewId, { count: likesForReview.length, isLiked });
            });

            // 5. 리뷰 데이터 매핑
            const reviews: FeedReview[] = reviewsData.map((review: any) => {
                const likesInfo = likesMap.get(review.id) || { count: 0, isLiked: false };
                return {
                    id: review.id,
                    userId: review.user_id,
                    restaurantId: review.restaurant_id,
                    restaurantName: restaurantsMap.get(review.restaurant_id) || '알 수 없음',
                    userName: profilesMap.get(review.user_id) || '탈퇴한 사용자',
                    visitedAt: review.visited_at,
                    createdAt: review.created_at,
                    content: review.content,
                    photos: review.food_photos || [],
                    likeCount: likesInfo.count,
                    isLikedByUser: likesInfo.isLiked,
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
        // 내 리뷰만 보기 필터
        if (showMyReviewsOnly && user?.id) {
            reviews = reviews.filter(review => review.userId === user.id);
        }
        // 검색어 필터
        if (searchQuery.trim()) {
            const query = searchQuery.trim().toLowerCase();
            reviews = reviews.filter(review =>
                review.restaurantName.toLowerCase().includes(query) ||
                review.userName.toLowerCase().includes(query) ||
                review.content.toLowerCase().includes(query)
            );
        }
        return reviews;
    }, [feedPages, showMyReviewsOnly, user?.id, searchQuery]);

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

        // Optimistic update
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

                // 리뷰 작성자에게 알림 (자기 자신 제외)
                if (reviewUserId && reviewUserId !== user.id) {
                    try {
                        const { data: profileData } = await (supabase
                            .from('profiles') as any)
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
            queryClient.invalidateQueries({ queryKey: ['review-feed'] });
        } catch (error) {
            console.error('좋아요 토글 실패:', error);
            // Rollback optimistic update
            setOptimisticLikes(prev => ({
                ...prev,
                [reviewId]: { count: currentCount, isLiked: currentIsLiked }
            }));
        }
    }, [user, queryClient]);

    // 맛집으로 이동
    const goToRestaurant = useCallback((restaurantId: string) => {
        router.push(`/?restaurant=${restaurantId}`);
    }, [router]);

    // 날짜 포맷
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    };

    if (isLoading) {
        return (
            <GlobalLoader
                message="리뷰 데이터를 불러오는 중..."
                subMessage="팬들의 맛집 방문 후기를 확인하고 있습니다"
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-y-auto" data-testid="feed-page-container">
            {/* Header */}
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
                        {/* 내 리뷰만 보기 토글 */}
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
                        {/* 필터 토글 버튼 */}
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                            className="relative"
                            title={isFilterExpanded ? "필터 접기" : "필터 펼치기"}
                        >
                            <Filter className="h-4 w-4" />
                            {searchQuery && (
                                <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary text-primary-foreground text-[10px] font-medium rounded-full flex items-center justify-center">
                                    1
                                </span>
                            )}
                        </Button>
                    </div>
                </div>

                {/* 검색 필터 영역 */}
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

            {/* Feed */}
            <div className="pb-8">
                {allReviews.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                        <p>아직 승인된 리뷰가 없습니다.</p>
                    </div>
                ) : (
                    <div className="space-y-4 p-4 pb-0">
                        {allReviews.map((review) => {
                            const optimistic = optimisticLikes[review.id];
                            const likeCount = optimistic?.count ?? review.likeCount;
                            const isLiked = optimistic?.isLiked ?? review.isLikedByUser;

                            return (
                                <FeedCard
                                    key={review.id}
                                    review={review}
                                    likeCount={likeCount}
                                    isLiked={isLiked}
                                    onToggleLike={() => toggleLike(review.id, isLiked, likeCount, review.userId)}
                                    onGoToRestaurant={() => goToRestaurant(review.restaurantId)}
                                    formatDate={formatDate}
                                />
                            );
                        })}

                        {/* 무한 스크롤 트리거 - 로딩 중이 아닐 때는 높이 최소화 */}
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

            {/* Floating Write Button - Portal로 body에 직접 렌더링 */}
            {isLoggedIn && typeof document !== 'undefined' && createPortal(
                <Button
                    onClick={handleWriteReview}
                    className="fixed right-4 bottom-20 z-50 h-14 w-14 rounded-full shadow-lg bg-gradient-primary hover:opacity-90"
                    size="icon"
                >
                    <Plus className="h-6 w-6" />
                </Button>,
                document.body
            )}

            {/* Review Modal */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={null}
                onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['review-feed'] });
                    queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
                }}
            />
        </div>
    );
}

// 리뷰 카드 컴포넌트 (memo로 불필요한 리렌더링 방지)
interface FeedCardProps {
    review: FeedReview;
    likeCount: number;
    isLiked: boolean;
    onToggleLike: () => void;
    onGoToRestaurant: () => void;
    formatDate: (date: string) => string;
}

const FeedCard = memo(function FeedCard({ review, likeCount, isLiked, onToggleLike, onGoToRestaurant, formatDate }: FeedCardProps) {
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchEnd, setTouchEnd] = useState<number | null>(null);
    const hasPhotos = review.photos.length > 0;
    const hasMultiplePhotos = review.photos.length > 1;
    const isLongContent = review.content.length > 50;

    const minSwipeDistance = 50;

    const nextPhoto = () => {
        setCurrentPhotoIndex((prev) => (prev + 1) % review.photos.length);
    };

    const prevPhoto = () => {
        setCurrentPhotoIndex((prev) => (prev - 1 + review.photos.length) % review.photos.length);
    };

    const onTouchStart = (e: React.TouchEvent) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };

    const onTouchMove = (e: React.TouchEvent) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };

    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;
        if (isLeftSwipe) nextPhoto();
        if (isRightSwipe) prevPhoto();
    };

    // 마우스 드래그 지원 (데스크탑)
    const onMouseDown = (e: React.MouseEvent) => {
        setTouchEnd(null);
        setTouchStart(e.clientX);
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (touchStart !== null) {
            setTouchEnd(e.clientX);
        }
    };

    const onMouseUp = () => {
        if (!touchStart || !touchEnd) {
            setTouchStart(null);
            return;
        }
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;
        if (isLeftSwipe) nextPhoto();
        if (isRightSwipe) prevPhoto();
        setTouchStart(null);
        setTouchEnd(null);
    };

    const onMouseLeave = () => {
        setTouchStart(null);
        setTouchEnd(null);
    };

    return (
        <Card className="overflow-hidden">
            {/* 헤더: 사용자 정보 + 좋아요/맛집 버튼 */}
            <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold">{review.userName}</p>
                        <button
                            onClick={onGoToRestaurant}
                            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                            <MapPin className="w-3 h-3" />
                            {review.restaurantName}
                        </button>
                    </div>
                </div>

                {/* 맛집/좋아요 버튼 - 헤더 오른쪽 */}
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={onGoToRestaurant}
                        title="맛집 보기"
                    >
                        <MapPin className="h-4 w-4" />
                    </Button>
                    <button
                        onClick={onToggleLike}
                        className="flex items-center gap-1 group"
                    >
                        <Heart
                            className={cn(
                                'w-5 h-5 transition-all',
                                isLiked
                                    ? 'fill-red-500 text-red-500 scale-110'
                                    : 'text-muted-foreground group-hover:text-red-400'
                            )}
                        />
                        {likeCount > 0 && (
                            <span className={cn(
                                'text-xs font-medium',
                                isLiked ? 'text-red-500' : 'text-muted-foreground'
                            )}>
                                {likeCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* 사진 캐러셀 - 스와이프 지원 */}
            {hasPhotos && (
                <div
                    className="relative aspect-square bg-muted select-none cursor-grab active:cursor-grabbing"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave}
                >
                    <img
                        src={supabase.storage.from('review-photos').getPublicUrl(review.photos[currentPhotoIndex]).data.publicUrl}
                        alt={`리뷰 사진 ${currentPhotoIndex + 1}`}
                        className="w-full h-full object-cover pointer-events-none"
                        draggable={false}
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />

                    {/* 인디케이터 */}
                    {hasMultiplePhotos && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                            {review.photos.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={cn(
                                        'w-1.5 h-1.5 rounded-full transition-all',
                                        idx === currentPhotoIndex ? 'bg-white w-3' : 'bg-white/50'
                                    )}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 내용 */}
            <div className="p-3 space-y-2">
                <div>
                    {isExpanded ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {review.content}
                            {isLongContent && (
                                <button
                                    onClick={() => setIsExpanded(false)}
                                    className="text-xs text-muted-foreground hover:text-primary ml-1 inline-block"
                                >
                                    접기
                                </button>
                            )}
                        </p>
                    ) : (
                        <div className="flex items-baseline gap-1">
                            <p className="text-sm leading-relaxed truncate flex-1">
                                {review.content}
                            </p>
                            {isLongContent && (
                                <button
                                    onClick={() => setIsExpanded(true)}
                                    className="text-xs text-muted-foreground hover:text-primary shrink-0"
                                >
                                    더보기
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* 날짜 */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        방문: {formatDate(review.visitedAt)}
                    </span>
                    <span>작성: {formatDate(review.createdAt)}</span>
                </div>
            </div>
        </Card>
    );
});
