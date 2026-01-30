'use client';

import { useRouter } from "next/navigation";
import { useState, memo, useMemo, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    ChevronLeft,
    Stamp,
    Heart,
    MessageSquare,
    CheckCircle2,
    Calendar,
    Users,
    MapPin,
    User,
    X
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    useUserProfile,
    useUserReviews,
    useUserLikers,
    useUserStamps,
    UserReview,
    Liker
} from "@/hooks/useUserProfile";
import { useLeaderboard, LeaderboardUser } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { GlobalLoader } from "@/components/ui/global-loader";
import { StampCard } from "@/components/stamp/StampCard";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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
        <div className="flex flex-col items-center justify-center py-3 px-2 rounded-lg bg-muted/50">
            <div className="flex items-center gap-1 text-muted-foreground mb-1">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            <span className={cn("text-lg font-bold", valueClassName)}>{value}</span>
        </div>
    );
});

interface UserProfilePanelProps {
    userId: string;
    onClose?: () => void;
    showBackButton?: boolean;
    onUserClick?: (userId: string) => void;
    onRestaurantClick?: (restaurant: any) => void;
}

const UserProfilePanel = memo(function UserProfilePanel({ userId, onClose, showBackButton = true, onUserClick, onRestaurantClick }: UserProfilePanelProps) {
    const router = useRouter();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const { data: profile, isLoading: profileLoading } = useUserProfile(userId);
    const { data: stamps = [], isLoading: stampsLoading } = useUserStamps(userId);
    const { data: reviews = [], isLoading: reviewsLoading } = useUserReviews(userId, user?.id);
    const { data: likers = [], isLoading: likersLoading } = useUserLikers(userId);
    const { data: leaderboard = [] } = useLeaderboard();

    const [activeTab, setActiveTab] = useState<'stamps' | 'reviews' | 'likers'>('stamps');
    const [thumbnailIndices, setThumbnailIndices] = useState<Record<string, number>>({});

    // [최적화] useMemo로 랭킹 계산 메모이제이션
    const userRank = useMemo(() => {
        return leaderboard.findIndex((u: LeaderboardUser) => u.id === userId) + 1;
    }, [leaderboard, userId]);

    // [최적화] useCallback으로 날짜 포맷 함수 메모이제이션
    const formatDate = useCallback((dateStr: string) => {
        try {
            return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ko });
        } catch {
            return dateStr;
        }
    }, []);

    // [최적화] useCallback으로 뒤로가기 핸들러 메모이제이션
    const handleBack = useCallback(() => {
        if (onClose) {
            onClose();
        } else {
            router.back();
        }
    }, [onClose, router]);

    // [최적화] 탭 변경 핸들러
    const handleTabChange = useCallback((value: string) => {
        setActiveTab(value as 'stamps' | 'reviews' | 'likers');
    }, []);

    // [핸들러] 썸네일 변경
    const handleThumbnailChange = useCallback((id: string, index: number) => {
        setThumbnailIndices(prev => ({ ...prev, [id]: index }));
    }, []);

    // [핸들러] 맛집 클릭 - 메인으로 이동
    const handleRestaurantClick = useCallback((restaurant: any) => {
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
                await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id } as any);
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
                <div className="grid grid-cols-3 gap-2">
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
            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="w-full grid grid-cols-3 border-b rounded-none bg-transparent h-auto p-0">
                    <TabsTrigger
                        value="stamps"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none py-3 text-sm"
                    >
                        <Stamp className="h-3.5 w-3.5 mr-1" />
                        도장 ({stamps.length})
                    </TabsTrigger>
                    <TabsTrigger
                        value="reviews"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none py-3 text-sm"
                    >
                        <MessageSquare className="h-3.5 w-3.5 mr-1" />
                        리뷰 ({reviews.length})
                    </TabsTrigger>
                    <TabsTrigger
                        value="likers"
                        className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none py-3 text-sm"
                    >
                        <Users className="h-3.5 w-3.5 mr-1" />
                        좋아요 ({likers.length})
                    </TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-hidden bg-muted/10">
                    {/* 도장 탭 */}
                    <TabsContent value="stamps" className="h-full m-0 data-[state=inactive]:hidden overflow-y-auto [&::-webkit-scrollbar]:hidden" forceMount>
                        {stampsLoading ? (
                            <GlobalLoader message="도장 불러오는 중..." />
                        ) : stamps.length === 0 ? (
                            <EmptyState
                                icon={<Stamp className="h-8 w-8 mb-2 opacity-50" />}
                                message="아직 도장이 없습니다"
                            />
                        ) : (
                            <div className="p-4 flex flex-col gap-3 pb-20">
                                {stamps.map((stamp, index) => (
                                    <StampCard
                                        key={`stamp-${stamp.restaurant.id}-${index}`}
                                        restaurant={stamp.restaurant}
                                        isVisited={true}
                                        isUserStampsReady={true}
                                        currentThumbnailIndex={thumbnailIndices[stamp.restaurant.id] || 0}
                                        onThumbnailChange={handleThumbnailChange}
                                        onClick={handleRestaurantClick}
                                        size="default"
                                    />
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* 리뷰 탭 */}
                    <TabsContent value="reviews" className="h-full m-0 data-[state=inactive]:hidden overflow-y-auto [&::-webkit-scrollbar]:hidden" forceMount>
                        {reviewsLoading ? (
                            <GlobalLoader message="리뷰 불러오는 중..." />
                        ) : reviews.length === 0 ? (
                            <EmptyState
                                icon={<MessageSquare className="h-8 w-8 mb-2 opacity-50" />}
                                message="작성한 리뷰가 없습니다"
                            />
                        ) : (
                            <div className="p-4 space-y-4 pb-20">
                                {reviews.map((review, index) => (
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
                                        onRestaurantClick={() => handleRestaurantClick(review.restaurant || {
                                            id: review.restaurantId,
                                            name: review.restaurantName
                                        })}
                                    />
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* 좋아요 탭 */}
                    <TabsContent value="likers" className="h-full m-0 data-[state=inactive]:hidden" forceMount>
                        {likersLoading ? (
                            <GlobalLoader message="좋아요 불러오는 중..." />
                        ) : likers.length === 0 ? (
                            <EmptyState
                                icon={<Heart className="h-8 w-8 mb-2 opacity-50" />}
                                message="아직 좋아요를 받지 않았습니다"
                            />
                        ) : (
                            <ScrollArea className="h-full">
                                <div className="divide-y divide-border">
                                    {likers.map((liker, index) => (
                                        <LikerItem
                                            key={`liker-${liker.userId || 'unknown'}-${index}`}
                                            liker={liker}
                                            onUserClick={onUserClick}
                                        />
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
});

export { UserProfilePanel };
