import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Medal, Award, TrendingUp, Star, CheckCircle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LeaderboardUser {
    id: string;
    rank?: number; // 랭킹 데이터 생성 시 추가되는 속성
    username: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number; // 추가: 총 좋아요 수
    badges: { name: string; icon: string; earnedAt: string }[];
}


const LeaderboardPage = () => {
    const [sortBy, setSortBy] = useState<"reviews">("reviews");

    // Fetch leaderboard data from Supabase - 모든 사용자 포함
    const { data: allUsers, isLoading } = useQuery({
        queryKey: ['leaderboard-all-users'],
        queryFn: async () => {
            try {
                // Get all profiles (모든 사용자)
                const { data: profilesData, error: profilesError } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .not('nickname', 'is', null)
                    .neq('nickname', '탈퇴한 사용자');

                if (profilesError) {
                    console.warn('프로필 데이터 조회 실패:', profilesError.message);
                    throw new Error(`프로필 데이터 조회 실패: ${profilesError.message}`);
                }

                if (!profilesData || profilesData.length === 0) {
                    return [];
                }

                // Get all reviews for these users
                const userIds = profilesData.map(profile => profile.user_id);
                const { data: allReviewsData, error: allReviewsError } = await supabase
                    .from('reviews')
                    .select('id, user_id, is_verified')
                    .in('user_id', userIds);

                if (allReviewsError) {
                    console.warn('전체 리뷰 데이터 조회 실패:', allReviewsError.message);
                    // 리뷰 조회 실패해도 프로필은 표시 (리뷰 수 0으로)
                }

                // Get likes data for all reviews
                let reviewIds: string[] = [];
                if (allReviewsData) {
                    reviewIds = allReviewsData.map(review => review.id);
                }

                const { data: likesData, error: likesError } = await supabase
                    .from('review_likes')
                    .select('review_id')
                    .in('review_id', reviewIds);

                if (likesError) {
                    console.warn('좋아요 데이터 조회 실패:', likesError.message);
                }

                // 디버깅: 데이터 확인
                console.log('All reviews data sample:', allReviewsData?.slice(0, 3));
                console.log('Likes data sample:', likesData?.slice(0, 3));

                // Create review stats maps
                const reviewCountMap = new Map<string, number>();
                const verifiedReviewCountMap = new Map<string, number>();
                const totalLikesMap = new Map<string, number>();

                // Create likes count map for each review
                const reviewLikesMap = new Map<string, number>();
                if (likesData) {
                    likesData.forEach(like => {
                        const current = reviewLikesMap.get(like.review_id) || 0;
                        reviewLikesMap.set(like.review_id, current + 1);
                    });
                }

                if (allReviewsData && allReviewsData.length > 0) {
                    allReviewsData.forEach(review => {
                        // 총 리뷰 수 계산
                        const currentReviewCount = reviewCountMap.get(review.user_id) || 0;
                        reviewCountMap.set(review.user_id, currentReviewCount + 1);

                        // 승인된 리뷰 수 계산
                        if (review.is_verified) {
                            const currentVerifiedCount = verifiedReviewCountMap.get(review.user_id) || 0;
                            verifiedReviewCountMap.set(review.user_id, currentVerifiedCount + 1);
                        }

                        // 총 좋아요 수 계산 (각 리뷰의 좋아요 수를 합산)
                        const reviewLikes = reviewLikesMap.get(review.id) || 0;
                        const currentLikes = totalLikesMap.get(review.user_id) || 0;
                        totalLikesMap.set(review.user_id, currentLikes + reviewLikes);
                    });

                    console.log('Review stats calculated:', {
                        totalReviews: reviewCountMap.size,
                        verifiedReviews: verifiedReviewCountMap.size,
                        totalLikes: Array.from(totalLikesMap.values()).reduce((sum, likes) => sum + likes, 0)
                    });
                }

                // Calculate user stats for all profiles
                const users = profilesData.map(profile => {
                    const reviewCount = reviewCountMap.get(profile.user_id) || 0;
                    const verifiedReviewCount = verifiedReviewCountMap.get(profile.user_id) || 0;
                    const totalLikes = totalLikesMap.get(profile.user_id) || 0;
                    const badges: { name: string; icon: string; earnedAt: string }[] = [];

                    // Award badges based on achievements
                    if (reviewCount >= 1) {
                        badges.push({ name: "첫 리뷰", icon: "⭐", earnedAt: "" });
                    }
                    if (reviewCount >= 10) {
                        badges.push({ name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" });
                    }
                    if (reviewCount >= 50) {
                        badges.push({ name: "리뷰 마스터", icon: "👑", earnedAt: "" });
                    }
                    if (verifiedReviewCount >= 10) {
                        badges.push({ name: "신뢰의 아이콘", icon: "💎", earnedAt: "" });
                    }
                    if (totalLikes >= 50) {
                        badges.push({ name: "인기인", icon: "❤️", earnedAt: "" });
                    }

                    return {
                        id: profile.user_id,
                        username: profile.nickname,
                        reviewCount,
                        verifiedReviewCount,
                        totalLikes,
                        badges,
                    };
                });

                return users;
            } catch (error) {
                console.warn('리더보드 데이터 조회 중 오류 발생:', error);
                return [];
            }
        },
    });

    // 실시간 정렬 및 순위 부여 - 모든 사용자 포함
    const leaderboardData = (allUsers || [])
        .sort((a, b) => b.reviewCount - a.reviewCount)
        .map((user, index) => ({
            ...user,
            rank: index + 1,
        }));

    // Apply sorting
    const sortedLeaderboard = [...leaderboardData].sort((a, b) => {
        if (sortBy === "reviews") {
            return b.reviewCount - a.reviewCount;
        }
        return 0;
    });


    const getRankIcon = (rank: number, forTable: boolean = false) => {
        if (forTable) {
            // 테이블에서는 각 등수에 맞는 색상 사용
            switch (rank) {
                case 1:
                    return <Trophy className="h-6 w-6 text-yellow-500" />;
                case 2:
                    return <Medal className="h-6 w-6 text-gray-400" />;
                case 3:
                    return <Award className="h-6 w-6 text-amber-600" />;
                default:
                    return <span className="text-lg font-bold text-muted-foreground">{rank}</span>;
            }
        } else {
            // 카드에서는 흰색 사용 (배경색 대비)
            switch (rank) {
                case 1:
                    return <Trophy className="h-6 w-6 text-white" />;
                case 2:
                    return <Medal className="h-6 w-6 text-white" />;
                case 3:
                    return <Award className="h-6 w-6 text-white" />;
                default:
                    return <span className="text-lg font-bold text-muted-foreground">{rank}</span>;
            }
        }
    };

    const getRankBadgeColor = (rank: number) => {
        switch (rank) {
            case 1:
                return "bg-gradient-to-r from-yellow-400 to-yellow-600";
            case 2:
                return "bg-gradient-to-r from-gray-300 to-gray-500";
            case 3:
                return "bg-gradient-to-r from-amber-400 to-amber-600";
            default:
                return "bg-muted";
        }
    };

    const getUserTier = (reviewCount: number) => {
        if (reviewCount >= 100) return { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" };
        if (reviewCount >= 50) return { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" };
        if (reviewCount >= 25) return { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" };
        if (reviewCount >= 10) return { name: "🥈 실버", color: "text-gray-600", bgColor: "bg-gray-50" };
        if (reviewCount >= 5) return { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" };
        return { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };
    };


    return (
        <TooltipProvider>
            <div className="flex flex-col h-full bg-background">
                {/* Header */}
                <div className="border-b border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                                    <Trophy className="h-6 w-6 text-primary" />
                                    쯔동여지도 랭킹
                                </h1>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                맛집 리뷰로 쌓은 랭킹
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-medium text-muted-foreground">
                                총 참가자
                            </div>
                            <div className="text-2xl font-bold text-primary">
                                {sortedLeaderboard.length}
                            </div>
                        </div>
                    </div>

                </div>

                {/* Full Rankings Table */}
                <div className="flex-1 overflow-hidden p-6">
                    <Card className="h-full flex flex-col">
                        <div className="p-4 border-b border-border">
                            <h2 className="font-semibold">전체 랭킹</h2>
                        </div>

                        <ScrollArea className="flex-1">
                            <Table>
                                <TableHeader className="sticky top-0 bg-muted">
                                    <TableRow>
                                        <TableHead className="w-20">순위</TableHead>
                                        <TableHead>사용자</TableHead>
                                        <TableHead className="text-center">
                                            <button
                                                onClick={() => setSortBy("reviews")}
                                                className="flex items-center gap-1 mx-auto hover:text-primary"
                                            >
                                                리뷰 수
                                                {sortBy === "reviews" && <TrendingUp className="h-3 w-3" />}
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-center">받은 좋아요</TableHead>
                                        <TableHead className="text-center">티어</TableHead>
                                        <TableHead>배지</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        // Loading skeleton for table
                                        Array.from({ length: 10 }).map((_, index) => (
                                            <TableRow key={index}>
                                                <TableCell>
                                                    <div className="flex items-center justify-center">
                                                        <div className="w-8 h-8 bg-muted rounded animate-pulse"></div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-8 mx-auto"></div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-10 mx-auto"></div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-12 mx-auto"></div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-1">
                                                        <div className="w-6 h-6 bg-muted rounded animate-pulse"></div>
                                                        <div className="w-6 h-6 bg-muted rounded animate-pulse"></div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : sortedLeaderboard.map((user, index) => (
                                        <TableRow
                                            key={`${user.id}-${index}`}
                                            className="hover:bg-muted/50"
                                        >
                                            <TableCell>
                                                <div className="flex items-center justify-center">
                                                    {getRankIcon(user.rank, true)}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="font-medium">{user.username}</span>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="font-semibold">{user.reviewCount}</span>
                                                <span className="text-muted-foreground text-xs ml-1">개</span>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <span className="font-semibold text-red-600">{user.totalLikes}</span>
                                                    <span className="text-muted-foreground text-xs">❤️</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="outline" className={`${getUserTier(user.reviewCount).bgColor} ${getUserTier(user.reviewCount).color} border-current`}>
                                                    {getUserTier(user.reviewCount).name}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-1 flex-wrap">
                                                    {user.badges.slice(0, 3).map((badge, idx) => {
                                                        const getBadgeDescription = (badgeName: string) => {
                                                            switch (badgeName) {
                                                                case "첫 리뷰":
                                                                    return "⭐ 첫 리뷰: 1개 이상의 리뷰 작성";
                                                                case "열정적인 리뷰어":
                                                                    return "🔥 열정적인 리뷰어: 10개 이상의 리뷰 작성";
                                                                case "리뷰 마스터":
                                                                    return "👑 리뷰 마스터: 50개 이상의 리뷰 작성";
                                                                case "신뢰의 아이콘":
                                                                    return "💎 신뢰의 아이콘: 10개 이상의 승인된 리뷰";
                                                                default:
                                                                    return badgeName;
                                                            }
                                                        };

                                                        return (
                                                            <Tooltip key={idx}>
                                                                <TooltipTrigger asChild>
                                                                    <div className="inline-block">
                                                                        <span className="text-lg cursor-help hover:scale-110 transition-transform duration-200 p-1 rounded-md hover:bg-muted/30">
                                                                            {badge.icon}
                                                                        </span>
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <div className="text-center">
                                                                        <div className="text-lg mb-1">{badge.icon}</div>
                                                                        <p className="font-semibold text-sm">{badge.name}</p>
                                                                        <p className="text-xs text-muted-foreground whitespace-pre-line">
                                                                            {getBadgeDescription(badge.name)}
                                                                        </p>
                                                                    </div>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        );
                                                    })}
                                                    {user.badges.length > 3 && (
                                                        <span className="text-xs text-muted-foreground">
                                                            +{user.badges.length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}

                                    {/* 빈 데이터 상태 */}
                                    {!isLoading && sortedLeaderboard.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-12">
                                                <div className="text-muted-foreground">
                                                    <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                                    <p className="text-sm mb-2">아직 랭킹 데이터가 없습니다</p>
                                                    <p className="text-xs">리뷰를 작성하고 랭킹에 도전해보세요!</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </Card>
                </div>
            </div>
        </TooltipProvider>
    );
};

export default LeaderboardPage;

