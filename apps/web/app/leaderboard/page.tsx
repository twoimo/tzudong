'use client';

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Medal, Award, Stamp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useDeviceType } from "@/hooks/useDeviceType";
import { cn } from "@/lib/utils";
import { GlobalLoader } from "@/components/ui/global-loader";

export default function LeaderboardPage() {
    const { user: currentUser } = useAuth();
    const { isMobileOrTablet } = useDeviceType();
    const { data: leaderboardData = [], isLoading } = useLeaderboard();
    const userItemRef = useRef<HTMLDivElement>(null);

    const sortedLeaderboard = [...leaderboardData].sort((a, b) => b.verifiedReviewCount - a.verifiedReviewCount);

    const getRankIcon = (rank: number) => {
        switch (rank) {
            case 1:
                return <Trophy className="h-5 w-5 text-yellow-500" />;
            case 2:
                return <Medal className="h-5 w-5 text-muted-foreground" />;
            case 3:
                return <Award className="h-5 w-5 text-amber-600" />;
            default:
                return <span className="text-sm font-bold text-muted-foreground">{rank}</span>;
        }
    };

    const getUserTier = (reviewCount: number) => {
        if (reviewCount >= 100) return { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" };
        if (reviewCount >= 50) return { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" };
        if (reviewCount >= 25) return { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" };
        if (reviewCount >= 10) return { name: "🥈 실버", color: "text-muted-foreground", bgColor: "bg-muted" };
        if (reviewCount >= 5) return { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" };
        return { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };
    };

    const myRank = currentUser ? sortedLeaderboard.find((u) => u.id === currentUser.id)?.rank : null;

    useEffect(() => {
        if (currentUser && userItemRef.current) {
            setTimeout(() => {
                userItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500);
        }
    }, [currentUser, sortedLeaderboard]);

    if (isLoading) {
        return (
            <GlobalLoader
                message="랭킹 데이터를 불러오는 중..."
                subMessage="사용자들이 열심히 쌓아올린 기록을 확인하고 있습니다"
            />
        );
    }

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-background p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                                <Trophy className="h-6 w-6 text-primary" />
                                쯔동여지도 랭킹
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

            {/* Compact List */}
            <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                    <div className="divide-y divide-border">
                        {sortedLeaderboard.map((user, index) => {
                            const isCurrentUser = currentUser?.id === user.id;
                            const tier = getUserTier(user.verifiedReviewCount);

                            return (
                                <div
                                    key={`${user.id}-${index}`}
                                    ref={isCurrentUser ? userItemRef : null}
                                    className={cn(
                                        "flex items-center gap-3 md:gap-4 px-4 md:px-6 py-3 transition-colors hover:bg-muted/50",
                                        isCurrentUser && "bg-primary/5 border-l-4 border-l-primary"
                                    )}
                                >
                                    {/* 순위 */}
                                    <div className="flex-shrink-0 w-10 flex items-center justify-center">
                                        {getRankIcon(user.rank)}
                                    </div>


                                    {/* 사용자명 - 클릭하면 프로필 페이지로 이동 */}
                                    <div className="flex-1 min-w-0 max-w-xs">
                                        <Link
                                            href={`/user/${user.id}`}
                                            className={cn(
                                                "font-semibold text-base truncate block hover:underline cursor-pointer",
                                                isCurrentUser ? "text-primary" : "hover:text-primary"
                                            )}
                                        >
                                            {user.username}
                                            {isCurrentUser && " (나)"}
                                        </Link>
                                    </div>

                                    {/* 통계 - 인라인 스타일 */}
                                    <div className="flex items-center gap-6 flex-1 justify-end">
                                        {/* 도장 개수 */}
                                        <div className="flex items-center gap-1.5">
                                            <Stamp className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span className="font-bold text-base">
                                                {user.verifiedReviewCount}
                                            </span>
                                        </div>

                                        {/* 좋아요 */}
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">❤️</span>
                                            <span className="font-bold text-base text-red-600">
                                                {user.totalLikes}
                                            </span>
                                        </div>

                                        {/* 티어 */}
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                "text-xs px-2.5 h-6 whitespace-nowrap min-w-[80px] justify-center",
                                                tier.bgColor,
                                                tier.color,
                                                "border-current"
                                            )}
                                        >
                                            {tier.name}
                                        </Badge>
                                    </div>
                                </div>
                            );
                        })}

                        {/* 빈 데이터 상태 */}
                        {sortedLeaderboard.length === 0 && (
                            <div className="text-center py-12 text-muted-foreground">
                                <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                <p className="text-sm mb-2">아직 랭킹 데이터가 없습니다</p>
                                <p className="text-xs">리뷰를 작성하고 랭킹에 도전해보세요!</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
