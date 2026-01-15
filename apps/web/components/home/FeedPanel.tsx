'use client';

import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, MapPin, Calendar, User, MessageSquareText, Eye, EyeOff, Filter, Search, ChevronRight, ChevronLeft, Share2, Check, Edit, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useReviewLikesRealtime } from '@/hooks/use-review-likes-realtime';
import { ReviewEditModal } from '@/components/reviews/ReviewEditModal';
import { GlobalLoader } from '@/components/ui/global-loader';

interface FeedPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
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

// 리뷰 수정 데이터 타입
interface ReviewEditData {
    id: string;
    restaurantId: string;
    restaurantName: string;
    content: string;
    categories: string[];
    foodPhotos: string[];
    isVerified: boolean;
    adminNote: string | null;
}

// 사진 URL 생성 유틸리티 (캐싱용)
const getPhotoUrl = (photoPath: string): string => {
    return supabase.storage.from('review-photos').getPublicUrl(photoPath).data.publicUrl;
};

// 날짜 포맷 유틸리티 (컴포넌트 외부로 이동하여 재생성 방지)
const formatDateKR = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

export default function FeedPanel({
    isOpen,
    onClose,
    onToggleCollapse,
    isCollapsed,
}: FeedPanelProps) {
    const { user } = useAuth();
    const router = useRouter();
    const queryClient = useQueryClient();
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [optimisticLikes, setOptimisticLikes] = useState<Record<string, { count: number; isLiked: boolean }>>({});
    const [showMyReviewsOnly, setShowMyReviewsOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);
    const [editingReview, setEditingReview] = useState<ReviewEditData | null>(null);

    const isLoggedIn = !!user;

    useReviewLikesRealtime();

    // 리뷰 피드 데이터 조회 (무한 스크롤)
    const {
        data: feedPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['review-feed-panel', user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            // 리뷰 데이터 조회
            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select('*')
                .eq('is_verified', true)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19) as any;

            if (reviewsError || !reviewsData?.length) {
                return { reviews: [], nextCursor: null };
            }

            // 사용자 ID 목록 추출
            const userIds = [...new Set(reviewsData.map((r: any) => r.user_id))] as string[];
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname, avatar_url')
                .in('user_id', userIds) as any;
            // 프로필 맵: { nickname, avatarUrl }
            const profilesMap = new Map((profilesData || []).map((p: any) =>
                [p.user_id, { nickname: p.nickname, avatarUrl: p.avatar_url }]
            ));

            // 맛집 ID 목록 추출
            const restaurantIds = [...new Set(reviewsData.map((r: any) => r.restaurant_id))] as string[];
            const { data: restaurantsData } = await supabase
                .from('restaurants')
                .select('id, name')
                .in('id', restaurantIds) as any;
            const restaurantsMap = new Map((restaurantsData || []).map((r: any) => [r.id, r.name]));

            // 좋아요 데이터 조회
            const reviewIds = reviewsData.map((r: any) => r.id);
            const { data: likesData } = await supabase
                .from('review_likes')
                .select('review_id, user_id')
                .in('review_id', reviewIds) as any;

            // 좋아요 맵 생성
            const likesMap = new Map<string, { count: number; isLiked: boolean }>();
            reviewIds.forEach((reviewId: string) => {
                const likesForReview = likesData?.filter((like: any) => like.review_id === reviewId) || [];
                const isLiked = user ? likesForReview.some((like: any) => like.user_id === user.id) : false;
                likesMap.set(reviewId, { count: likesForReview.length, isLiked });
            });

            // 리뷰 데이터 매핑
            const reviews: FeedReview[] = reviewsData.map((review: any) => {
                const likesInfo = likesMap.get(review.id) || { count: 0, isLiked: false };
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
                    categories: Array.isArray(review.categories) && review.categories.length > 0
                        ? review.categories
                        : (review.category ? [review.category] : []),
                    likeCount: likesInfo.count,
                    isLikedByUser: likesInfo.isLiked,
                };
            });

            const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;
            return { reviews, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        staleTime: 1000 * 60 * 2, // 2분간 캐시 유지
        gcTime: 1000 * 60 * 5, // 5분간 가비지 컬렉션 방지
    });

    // 필터링된 리뷰 목록 (메모이제이션)
    const allReviews = useMemo(() => {
        let reviews = feedPages?.pages.flatMap(page => page.reviews) || [];

        // 내 리뷰만 필터
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

    // 무한 스크롤 로드
    const loadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    // IntersectionObserver로 무한 스크롤 감지
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMore();
                }
            },
            { threshold: 0.1 }
        );

        const currentRef = loadMoreRef.current;
        if (currentRef) {
            observer.observe(currentRef);
        }

        return () => {
            if (currentRef) {
                observer.unobserve(currentRef);
            }
        };
    }, [loadMore]);

    // 좋아요 토글 핸들러
    const toggleLike = useCallback(async (
        reviewId: string,
        currentIsLiked: boolean,
        currentCount: number,
        reviewUserId: string
    ) => {
        if (!user) {
            toast({
                title: '로그인 필요',
                description: '좋아요를 누르려면 로그인이 필요합니다.',
                variant: 'destructive',
            });
            return;
        }

        // 낙관적 업데이트
        setOptimisticLikes(prev => ({
            ...prev,
            [reviewId]: {
                count: currentIsLiked ? currentCount - 1 : currentCount + 1,
                isLiked: !currentIsLiked,
            }
        }));

        try {
            if (currentIsLiked) {
                // 좋아요 취소
                await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id);
            } else {
                // 좋아요 추가
                await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id } as any);

                // 알림 생성 (본인 리뷰가 아닌 경우)
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
                    } catch {
                        // 알림 실패 무시
                    }
                }
            }
            queryClient.invalidateQueries({ queryKey: ['review-feed-panel'] });
        } catch {
            // 실패 시 롤백
            setOptimisticLikes(prev => ({
                ...prev,
                [reviewId]: { count: currentCount, isLiked: currentIsLiked }
            }));
        }
    }, [user, queryClient]);

    // 맛집 이동 핸들러
    const goToRestaurant = useCallback((restaurantId: string) => {
        router.push(`/?restaurant=${restaurantId}`);
    }, [router]);

    // 리뷰 수정 핸들러
    const handleEditReview = useCallback((reviewData: ReviewEditData) => {
        setEditingReview(reviewData);
    }, []);

    // 리뷰 수정 모달 닫기
    const handleCloseEditModal = useCallback(() => {
        setEditingReview(null);
    }, []);

    // 리뷰 수정 성공 핸들러
    const handleEditSuccess = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['review-feed-panel'] });
        setEditingReview(null);
    }, [queryClient]);

    // 필터 토글 핸들러
    const toggleMyReviews = useCallback(() => {
        setShowMyReviewsOnly(prev => !prev);
    }, []);

    // 필터 확장 토글 핸들러
    const toggleFilterExpanded = useCallback(() => {
        setIsFilterExpanded(prev => !prev);
    }, []);

    // 검색어 변경 핸들러
    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    }, []);

    // 패널이 닫혀있으면 렌더링 안함
    if (!isOpen) return null;

    return (
        <div className="h-full w-full flex flex-col bg-background border-l border-border relative">
            {/* 플로팅 접기/펼치기 버튼 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={!isCollapsed ? "패널 접기" : "패널 펼치기"}
                    aria-label={!isCollapsed ? "패널 접기" : "패널 펼치기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

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
                                onClick={toggleMyReviews}
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
                            onClick={toggleFilterExpanded}
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

                {/* 검색 필터 */}
                {isFilterExpanded && (
                    <div className="mt-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="맛집명, 작성자, 내용 검색..."
                                value={searchQuery}
                                onChange={handleSearchChange}
                                className="pl-9"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 피드 목록 */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] pb-8">
                {isLoading ? (
                    // 글로벌 로더
                    <GlobalLoader
                        message="리뷰 불러오는 중..."
                        subMessage="잠시만 기다려주세요"
                    />
                ) : allReviews.length === 0 ? (
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
                                <FeedPanelCard
                                    key={review.id}
                                    review={review}
                                    likeCount={likeCount}
                                    isLiked={isLiked}
                                    onToggleLike={() => toggleLike(review.id, isLiked, likeCount, review.userId)}
                                    onGoToRestaurant={() => goToRestaurant(review.restaurantId)}
                                    currentUserId={user?.id}
                                    onEditReview={handleEditReview}
                                />
                            );
                        })}

                        {/* 무한 스크롤 트리거 */}
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

            {/* 리뷰 수정 모달 */}
            <ReviewEditModal
                isOpen={!!editingReview}
                onClose={handleCloseEditModal}
                review={editingReview}
                onSuccess={handleEditSuccess}
            />
        </div>
    );
}

