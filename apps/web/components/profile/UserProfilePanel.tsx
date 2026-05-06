'use client';

import { useRouter } from "next/navigation";
import { useState, memo, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    ChevronLeft,
    Stamp,
    Heart,
    MessageSquare,
    Users,
    User,
    X
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    useUserProfile,
    useUserReviews,
    useUserLikers,
    useUserStamps,
    Liker
} from "@/hooks/useUserProfile";
import { useLeaderboard, LeaderboardUser } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { GlobalLoader } from "@/components/ui/global-loader";
import { StampCard } from "@/components/stamp/StampCard";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Restaurant } from "@/types/restaurant";

// [최적화] 빈 상태 컴포넌트 - memo로 래핑
interface EmptyStateProps {
    icon: React.ReactNode;
    message: string;
}

const EmptyState = memo(function EmptyState({ icon, message }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground">
            {icon}
            <p>{message}</p>
        </div>
    );
});

// [최적화] 좋아요 누른 사용자 아이템 - memo로 래핑
interface LikerItemProps {
    liker: Liker;
    onUserClick?: (userId: string) => void;
}

const LikerItem = memo(function LikerItem({ liker, onUserClick }: LikerItemProps) {
    const handleClick = (e: React.MouseEvent) => {
        if (onUserClick) {
            e.preventDefault();
            onUserClick(liker.userId);
        }
    };

    return (
        <Link
            href={`/user/${liker.userId}`}
            onClick={handleClick}
            className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors w-full text-left"
        >
            <div className="flex-1 min-w-0">
                <span className="font-semibold truncate block">
                    {liker.nickname}
                </span>
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Heart className="h-4 w-4 text-red-500" />
                <span className="font-semibold text-red-600">{liker.likedReviewCount}</span>
                <span>개 리뷰에 좋아요</span>
            </div>
        </Link>
    );
});

// [최적화] 통계 카드 컴포넌트 - memo로 래핑
interface StatCardProps {
    icon?: React.ReactNode;
    label: string;
    value: string | number;
    valueClassName?: string;
}

const StatCard = memo(function StatCard({ icon, label, value, valueClassName }: StatCardProps) {
    return (
        <div className="flex min-w-0 flex-col items-center justify-center rounded-lg bg-muted/50 px-1.5 py-3 text-center">
            <div className="flex max-w-full items-center gap-1 text-muted-foreground mb-1">
                {icon}
                <span className="truncate text-xs leading-none">{label}</span>
            </div>
            <span className={cn("max-w-full truncate text-base font-bold leading-none", valueClassName)}>{value}</span>
        </div>
    );
});

interface UserProfilePanelProps {
    userId: string;
    onClose?: () => void;
    showBackButton?: boolean;
    onUserClick?: (userId: string) => void;
    onRestaurantClick?: (restaurant: Restaurant) => void;
}

const USER_PROFILE_PAGE_SIZE = 15;
type UserProfileTab = 'stamps' | 'reviews' | 'likers';

const PROFILE_TABS = [
    {
        value: 'stamps',
        label: '도장',
        icon: Stamp,
    },
    {
        value: 'reviews',
        label: '리뷰',
        icon: MessageSquare,
    },
    {
        value: 'likers',
        label: '좋아요',
        icon: Users,
    },
] as const satisfies ReadonlyArray<{
    value: UserProfileTab;
    label: string;
    icon: typeof Stamp;
}>;

const getProfileTabId = (value: UserProfileTab) => `user-profile-tab-${value}`;
const getProfileTabPanelId = (value: UserProfileTab) => `user-profile-tabpanel-${value}`;

