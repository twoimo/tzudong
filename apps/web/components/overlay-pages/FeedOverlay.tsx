'use client';

import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import Link from 'next/link';
import { Heart, MapPin, Calendar, User, MessageSquareText, Plus, Eye, EyeOff, Filter, Search, Edit, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { GlobalLoader } from "@/components/ui/global-loader";
import { useReviewLikesRealtime } from '@/hooks/use-review-likes-realtime';
import { ReviewModal } from '@/components/reviews/ReviewModal';
import { ReviewEditModal } from '@/components/reviews/ReviewEditModal';
import { Carousel, CarouselContent, CarouselItem, CarouselOverlayPrevious, CarouselOverlayNext, type CarouselApi } from "@/components/ui/carousel";

interface FeedOverlayProps {
    onClose?: () => void;
    onOpenReviewModal?: () => void;
    hideReviewModal?: boolean;
    hideFloatingButton?: boolean;
}

interface FeedReview {
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
}

/**
 * 피드 오버레이
 * - 모바일/태블릿 피드 페이지와 동일한 헤더 스타일
 */
export default function FeedOverlay({ onClose, onOpenReviewModal, hideReviewModal, hideFloatingButton }: FeedOverlayProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [optimisticLikes, setOptimisticLikes] = useState<Record<string, { count: number; isLiked: boolean }>>({});
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [showMyReviewsOnly, setShowMyReviewsOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
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
    useReviewLikesRealtime();

    const handleWriteReview = useCallback(() => {
        if (!user) {
            toast({ title: '로그인이 필요합니다', description: '리뷰를 작성하려면 로그인이 필요합니다.', variant: 'destructive' });
            return;
        }
        // 외부 핸들러가 있으면 사용, 없으면 내부 상태 사용
        if (onOpenReviewModal) {
            onOpenReviewModal();
        } else {
            setIsReviewModalOpen(true);
        }
    }, [user, onOpenReviewModal]);

    const { data: feedPages, fetchNextPage, hasNextPage, isLoading, isFetchingNextPage } = useInfiniteQuery({
        queryKey: ['review-feed-overlay', user?.id],
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
                .select('id, name')
                .in('id', restaurantIds) as any;
            const restaurantsMap = new Map((restaurantsData || []).map((r: any) => [r.id, r.name]));

            const reviewIds = reviewsData.map((r: any) => r.id);
            let userLikesMap = new Map<string, boolean>();

            if (user) {
                const { data: userLikesData } = await supabase
                    .from('review_likes')
                    .select('review_id')
                    .in('review_id', reviewIds)
                    .eq('user_id', user.id) as any;
                userLikesMap = new Map((userLikesData || []).map((like: any) => [like.review_id, true]));
            }

            const reviews: FeedReview[] = reviewsData.map((review: any) => {
                const profileInfo = (profilesMap.get(review.user_id) || { nickname: '탈퇴한 사용자', avatarUrl: undefined }) as { nickname: string; avatarUrl?: string };
                return {
                    id: review.id,
                    userId: review.user_id,
                    restaurantId: review.restaurant_id,
                    restaurantName: restaurantsMap.get(review.restaurant_id) || '알 수 없음',
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

    const loadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) loadMore(); },
            { threshold: 0.1 }
        );
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [loadMore]);

    const toggleLike = useCallback(async (reviewId: string, currentIsLiked: boolean, currentCount: number) => {
        if (!user) {
            toast({ title: '로그인 필요', description: '좋아요를 누르려면 로그인이 필요합니다.', variant: 'destructive' });
            return;
        }

        setOptimisticLikes(prev => ({
            ...prev,
            [reviewId]: { count: currentIsLiked ? currentCount - 1 : currentCount + 1, isLiked: !currentIsLiked }
        }));

        try {
            if (currentIsLiked) {
                await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id);
            } else {
                await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id } as any);
            }
            queryClient.invalidateQueries({ queryKey: ['review-feed-overlay'] });
        } catch {
            setOptimisticLikes(prev => ({ ...prev, [reviewId]: { count: currentCount, isLiked: currentIsLiked } }));
        }
    }, [user, queryClient]);

    const goToRestaurant = useCallback((restaurantId: string) => {
        window.dispatchEvent(new CustomEvent('closeOverlayAndGoToRestaurant', { detail: restaurantId }));
    }, []);

    const formatDate = useCallback((dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    }, []);

    if (isLoading) return <GlobalLoader message="리뷰 데이터를 불러오는 중..." />;

    return (
        <div className="flex flex-col h-full bg-muted/30 overflow-hidden">
            <div className="w-full max-w-2xl mx-auto bg-background flex flex-col h-full">
                {/* 헤더 - 모바일/태블릿 페이지와 동일 스타일 */}
                <div className="border-b border-border bg-background p-6 shrink-0 rounded-t-2xl">
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
                                맛집 리뷰를 작성하고 공유해보세요!
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {isLoggedIn && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={() => setShowMyReviewsOnly(!showMyReviewsOnly)} title={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}>
                                    {showMyReviewsOnly ? <EyeOff className="h-5 w-5 text-primary" /> : <Eye className="h-5 w-5 text-muted-foreground" />}
                                </Button>
                            )}
                            <Button variant="outline" size="icon" onClick={() => setIsFilterExpanded(!isFilterExpanded)} title="검색 필터">
                                <Filter className="h-4 w-4" />
                            </Button>
                            {onClose && (
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
                                <Input placeholder="검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
                            </div>
                        </div>
                    )}
                </div>

                {/* 피드 목록 */}
                <div className="flex-1 overflow-y-auto pb-8">
                    {allReviews.length === 0 ? (
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
                                    <FeedCard
                                        key={review.id}
                                        review={review}
                                        likeCount={likeCount}
                                        isLiked={isLiked}
                                        onToggleLike={toggleLike}
                                        onGoToRestaurant={() => goToRestaurant(review.restaurantId)}
                                        formatDate={formatDate}
                                        currentUserId={user?.id}
                                        onEditReview={(reviewData) => setEditingReview(reviewData)}
                                    />
                                );
                            })}
                            <div ref={loadMoreRef} className={cn("flex items-center justify-center transition-all duration-300", isFetchingNextPage ? "h-20" : "h-4")}>
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

                {isLoggedIn && !hideFloatingButton && (
                    <Button onClick={handleWriteReview} className="fixed right-4 bottom-20 md:right-8 md:bottom-8 z-[100] h-14 w-14 rounded-full shadow-lg bg-gradient-primary hover:opacity-90" size="icon">
                        <Plus className="h-6 w-6" />
                    </Button>
                )}

                {!hideReviewModal && (
                    <ReviewModal isOpen={isReviewModalOpen} onClose={() => setIsReviewModalOpen(false)} restaurant={null} onSuccess={() => queryClient.invalidateQueries({ queryKey: ['review-feed-overlay'] })} />
                )}
                <ReviewEditModal isOpen={!!editingReview} onClose={() => setEditingReview(null)} review={editingReview} onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['review-feed-overlay'] }); setEditingReview(null); }} />
            </div>
        </div>
    );
}

