import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
    rank: number;
    username: string;
    reviewCount: number;
    verifiedReviewCount: number;
    badges: { name: string; icon: string; earnedAt: string }[];
}

// 더미 리더보드 데이터
const DUMMY_LEADERBOARD: LeaderboardUser[] = [
    {
        id: "dummy-user-1",
        rank: 1,
        username: "쯔양팬123 (샘플)",
        reviewCount: 128,
        verifiedReviewCount: 120,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
            { name: "리뷰 마스터", icon: "👑", earnedAt: "" },
            { name: "신뢰의 아이콘", icon: "💎", earnedAt: "" },
        ],
    },
    {
        id: "dummy-user-2",
        rank: 2,
        username: "맛집러버 (샘플)",
        reviewCount: 95,
        verifiedReviewCount: 88,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
            { name: "리뷰 마스터", icon: "👑", earnedAt: "" },
            { name: "신뢰의 아이콘", icon: "💎", earnedAt: "" },
        ],
    },
    {
        id: "dummy-user-3",
        rank: 3,
        username: "먹방마니아 (샘플)",
        reviewCount: 76,
        verifiedReviewCount: 70,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
            { name: "신뢰의 아이콘", icon: "💎", earnedAt: "" },
        ],
    },
    {
        id: "dummy-user-4",
        rank: 4,
        username: "쯔양따라잡기 (샘플)",
        reviewCount: 64,
        verifiedReviewCount: 58,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
            { name: "신뢰의 아이콘", icon: "💎", earnedAt: "" },
        ],
    },
    {
        id: "dummy-user-5",
        rank: 5,
        username: "리뷰왕 (샘플)",
        reviewCount: 52,
        verifiedReviewCount: 49,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
        ],
    },
    {
        id: "dummy-user-6",
        rank: 6,
        username: "칼국수조아 (샘플)",
        reviewCount: 45,
        verifiedReviewCount: 42,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
        ],
    },
    {
        id: "dummy-user-7",
        rank: 7,
        username: "야식킹 (샘플)",
        reviewCount: 38,
        verifiedReviewCount: 35,
        badges: [
            { name: "첫 리뷰", icon: "⭐", earnedAt: "" },
            { name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" },
        ],
    },
];