const UserProfilePanel = memo(function UserProfilePanel({ userId, onClose, showBackButton = true, onUserClick, onRestaurantClick }: UserProfilePanelProps) {
    const router = useRouter();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const { data: profile, isLoading: profileLoading } = useUserProfile(userId);
    const { data: stamps = [], isLoading: stampsLoading } = useUserStamps(userId);
    const { data: reviews = [], isLoading: reviewsLoading } = useUserReviews(userId, user?.id);
    const { data: likers = [], isLoading: likersLoading } = useUserLikers(userId);
    const { data: leaderboard = [] } = useLeaderboard();

    const [activeTab, setActiveTab] = useState<UserProfileTab>('stamps');
    const [thumbnailIndices, setThumbnailIndices] = useState<Record<string, number>>({});
    const [visibleStampCount, setVisibleStampCount] = useState(15);
    const [visibleReviewCount, setVisibleReviewCount] = useState(15);
    const [visibleLikerCount, setVisibleLikerCount] = useState(15);

    const stampTabRef = useRef<HTMLDivElement | null>(null);
    const reviewTabRef = useRef<HTMLDivElement | null>(null);
    const likerTabRef = useRef<HTMLDivElement | null>(null);

    const stampLoadMoreRef = useRef<HTMLDivElement | null>(null);
    const reviewLoadMoreRef = useRef<HTMLDivElement | null>(null);
    const likerLoadMoreRef = useRef<HTMLDivElement | null>(null);

    // [최적화] useMemo로 랭킹 계산 메모이제이션
    const userRank = useMemo(() => {
        return leaderboard.findIndex((u: LeaderboardUser) => u.id === userId) + 1;
    }, [leaderboard, userId]);

    // [최적화] useCallback으로 뒤로가기 핸들러 메모이제이션
    const handleBack = useCallback(() => {
        if (onClose) {
            onClose();
        } else {
            router.back();
        }
    }, [onClose, router]);

    // [최적화] 탭 변경 핸들러
    const handleTabChange = useCallback((value: UserProfileTab) => {
        setActiveTab(value);
    }, []);

    const tabCounts = useMemo<Record<UserProfileTab, number>>(() => ({
        stamps: stamps.length,
        reviews: reviews.length,
        likers: likers.length,
    }), [likers.length, reviews.length, stamps.length]);

    useEffect(() => {
        setVisibleStampCount(USER_PROFILE_PAGE_SIZE);
        setVisibleReviewCount(USER_PROFILE_PAGE_SIZE);
        setVisibleLikerCount(USER_PROFILE_PAGE_SIZE);
    }, [userId]);

    // [핸들러] 썸네일 변경
    const handleThumbnailChange = useCallback((id: string, index: number) => {
        setThumbnailIndices(prev => ({ ...prev, [id]: index }));
    }, []);

    // [핸들러] 맛집 클릭 - 메인으로 이동
    const handleRestaurantClick = useCallback((restaurant: Restaurant) => {
        if (onRestaurantClick) {
            onRestaurantClick(restaurant);
            return;
        }
        if (onClose) onClose();
        router.push(`/?restaurant=${restaurant.id}`);
    }, [onClose, router, onRestaurantClick]);

    // [핸들러] 리뷰 좋아요 토글
    const handleLike = useCallback(async (reviewId: string) => {
        if (!user) {
            toast({
                title: '로그인 필요',
                description: '좋아요를 누르려면 로그인이 필요합니다.',
                variant: 'destructive',
            });
            return;
        }

        // 현재 리뷰 찾기
        const targetReview = reviews.find(r => r.id === reviewId);
        if (!targetReview) return;

        const currentIsLiked = targetReview.isLikedByUser;

        try {
            if (currentIsLiked) {
                await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id);
            } else {
                await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id } as never);
            }
            // 쿼리 무효화로 UI 업데이트
            queryClient.invalidateQueries({ queryKey: ['user-reviews', userId] });
        } catch (error) {
            console.error('좋아요 토글 실패:', error);
            toast({
                title: '오류 발생',
                description: '좋아요 처리 중 문제가 발생했습니다.',
                variant: 'destructive',
            });
        }
    }, [user, reviews, queryClient, userId]);

    useEffect(() => {
        const root = stampTabRef.current;
        const sentinel = stampLoadMoreRef.current;
        if (!root || !sentinel || activeTab !== 'stamps' || stamps.length <= visibleStampCount) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;
                setVisibleStampCount((prev) => Math.min(prev + USER_PROFILE_PAGE_SIZE, stamps.length));
            },
            {
                root,
                rootMargin: '200px',
                threshold: 0.1
            }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [activeTab, stamps.length, visibleStampCount]);

    useEffect(() => {
        const root = reviewTabRef.current;
        const sentinel = reviewLoadMoreRef.current;
        if (!root || !sentinel || activeTab !== 'reviews' || reviews.length <= visibleReviewCount) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;
                setVisibleReviewCount((prev) => Math.min(prev + USER_PROFILE_PAGE_SIZE, reviews.length));
            },
            {
                root,
                rootMargin: '200px',
                threshold: 0.1
            }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [activeTab, reviews.length, visibleReviewCount]);

    useEffect(() => {
        const root = likerTabRef.current;
        const sentinel = likerLoadMoreRef.current;
        if (!root || !sentinel || activeTab !== 'likers' || likers.length <= visibleLikerCount) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;
                setVisibleLikerCount((prev) => Math.min(prev + USER_PROFILE_PAGE_SIZE, likers.length));
            },
            {
                root,
                rootMargin: '200px',
                threshold: 0.1
            }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [activeTab, likers.length, visibleLikerCount]);


    if (profileLoading) {
        return (
            <div className="h-full flex flex-col">
                <div className="p-4 border-b flex items-center">
                    {showBackButton && (
                        <Button variant="ghost" size="sm" onClick={handleBack} className="mr-2">
                            {onClose ? <X className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4 mr-1" />}
                            {onClose ? "닫기" : "뒤로"}
                        </Button>
                    )}
                </div>
                <div className="flex-1">
                    <GlobalLoader
                        message="프로필 불러오는 중..."
                        subMessage="사용자 정보를 확인하고 있습니다"
                    />
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="flex flex-col h-full bg-background">
                <div className="p-4 border-b">
                    {showBackButton && (
                        <Button variant="ghost" size="sm" onClick={handleBack}>
                            {onClose ? <X className="h-4 w-4 mr-1" /> : <ChevronLeft className="h-4 w-4 mr-1" />}
                            {onClose ? "닫기" : "뒤로"}
                        </Button>
                    )}
                </div>
                <div className="flex items-center justify-center h-64">
                    <div className="text-center text-muted-foreground">
                        <p className="text-lg mb-2">사용자를 찾을 수 없습니다</p>
                        <p className="text-sm">존재하지 않거나 탈퇴한 사용자입니다</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-background p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between min-w-0">
                    <div className="flex items-center gap-3">
                        {showBackButton && !onClose && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleBack}
                                className="flex-shrink-0 -ml-2"
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </Button>
                        )}
                        {/* 프로필 아바타 */}
                        <Avatar className="h-12 w-12 ring-2 ring-muted flex-shrink-0">
                            <AvatarImage src={profile.avatarUrl} alt={profile.nickname} className="object-cover" />
                            <AvatarFallback className="bg-primary/10">
                                <User className="h-6 w-6 text-primary" />
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold truncate">
                                    {profile.nickname}
                                </h1>
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "text-[10px] px-1.5 h-5 whitespace-nowrap flex-shrink-0",
                                        profile.tier.bgColor,
                                        profile.tier.color,
                                        "border-current"
                                    )}
                                >
                                    {profile.tier.name}
                                </Badge>
                            </div>
                        </div>
                    </div>
                    {/* ... stats ... */}
                    {showBackButton && onClose && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleBack}
                            className="flex-shrink-0 -mr-2 h-10 w-10"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>

                {/* 통계 카드 */}
                <div className="grid w-full grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
                    <StatCard
                        key="stat-stamps"
                        icon={<Stamp className="h-3 w-3" />}
                        label="도장"
                        value={profile.verifiedReviewCount}
                        valueClassName="text-foreground text-base"
                    />
                    <StatCard
                        key="stat-likes"
                        icon={<Heart className="h-3 w-3 text-red-500" />}
                        label="좋아요"
                        value={profile.totalLikes}
                        valueClassName="text-red-600 text-base"
                    />
                    <StatCard
                        key="stat-rank"
                        label="🏆 랭킹"
                        value={userRank > 0 ? `#${userRank}` : '-'}
                        valueClassName="text-primary text-base"
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div
                    role="tablist"
                    aria-label="사용자 프로필 콘텐츠"
                    className="grid w-full grid-cols-[repeat(3,minmax(0,1fr))] border-b bg-transparent"
                >
                    {PROFILE_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.value;

                        return (
                            <button
                                key={tab.value}
                                id={getProfileTabId(tab.value)}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                aria-controls={getProfileTabPanelId(tab.value)}
                                onClick={() => handleTabChange(tab.value)}
                                className={cn(
                                    "flex min-w-0 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm",
                                    isActive
                                        ? "border-primary text-foreground"
                                        : "border-transparent text-stone-700 hover:text-foreground"
                                )}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 truncate">{tab.label}</span>
                                <span className="shrink-0">({tabCounts[tab.value]})</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-hidden bg-muted/10">
                    {/* 도장 탭 */}
                    {activeTab === 'stamps' && (
                    <div
                        id={getProfileTabPanelId('stamps')}
                        role="tabpanel"
                        aria-labelledby={getProfileTabId('stamps')}
                        className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden"
                    >
                        <div ref={stampTabRef} className="h-full overflow-y-auto">
                        {stampsLoading ? (
                            <GlobalLoader message="도장 불러오는 중..." />
                        ) : stamps.length === 0 ? (
                            <EmptyState
                                icon={<Stamp className="h-8 w-8 mb-2 opacity-50" />}
                                message="아직 도장이 없습니다"
                            />
                        ) : (
                            <div className="p-4 flex flex-col gap-3 pb-20">
                                {stamps.slice(0, visibleStampCount).map((stamp, index) => (
                                    <StampCard
                                        key={`stamp-${stamp.restaurant.id}-${index}`}
                                        restaurant={stamp.restaurant}
                                        isVisited={true}
                                        isUserStampsReady={true}
                                        currentThumbnailIndex={thumbnailIndices[stamp.restaurant.id] || 0}
                                        onThumbnailChange={handleThumbnailChange}
                                        onClick={handleRestaurantClick}
                                        size="default"
                                        stampSize="compact"
                                    />
                                ))}
                                <div ref={stampLoadMoreRef} />
                            </div>
                        )}
                        </div>
                    </div>
                    )}

                    {/* 리뷰 탭 */}
                    {activeTab === 'reviews' && (
                    <div
                        id={getProfileTabPanelId('reviews')}
                        role="tabpanel"
                        aria-labelledby={getProfileTabId('reviews')}
                        className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden"
                    >
                        <div ref={reviewTabRef} className="h-full overflow-y-auto">
                        {reviewsLoading ? (
                            <GlobalLoader message="리뷰 불러오는 중..." />
                        ) : reviews.length === 0 ? (
                            <EmptyState
                                icon={<MessageSquare className="h-8 w-8 mb-2 opacity-50" />}
                                message="작성한 리뷰가 없습니다"
                            />
                        ) : (
                            <div className="p-4 space-y-4 pb-20">
                                {reviews.slice(0, visibleReviewCount).map((review, index) => (
                                    <ReviewCard
                                        key={`review-${review.id}-${index}`}
                                        review={{
                                            id: review.id,
                                            userId: profile.userId,
                                            userName: profile.nickname,
                                            userAvatarUrl: profile.avatarUrl,
                                            restaurantId: review.restaurantId,
                                            restaurantName: review.restaurantName,
                                            content: review.content,
                                            photos: review.photos,
                                            visitedAt: review.visitedDate || review.createdAt,
                                            submittedAt: review.createdAt,
                                            likeCount: review.likeCount,
                                            isLikedByUser: review.isLikedByUser,
                                            isVerified: review.isVerified,
                                        }}
                                        onLike={handleLike}
                                        currentUserId={user?.id}
                                        onUserClick={onUserClick}
                                        onRestaurantClick={() => {
                                            if (review.restaurant) {
                                                handleRestaurantClick(review.restaurant);
                                                return;
                                            }
                                            if (onClose) onClose();
                                            router.push(`/?restaurant=${review.restaurantId}`);
                                        }}
                                    />
                                ))}
                                <div ref={reviewLoadMoreRef} />
                            </div>
                        )}
                        </div>
                    </div>
                    )}

                    {/* 좋아요 탭 */}
                    {activeTab === 'likers' && (
                    <div
                        id={getProfileTabPanelId('likers')}
                        role="tabpanel"
                        aria-labelledby={getProfileTabId('likers')}
                        className="h-full"
                    >
                        <div ref={likerTabRef} className="h-full overflow-y-auto">
                        {likersLoading ? (
                            <GlobalLoader message="좋아요 불러오는 중..." />
                        ) : likers.length === 0 ? (
                            <EmptyState
                                icon={<Heart className="h-8 w-8 mb-2 opacity-50" />}
                                message="아직 좋아요를 받지 않았습니다"
                            />
                        ) : (
                                <div className="divide-y divide-border">
                                    {likers.slice(0, visibleLikerCount).map((liker, index) => (
                                        <LikerItem
                                            key={`liker-${liker.userId || 'unknown'}-${index}`}
                                            liker={liker}
                                            onUserClick={onUserClick}
                                        />
                                    ))}
                                    <div ref={likerLoadMoreRef} />
                                </div>
                        )}
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export { UserProfilePanel };
