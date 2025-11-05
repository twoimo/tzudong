import { useState, useRef, useCallback, useEffect } from "react";
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
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LeaderboardUser {
    id: string;
    rank?: number; // 랭킹 데이터 생성 시 추가되는 속성
    username: string;
    reviewCount: number;
    verifiedReviewCount: number;
    badges: { name: string; icon: string; earnedAt: string }[];
}


const LeaderboardPage = () => {
    const [sortBy, setSortBy] = useState<"reviews">("reviews");

    // Fetch leaderboard data from Supabase - 무한 스크롤 방식
    const {
        data: leaderboardPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['leaderboard', sortBy],
        queryFn: async ({ pageParam = 0 }) => {
            try {
                // Get verified reviews with pagination
                const { data: reviewsData, error: reviewsError } = await supabase
                    .from('reviews')
                    .select('user_id, is_verified')
                    .eq('is_verified', true)
                    .range(pageParam, pageParam + 199) // 한 페이지당 200개 리뷰씩
                    .order('created_at', { ascending: false });

                if (reviewsError) {
                    console.warn('리뷰 데이터 조회 실패:', reviewsError.message);
                    throw new Error(`리뷰 데이터 조회 실패: ${reviewsError.message}`);
                }

                if (!reviewsData) {
                    console.warn('리뷰 데이터가 null입니다');
                    return { users: [], nextCursor: null };
                }

                if (reviewsData.length === 0) {
                    return { users: [], nextCursor: null };
                }

                // Get unique user IDs - 데이터 유효성 검증
                const userIds = [...new Set(
                    reviewsData
                        .map(review => review.user_id)
                        .filter(userId => userId && typeof userId === 'string')
                )];

                if (userIds.length === 0) {
                    console.warn('유효한 사용자 ID가 없습니다');
                    return { users: [], nextCursor: null };
                }

                // Get profile info for these users
                const { data: profilesData, error: profilesError } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);

                if (profilesError) {
                    console.warn('프로필 데이터 조회 실패:', profilesError.message);
                    throw new Error(`프로필 데이터 조회 실패: ${profilesError.message}`);
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
                    const nickname = profilesMap.get(userId);

                    // 탈퇴한 사용자는 랭킹에서 제외 (프로필이 없거나 '탈퇴한 사용자'인 경우)
                    if (!nickname || nickname === '탈퇴한 사용자') {
                        return;
                    }

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

                // Convert to leaderboard format
                const users = Array.from(userStats.values())
                    .filter(user => user.totalReviews > 0)
                    .map((user) => {
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

                        // 데이터 유효성 검증
                        if (!user.userId || !user.nickname || user.totalReviews < 0 || user.verifiedReviews < 0) {
                            console.warn('유효하지 않은 사용자 데이터:', user);
                            return null;
                        }

                        return {
                            id: user.userId,
                            username: user.nickname,
                            reviewCount: user.totalReviews,
                            verifiedReviewCount: user.verifiedReviews,
                            badges,
                        };
                    }).filter(user => user !== null); // null 값 필터링

                // 다음 페이지 커서 계산
                const nextCursor = reviewsData.length === 200 ? pageParam + 200 : null;

                return {
                    users,
                    nextCursor,
                };
            } catch (error) {
                console.warn('리더보드 데이터 조회 중 오류 발생:', error);
                return { users: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
    });

    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const allLeaderboardUsers = leaderboardPages?.pages.flatMap(page => page.users) || [];

    // 유저별로 데이터를 합치기 (중복 제거) - 메모리 효율적 방식
    const userMap = new Map<string, LeaderboardUser>();

    // 안전하게 데이터 처리
    if (Array.isArray(allLeaderboardUsers)) {
        allLeaderboardUsers.forEach(user => {
            if (!user || !user.id || typeof user.reviewCount !== 'number') {
                console.warn('Invalid user data:', user);
                return;
            }

            const existing = userMap.get(user.id);
            if (!existing || user.reviewCount > existing.reviewCount) {
                userMap.set(user.id, user);
            }
        });
    }

    // 실시간 정렬 및 순위 부여
    const leaderboardData = Array.from(userMap.values())
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

    // 테이블 무한 스크롤을 위한 Intersection Observer
    const loadMoreTableRef = useRef<HTMLTableRowElement>(null);

    const loadMoreLeaderboard = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage && !isLoading) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage, isLoading]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                // entries가 존재하고 첫 번째 entry가 교차하는지 확인
                if (entries && entries[0] && entries[0].isIntersecting) {
                    loadMoreLeaderboard();
                }
            },
            {
                threshold: 0.1,
                rootMargin: '50px' // 50px 전에 로드 시작
            }
        );

        const currentRef = loadMoreTableRef.current;
        if (currentRef) {
            observer.observe(currentRef);
        }

        // 클린업 함수
        return () => {
            if (currentRef) {
                observer.unobserve(currentRef);
            }
            observer.disconnect();
        };
    }, [loadMoreLeaderboard]);

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
                        ) : sortedLeaderboard.slice(0, 3).map((user, index) => (
                            <Card
                                key={`${user.id}-${index}`}
                                className={`p-4 relative ${user.rank === 1 ? "border-2 border-primary shadow-lg" : ""
                                    }`}
                            >
                                {/* 티어 배지 - 우측 상단 */}
                                <div className="absolute top-2 right-2">
                                    <Badge variant="outline" className={`${getUserTier(user.reviewCount).bgColor} ${getUserTier(user.reviewCount).color} border-current text-xs px-2 py-0.5`}>
                                        {getUserTier(user.reviewCount).name}
                                    </Badge>
                                </div>

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
                                                리뷰
                                                {sortBy === "reviews" && <TrendingUp className="h-3 w-3" />}
                                            </button>
                                        </TableHead>
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
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-8 h-8 bg-muted rounded animate-pulse"></div>
                                                        <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-8 mx-auto"></div>
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
                                            ref={index === sortedLeaderboard.length - 1 ? loadMoreTableRef : null}
                                            className="hover:bg-muted/50"
                                        >
                                            <TableCell>
                                                <div className="flex items-center justify-center">
                                                    {getRankIcon(user.rank, true)}
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

                                    {/* 빈 데이터 상태 */}
                                    {!isLoading && sortedLeaderboard.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-12">
                                                <div className="text-muted-foreground">
                                                    <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                                    <p className="text-sm mb-2">아직 랭킹 데이터가 없습니다</p>
                                                    <p className="text-xs">리뷰를 작성하고 랭킹에 도전해보세요!</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {/* 추가 로딩 표시 */}
                                    {isFetchingNextPage && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                                    <span className="text-sm text-muted-foreground">더 많은 랭킹을 불러오는 중...</span>
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