// 피드 카드 Props
interface FeedPanelCardProps {
    review: FeedReview;
    likeCount: number;
    isLiked: boolean;
    onToggleLike: () => void;
    onGoToRestaurant: () => void;
    currentUserId?: string;
    onEditReview?: (reviewData: ReviewEditData) => void;
}

// 피드 카드 컴포넌트 (메모이제이션)
const FeedPanelCard = memo(function FeedPanelCard({
    review,
    likeCount,
    isLiked,
    onToggleLike,
    onGoToRestaurant,
    currentUserId,
    onEditReview
}: FeedPanelCardProps) {
    const isOwnReview = currentUserId && review.userId === currentUserId;
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isShareCopied, setIsShareCopied] = useState(false);
    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchEnd, setTouchEnd] = useState<number | null>(null);

    const hasPhotos = review.photos.length > 0;
    const hasMultiplePhotos = review.photos.length > 1;
    const isLongContent = review.content.length > 50;
    const minSwipeDistance = 50;

    // 현재 사진 URL (메모이제이션)
    const currentPhotoUrl = useMemo(() => {
        if (!hasPhotos) return '';
        return getPhotoUrl(review.photos[currentPhotoIndex]);
    }, [hasPhotos, review.photos, currentPhotoIndex]);

    // 다음 사진 URL 프리로딩
    const nextPhotoUrl = useMemo(() => {
        if (!hasMultiplePhotos) return '';
        const nextIndex = (currentPhotoIndex + 1) % review.photos.length;
        return getPhotoUrl(review.photos[nextIndex]);
    }, [hasMultiplePhotos, currentPhotoIndex, review.photos]);

    // 다음 이미지 프리로드
    useEffect(() => {
        if (nextPhotoUrl) {
            const img = new Image();
            img.src = nextPhotoUrl;
        }
    }, [nextPhotoUrl]);

    // 공유 클릭 핸들러 (단축 URL 사용)
    const handleShareClick = useCallback(async () => {
        setIsShareCopied(true); // 로딩 표시

        const targetUrl = `/?restaurant=${review.restaurantId}`;

        try {
            // 단축 URL API 호출
            const response = await fetch('/api/shorten', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl,
                    restaurantId: review.restaurantId,
                    restaurantName: review.restaurantName,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                await navigator.clipboard.writeText(data.shortUrl);
            } else {
                // API 실패 시 기존 URL 사용
                const url = new URL(window.location.origin);
                url.searchParams.set('restaurant', review.restaurantId);
                await navigator.clipboard.writeText(url.toString());
            }

            setTimeout(() => setIsShareCopied(false), 2000);
        } catch {
            console.error('URL 복사 실패');
            setIsShareCopied(false);
        }
    }, [review.restaurantId, review.restaurantName]);

    // 다음 사진
    const nextPhoto = useCallback(() => {
        setCurrentPhotoIndex((prev) => (prev + 1) % review.photos.length);
    }, [review.photos.length]);

    // 이전 사진
    const prevPhoto = useCallback(() => {
        setCurrentPhotoIndex((prev) => (prev - 1 + review.photos.length) % review.photos.length);
    }, [review.photos.length]);

    // 터치 시작
    const onTouchStart = useCallback((e: React.TouchEvent) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    }, []);

    // 터치 이동
    const onTouchMove = useCallback((e: React.TouchEvent) => {
        setTouchEnd(e.targetTouches[0].clientX);
    }, []);

    // 터치 종료 (스와이프 감지)
    const onTouchEnd = useCallback(() => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        if (distance > minSwipeDistance) nextPhoto();
        if (distance < -minSwipeDistance) prevPhoto();
    }, [touchStart, touchEnd, nextPhoto, prevPhoto]);

    // 마우스 드래그 지원 (데스크톱)
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        setTouchEnd(null);
        setTouchStart(e.clientX);
    }, []);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (touchStart !== null) {
            setTouchEnd(e.clientX);
        }
    }, [touchStart]);

    const onMouseUp = useCallback(() => {
        if (!touchStart || !touchEnd) {
            setTouchStart(null);
            return;
        }
        const distance = touchStart - touchEnd;
        if (distance > minSwipeDistance) nextPhoto();
        if (distance < -minSwipeDistance) prevPhoto();
        setTouchStart(null);
        setTouchEnd(null);
    }, [touchStart, touchEnd, nextPhoto, prevPhoto]);

    const onMouseLeave = useCallback(() => {
        setTouchStart(null);
        setTouchEnd(null);
    }, []);

    // 수정 버튼 클릭 핸들러
    const handleEditClick = useCallback(() => {
        onEditReview?.({
            id: review.id,
            restaurantId: review.restaurantId,
            restaurantName: review.restaurantName,
            content: review.content,
            categories: review.categories || [],
            foodPhotos: review.photos,
            isVerified: true,
            adminNote: null,
        });
    }, [onEditReview, review]);

    // 내용 펼치기/접기
    const toggleExpanded = useCallback(() => {
        setIsExpanded(prev => !prev);
    }, []);

    // 이미지 로드 에러 핸들러
    const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.style.display = 'none';
    }, []);

    return (
        <Card className="overflow-hidden">
            {/* 헤더: 사용자 정보 + 버튼 영역 */}
            <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                        {review.userAvatarUrl ? (
                            <img
                                src={review.userAvatarUrl}
                                alt={review.userName}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <User className="w-4 h-4 text-primary" />
                        )}
                    </div>
                    <div>
                        <Link
                            href={`/user/${review.userId}`}
                            className="text-sm font-semibold hover:text-primary hover:underline transition-colors"
                        >
                            {review.userName}
                        </Link>
                        <Badge variant="default" className="h-4 px-1 text-[10px] bg-green-600 ml-1">
                            <CheckCircle className="h-2 w-2 mr-0.5" />
                            인증
                        </Badge>
                        <button
                            onClick={onGoToRestaurant}
                            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                            <MapPin className="w-3 h-3" />
                            {review.restaurantName}
                        </button>
                    </div>
                </div>

                {/* 버튼 영역 */}
                <div className="flex items-center gap-2">
                    {/* 공유 버튼 */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 ${isShareCopied ? 'text-green-600' : 'text-muted-foreground hover:text-primary'}`}
                        onClick={handleShareClick}
                        title={isShareCopied ? "복사됨!" : "리뷰 공유"}
                    >
                        {isShareCopied ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <Share2 className="h-4 w-4" />
                        )}
                    </Button>
                    {/* 수정 버튼 (본인 리뷰) */}
                    {isOwnReview && onEditReview && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={handleEditClick}
                            title="리뷰 수정"
                        >
                            <Edit className="h-4 w-4" />
                        </Button>
                    )}
                    {/* 좋아요 버튼 */}
                    <button
                        onClick={onToggleLike}
                        className="relative flex items-center justify-center group"
                        title={`좋아요 ${likeCount}개`}
                    >
                        <Heart
                            className={cn(
                                'w-6 h-6 transition-all',
                                isLiked
                                    ? 'fill-red-500 text-red-500 scale-110'
                                    : 'text-muted-foreground group-hover:text-red-400'
                            )}
                        />
                        {likeCount > 0 && (
                            <span className={cn(
                                'absolute inset-0 flex items-center justify-center text-[9px] font-bold pointer-events-none',
                                isLiked ? 'text-white' : 'text-muted-foreground'
                            )}>
                                {likeCount > 999 ? '999+' : likeCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* 사진 캐러셀 */}
            {hasPhotos && (
                <div
                    className="relative aspect-square bg-muted select-none cursor-grab active:cursor-grabbing group"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave}
                >
                    <img
                        src={currentPhotoUrl}
                        alt={`리뷰 사진 ${currentPhotoIndex + 1}`}
                        className="w-full h-full object-cover pointer-events-none"
                        draggable={false}
                        onError={handleImageError}
                    />

                    {/* 이전/다음 버튼 */}
                    {hasMultiplePhotos && currentPhotoIndex > 0 && (
                        <button
                            aria-label="돌아가기"
                            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/90 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
                            onClick={(e) => {
                                e.stopPropagation();
                                prevPhoto();
                            }}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                    )}
                    {hasMultiplePhotos && currentPhotoIndex < review.photos.length - 1 && (
                        <button
                            aria-label="다음"
                            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/90 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
                            onClick={(e) => {
                                e.stopPropagation();
                                nextPhoto();
                            }}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    )}

                    {/* 사진 인디케이터 */}
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

            {/* 리뷰 내용 */}
            <div className="p-3 space-y-2">
                <div>
                    {isExpanded ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {review.content}
                            {isLongContent && (
                                <button
                                    onClick={toggleExpanded}
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
                                    onClick={toggleExpanded}
                                    className="text-xs text-muted-foreground hover:text-primary shrink-0"
                                >
                                    더보기
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* 날짜 정보 */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        방문: {formatDateKR(review.visitedAt)}
                    </span>
                    <span>작성: {formatDateKR(review.createdAt)}</span>
                </div>
            </div>
        </Card>
    );
});