const LeaderboardPage = () => {
    const [sortBy, setSortBy] = useState<"reviews">("reviews");

    // Fetch leaderboard data from Supabase - reviews와 profiles 별도 조회 후 조인
    const { data: leaderboardData = [], isLoading } = useQuery({
        queryKey: ['leaderboard', sortBy],
        queryFn: async () => {
            try {
                // Get all verified reviews
                const { data: reviewsData, error: reviewsError } = await supabase
                    .from('reviews')
                    .select('user_id, is_verified')
                    .eq('is_verified', true); // Only verified reviews

                if (reviewsError) {
                    console.warn('리뷰 데이터 조회 실패, 샘플 데이터 표시:', reviewsError.message);
                    return DUMMY_LEADERBOARD;
                }

                if (!reviewsData || reviewsData.length === 0) {
                    console.warn('승인된 리뷰 데이터가 없음, 샘플 데이터 표시');
                    return DUMMY_LEADERBOARD;
                }

                // Get unique user IDs
                const userIds = [...new Set(reviewsData.map(review => review.user_id))];

                // Get profile info for these users
                const { data: profilesData, error: profilesError } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);

                if (profilesError) {
                    console.warn('프로필 데이터 조회 실패:', profilesError.message);
                }

                // Create profiles map
                const profilesMap = new Map(
                    (profilesData || []).map(profile => [profile.user_id, profile.nickname])
                );

                // Group reviews by user and calculate stats
                const userStats = new Map<string, {
                    userId: string;
                    nickname: string;
                    totalReviews: number;
                    verifiedReviews: number;
                }>();

                reviewsData.forEach(review => {
                    const userId = review.user_id;
                    const nickname = profilesMap.get(userId) || '익명';

                    const current = userStats.get(userId) || {
                        userId,
                        nickname,
                        totalReviews: 0,
                        verifiedReviews: 0
                    };

                    current.totalReviews++;
                    if (review.is_verified) {
                        current.verifiedReviews++;
                    }

                    userStats.set(userId, current);
                });

                // Convert to leaderboard format and sort
                const leaderboard = Array.from(userStats.values())
                    .filter(user => user.totalReviews > 0)
                    .sort((a, b) => b.totalReviews - a.totalReviews)
                    .map((user, index) => {
                        const badges = [];

                        // Award badges based on achievements
                        if (user.totalReviews >= 1) {
                            badges.push({ name: "첫 리뷰", icon: "⭐", earnedAt: "" });
                        }
                        if (user.totalReviews >= 10) {
                            badges.push({ name: "열정적인 리뷰어", icon: "🔥", earnedAt: "" });
                        }
                        if (user.totalReviews >= 50) {
                            badges.push({ name: "리뷰 마스터", icon: "👑", earnedAt: "" });
                        }
                        if (user.verifiedReviews >= 10) {
                            badges.push({ name: "신뢰의 아이콘", icon: "💎", earnedAt: "" });
                        }

                        return {
                            id: user.userId,
                            rank: index + 1,
                            username: user.nickname,
                            reviewCount: user.totalReviews,
                            verifiedReviewCount: user.verifiedReviews,
                            badges,
                        } as LeaderboardUser;
                    });

                // 실제 데이터가 없으면 더미 데이터 반환
                if (leaderboard.length === 0) {
                    return DUMMY_LEADERBOARD;
                }

                console.log(`🏆 리더보드 데이터 로드 완료: ${leaderboard.length}명의 사용자`);
                return leaderboard;
            } catch (error) {
                console.warn('리더보드 데이터 조회 중 오류 발생, 샘플 데이터 표시:', error);
                return DUMMY_LEADERBOARD;
            }
        },
    });

    // Apply sorting
    const sortedLeaderboard = [...leaderboardData].sort((a, b) => {
        if (sortBy === "reviews") {
            return b.reviewCount - a.reviewCount;
        }
        return 0;
    });
    const isDummyData = leaderboardData.length > 0 && leaderboardData[0].id.startsWith('dummy-');

    const getRankIcon = (rank: number) => {
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
                                    쯔양 팬 랭킹
                                </h1>
                                {isDummyData && (
                                    <Badge variant="secondary" className="text-xs">
                                        📊 샘플 데이터
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                맛집 리뷰로 쌓은 랭킹
                            </p>
                        </div>
                    </div>

                    {/* Top 3 Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                        {isLoading ? (
                            // Loading skeleton for top 3
                            Array.from({ length: 3 }).map((_, index) => (
                                <Card key={index} className="p-4">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-12 h-12 rounded-full bg-muted animate-pulse flex items-center justify-center">
                                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="h-5 bg-muted rounded animate-pulse mb-1"></div>
                                            <div className="h-3 bg-muted rounded animate-pulse w-16"></div>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="h-3 bg-muted rounded animate-pulse w-12"></div>
                                            <div className="h-3 bg-muted rounded animate-pulse w-8"></div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="h-3 bg-muted rounded animate-pulse w-20"></div>
                                            <div className="h-3 bg-muted rounded animate-pulse w-8"></div>
                                        </div>
                                    </div>
                                </Card>
                            ))
                        ) : sortedLeaderboard.slice(0, 3).map((user) => (
                            <Card
                                key={user.id}
                                className={`p-4 ${user.rank === 1 ? "border-2 border-primary shadow-lg" : ""
                                    }`}
                            >
                                <div className="flex items-center gap-3 mb-3">
                                    <div className={`w-12 h-12 rounded-full ${getRankBadgeColor(user.rank)} flex items-center justify-center`}>
                                        {getRankIcon(user.rank)}
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-lg">{user.username}</h3>
                                        <p className="text-xs text-muted-foreground">#{user.rank} 랭킹</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">리뷰 수</span>
                                        <span className="font-semibold">{user.reviewCount}개</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground flex items-center gap-1">
                                            <CheckCircle className="h-3 w-3" />
                                            검증된 리뷰
                                        </span>
                                        <span className="font-semibold text-green-600">
                                            {user.verifiedReviewCount}개
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-3 pt-3 border-t border-border">
                                    <p className="text-xs text-muted-foreground mb-2">배지</p>
                                    <div className="flex gap-1 flex-wrap">
                                        {user.badges.map((badge, idx) => {
                                            const getBadgeDescription = (badgeName: string) => {
                                                switch (badgeName) {
                                                    case "첫 리뷰":
                                                        return "⭐ 첫 리뷰 작성 시 획득\n1개 이상의 리뷰를 작성하세요";
                                                    case "열정적인 리뷰어":
                                                        return "🔥 열정적인 리뷰어\n10개 이상의 리뷰를 작성하세요";
                                                    case "리뷰 마스터":
                                                        return "👑 리뷰 마스터\n50개 이상의 리뷰를 작성하세요";
                                                    case "신뢰의 아이콘":
                                                        return "💎 신뢰의 아이콘\n10개 이상의 리뷰가 승인되면 획득";
                                                    default:
                                                        return badgeName;
                                                }
                                            };

                                            return (
                                                <Tooltip key={idx}>
                                                    <TooltipTrigger asChild>
                                                        <div className="inline-block">
                                                            <Badge variant="outline" className="text-xs cursor-help">
                                                                {badge.icon} {badge.name}
                                                            </Badge>
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="whitespace-pre-line text-sm">
                                                            {getBadgeDescription(badge.name)}
                                                        </p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            );
                                        })}
                                    </div>
                                </div>
                            </Card>
                        ))}
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
                                        <TableHead className="text-center">검증된 리뷰</TableHead>
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
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-8 h-8 bg-muted rounded animate-pulse"></div>
                                                        <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-8 mx-auto"></div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="w-12 h-5 bg-muted rounded animate-pulse mx-auto"></div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-1">
                                                        <div className="w-6 h-6 bg-muted rounded animate-pulse"></div>
                                                        <div className="w-6 h-6 bg-muted rounded animate-pulse"></div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : sortedLeaderboard.map((user) => (
                                        <TableRow key={user.id} className="hover:bg-muted/50">
                                            <TableCell>
                                                <div className="flex items-center justify-center">
                                                    {getRankIcon(user.rank)}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarFallback>
                                                            {user.username[0]}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <span className="font-medium">{user.username}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="font-semibold">{user.reviewCount}</span>
                                                <span className="text-muted-foreground text-xs ml-1">개</span>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                    <CheckCircle className="h-3 w-3 mr-1" />
                                                    {user.verifiedReviewCount}
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
                                                                        <span className="text-lg cursor-help">
                                                                            {badge.icon}
                                                                        </span>
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p className="text-sm">
                                                                        {getBadgeDescription(badge.name)}
                                                                    </p>
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

