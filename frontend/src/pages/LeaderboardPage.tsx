import { useState, useEffect, useRef } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboard } from "@/hooks/useLeaderboard";

const LeaderboardPage = () => {

    const { user: currentUser } = useAuth();
    const [sortBy, setSortBy] = useState<"reviews">("reviews");
    const userRowRef = useRef<HTMLTableRowElement>(null);

    // Fetch leaderboard data using custom hook
    const { data: leaderboardData = [], isLoading } = useLeaderboard();

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


    const getUserTier = (reviewCount: number) => {
        if (reviewCount >= 100) return { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" };
        if (reviewCount >= 50) return { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" };
        if (reviewCount >= 25) return { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" };
        if (reviewCount >= 10) return { name: "🥈 실버", color: "text-gray-600", bgColor: "bg-gray-50" };
        if (reviewCount >= 5) return { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" };
        return { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };
    };

    // Calculate my rank
    const myRank = currentUser
        ? sortedLeaderboard.find((u) => u.id === currentUser.id)?.rank
        : null;

    // Auto-scroll to user's row
    useEffect(() => {
        if (!isLoading && currentUser && userRowRef.current) {
            setTimeout(() => {
                userRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500); // 렌더링 후 약간의 지연을 주어 스크롤 동작 보장
        }
    }, [isLoading, currentUser, sortedLeaderboard]);

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
                                    쯔동여지도여지도 랭킹
                                </h1>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                리뷰를 작성하고 랭킹을 올려보세요!
                            </p>
                        </div>
                        <div className="flex gap-8 text-right">
                            {currentUser && (
                                <div>
                                    <div className="text-sm font-medium text-muted-foreground">
                                        나의 순위
                                    </div>
                                    <div className="text-2xl font-bold text-primary">
                                        {myRank ? `${myRank}위` : "-"}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                {/* Full Rankings Table */}
                <div className="flex-1 overflow-hidden p-6">
                    <div className="rounded-md border bg-card h-full flex flex-col">
                        <ScrollArea className="flex-1">
                            <Table>
                                <TableHeader className="sticky top-0 bg-muted z-10">
                                    <TableRow>
                                        <TableHead className="w-20">순위</TableHead>
                                        <TableHead>사용자</TableHead>
                                        <TableHead className="text-center">
                                            <button
                                                onClick={() => setSortBy("reviews")}
                                                className="flex items-center gap-1 mx-auto hover:text-primary"
                                            >
                                                도장 개수
                                                {sortBy === "reviews" && <TrendingUp className="h-3 w-3" />}
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-center">받은 좋아요</TableHead>
                                        <TableHead className="text-center">티어</TableHead>
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

                                            </TableRow>
                                        ))
                                    ) : sortedLeaderboard.map((user, index) => {
                                        const isCurrentUser = currentUser?.id === user.id;
                                        return (
                                            <TableRow
                                                key={`${user.id}-${index}`}
                                                ref={isCurrentUser ? userRowRef : null}
                                                className={`hover:bg-muted/50 ${isCurrentUser ? "bg-primary/10 hover:bg-primary/20 border-l-4 border-l-primary" : ""}`}
                                            >
                                                <TableCell>
                                                    <div className="flex items-center justify-center">
                                                        {getRankIcon(user.rank, true)}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <span className={`font-medium ${isCurrentUser ? "text-primary font-bold" : ""}`}>
                                                        {user.username}
                                                        {isCurrentUser && " (나)"}
                                                    </span>
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

                                            </TableRow>
                                        );
                                    })}

                                    {/* 빈 데이터 상태 */}
                                    {!isLoading && sortedLeaderboard.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-12">
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
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
};

export default LeaderboardPage;