// 피드 카드 컴포넌트
interface FeedCardProps {
    review: FeedReview;
    likeCount: number;
    isLiked: boolean;
    onToggleLike: (reviewId: string, currentIsLiked: boolean, currentCount: number) => void;
    onGoToRestaurant: () => void;
    formatDate: (date: string) => string;
    currentUserId?: string;
    onEditReview?: (reviewData: any) => void;
}

const FeedCard = memo(function FeedCard({ review, likeCount, isLiked, onToggleLike, onGoToRestaurant, formatDate, currentUserId, onEditReview }: FeedCardProps) {
    const isOwnReview = currentUserId && review.userId === currentUserId;
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [api, setApi] = useState<CarouselApi>();
    const hasPhotos = review.photos.length > 0;
    const hasMultiplePhotos = review.photos.length > 1;
    const isLongContent = review.content.length > 50;

    useEffect(() => {
        if (!api) return;
        api.on("select", () => setCurrentPhotoIndex(api.selectedScrollSnap()));
    }, [api]);

    return (
        <Card className="overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                        {review.userAvatarUrl ? (
                            <img src={review.userAvatarUrl} alt={review.userName} className="w-full h-full object-cover" />
                        ) : (
                            <User className="w-4 h-4 text-primary" />
                        )}
                    </div>
                    <div>
                        <Link href={`/user/${review.userId}`} className="text-sm font-semibold hover:text-primary">{review.userName}</Link>
                        <Badge variant="default" className="h-4 px-1 text-[10px] bg-green-600 ml-1"><CheckCircle className="h-2 w-2 mr-0.5" />인증</Badge>
                        <button onClick={onGoToRestaurant} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                            <MapPin className="w-3 h-3" />{review.restaurantName}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isOwnReview && onEditReview && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditReview({
                            id: review.id, restaurantId: review.restaurantId, restaurantName: review.restaurantName,
                            content: review.content, categories: review.categories || [], foodPhotos: review.photos, isVerified: true, adminNote: null,
                        })}><Edit className="h-4 w-4" /></Button>
                    )}
                    <button onClick={() => onToggleLike(review.id, isLiked, likeCount)} className="relative flex items-center justify-center">
                        <Heart className={cn('w-6 h-6', isLiked ? 'fill-red-500 text-red-500' : 'text-muted-foreground')} />
                        {likeCount > 0 && <span className={cn('absolute inset-0 flex items-center justify-center text-[9px] font-bold', isLiked ? 'text-white' : 'text-muted-foreground')}>{likeCount}</span>}
                    </button>
                </div>
            </div>

            {hasPhotos && (
                <div className="relative aspect-square bg-muted group">
                    <Carousel setApi={setApi} className="w-full h-full">
                        <CarouselContent>
                            {review.photos.map((photo, index) => (
                                <CarouselItem key={index}>
                                    <img src={supabase.storage.from('review-photos').getPublicUrl(photo).data.publicUrl} alt={`리뷰 사진 ${index + 1}`} className="w-full h-full object-cover" loading={index === 0 ? "eager" : "lazy"} />
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                        {hasMultiplePhotos && (<><CarouselOverlayPrevious /><CarouselOverlayNext /></>)}
                    </Carousel>
                    {hasMultiplePhotos && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                            {review.photos.map((_, idx) => (<div key={idx} className={cn('h-1.5 rounded-full', idx === currentPhotoIndex ? 'bg-white w-3' : 'bg-white/50 w-1.5')} />))}
                        </div>
                    )}
                </div>
            )}

            <div className="p-3 space-y-2">
                <div>
                    {isExpanded ? (
                        <p className="text-sm whitespace-pre-wrap">{review.content}{isLongContent && <button onClick={() => setIsExpanded(false)} className="text-xs text-muted-foreground ml-1">접기</button>}</p>
                    ) : (
                        <div className="flex items-baseline gap-1">
                            <p className="text-sm truncate flex-1">{review.content}</p>
                            {isLongContent && <button onClick={() => setIsExpanded(true)} className="text-xs text-muted-foreground">더보기</button>}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />방문: {formatDate(review.visitedAt)}</span>
                </div>
            </div>
        </Card>
    );
});
