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
    Users,
    User,
    X,
    MapPin,
    Calendar,
    CheckCircle2
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    useUserProfile,
    useUserReviews,
    useUserLikers,
    useUserStamps,
    Liker,
    UserReview,
    UserStamp
} from "@/hooks/useUserProfile";
import { useLeaderboard, LeaderboardUser } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { GlobalLoader } from "@/components/ui/global-loader";
import type { Restaurant } from "@/types/restaurant";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { getRestaurantDisplayName } from "@/lib/restaurant-display-name";

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

// [복구] 사용자 프로필 패널은 예전처럼 가벼운 행 리스트 UI를 사용한다.
interface StampItemProps {
    stamp: UserStamp;
    formatDate: (date: string) => string;
    onRestaurantClick?: (restaurant: Restaurant) => void;
}

const StampItem = memo(function StampItem({ stamp, formatDate, onRestaurantClick }: StampItemProps) {
    const restaurantName = getRestaurantDisplayName(stamp.restaurant);

    return (
        <button
            type="button"
            onClick={() => onRestaurantClick?.(stamp.restaurant)}
            className="w-full p-4 hover:bg-muted/30 transition-colors text-left"
        >
            <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{restaurantName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {stamp.visitedDate && (
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                방문: {stamp.visitedDate}
                            </span>
                        )}
                        <span>{formatDate(stamp.createdAt)}</span>
                    </div>
                </div>
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            </div>
        </button>
    );
});

interface ReviewItemProps {
    review: UserReview;
    formatDate: (date: string) => string;
    onRestaurantClick?: (restaurant: Restaurant) => void;
}

const ReviewItem = memo(function ReviewItem({ review, formatDate, onRestaurantClick }: ReviewItemProps) {
    const handleClick = () => {
        if (review.restaurant) {
            onRestaurantClick?.(review.restaurant);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className="w-full p-4 hover:bg-muted/30 transition-colors text-left"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">{review.restaurantName}</span>
                        {review.isVerified && (
                            <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                        )}
                    </div>
                    {review.content && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            {review.content}
                        </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {review.visitedDate && (
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                방문: {review.visitedDate}
                            </span>
                        )}
                        <span>{formatDate(review.createdAt)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-1 text-sm text-red-600">
                    <Heart className="h-4 w-4" />
                    <span>{review.likeCount}</span>
                </div>
            </div>
        </button>
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
    onRestaurantClick?: (restaurant: Restaurant) => void;
}

const UserProfilePanel = memo(function UserProfilePanel({ userId, onClose, showBackButton = true, onUserClick, onRestaurantClick }: UserProfilePanelProps) {
    const router = useRouter();

    const { data: profile, isLoading: profileLoading } = useUserProfile(userId);
    const { data: stamps = [], isLoading: stampsLoading } = useUserStamps(userId);
    const { data: reviews = [], isLoading: reviewsLoading } = useUserReviews(userId);
    const { data: likers = [], isLoading: likersLoading } = useUserLikers(userId);
    const { data: leaderboard = [] } = useLeaderboard();

    const [activeTab, setActiveTab] = useState<'stamps' | 'reviews' | 'likers'>('stamps');

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

    // [핸들러] 맛집 클릭 - 메인으로 이동
    const handleRestaurantClick = useCallback((restaurant: Restaurant) => {
        if (onRestaurantClick) {
            onRestaurantClick(restaurant);
            return;
        }
        if (onClose) onClose();
        router.push(`/?restaurant=${restaurant.id}`);
    }, [onClose, router, onRestaurantClick]);


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
                        {showBackButton && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleBack}
                                className="flex-shrink-0 -ml-2"
                            >
                                {onClose ? <X className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
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

                <div className="flex-1 overflow-hidden">
                    {/* 도장 탭 */}
                    <TabsContent value="stamps" className="h-full m-0 data-[state=inactive]:hidden" forceMount>
                        <ScrollArea className="h-full">
                            {stampsLoading ? (
                                <GlobalLoader message="도장 불러오는 중..." />
                            ) : stamps.length === 0 ? (
                                <EmptyState
                                    icon={<Stamp className="h-8 w-8 mb-2 opacity-50" />}
                                    message="아직 도장이 없습니다"
                                />
                            ) : (
                                <div className="divide-y divide-border">
                                    {stamps.map((stamp, index) => (
                                        <StampItem
                                            key={`stamp-${stamp.restaurant.id}-${index}`}
                                            stamp={stamp}
                                            formatDate={formatDate}
                                            onRestaurantClick={handleRestaurantClick}
                                        />
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    {/* 리뷰 탭 */}
                    <TabsContent value="reviews" className="h-full m-0 data-[state=inactive]:hidden" forceMount>
                        <ScrollArea className="h-full">
                            {reviewsLoading ? (
                                <GlobalLoader message="리뷰 불러오는 중..." />
                            ) : reviews.length === 0 ? (
                                <EmptyState
                                    icon={<MessageSquare className="h-8 w-8 mb-2 opacity-50" />}
                                    message="작성한 리뷰가 없습니다"
                                />
                            ) : (
                                <div className="divide-y divide-border">
                                    {reviews.map((review, index) => (
                                        <ReviewItem
                                            key={`review-${review.id}-${index}`}
                                            review={review}
                                            formatDate={formatDate}
                                            onRestaurantClick={handleRestaurantClick}
                                        />
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    {/* 좋아요 탭 */}
                    <TabsContent value="likers" className="h-full m-0 data-[state=inactive]:hidden" forceMount>
                        <ScrollArea className="h-full">
                            {likersLoading ? (
                                <GlobalLoader message="좋아요 불러오는 중..." />
                            ) : likers.length === 0 ? (
                                <EmptyState
                                    icon={<Heart className="h-8 w-8 mb-2 opacity-50" />}
                                    message="아직 좋아요를 받지 않았습니다"
                                />
                            ) : (
                                <div className="divide-y divide-border">
                                    {likers.map((liker, index) => (
                                        <LikerItem
                                            key={`liker-${liker.userId || 'unknown'}-${index}`}
                                            liker={liker}
                                            onUserClick={onUserClick}
                                        />
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
});

export { UserProfilePanel };
