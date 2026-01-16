'use client';

import { useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Trophy, Medal, Award, Stamp, Info, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { cn } from '@/lib/utils';
import { GlobalLoader } from '@/components/ui/global-loader';

interface LeaderboardOverlayProps {
    onClose?: () => void;
    onOpenUserProfile?: (userId: string) => void;
}

// 순위 아이콘 반환
const getRankIcon = (rank: number) => {
    switch (rank) {
        case 1: return <Trophy className="h-5 w-5 text-yellow-500" />;
        case 2: return <Medal className="h-5 w-5 text-muted-foreground" />;
        case 3: return <Award className="h-5 w-5 text-amber-600" />;
        default: return <span className="text-sm font-bold text-muted-foreground">{rank}</span>;
    }
};

// 리뷰 수에 따른 티어 반환
const getUserTier = (reviewCount: number) => {
    if (reviewCount >= 100) return { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" };
    if (reviewCount >= 50) return { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" };
    if (reviewCount >= 25) return { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" };
    if (reviewCount >= 10) return { name: "🥈 실버", color: "text-muted-foreground", bgColor: "bg-muted" };
    if (reviewCount >= 5) return { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" };
    return { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };
};

/**
 * 랭킹 오버레이
 * - 모바일/태블릿 랭킹 페이지와 동일한 헤더 스타일
 */
export default function LeaderboardOverlay({ onClose, onOpenUserProfile }: LeaderboardOverlayProps) {
    const { user: currentUser } = useAuth();
    const { data: leaderboardData = [], isLoading } = useLeaderboard();
    const userItemRef = useRef<HTMLDivElement>(null);

    const sortedLeaderboard = useMemo(() =>
        [...leaderboardData].sort((a, b) => b.verifiedReviewCount - a.verifiedReviewCount),
        [leaderboardData]
    );

    const myRank = currentUser ? sortedLeaderboard.find((u) => u.id === currentUser.id)?.rank : null;

    useEffect(() => {
        if (currentUser && userItemRef.current) {
            const timer = setTimeout(() => {
                userItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [currentUser, sortedLeaderboard]);

    if (isLoading) return <GlobalLoader message="랭킹 데이터를 불러오는 중..." />;

    return (
        <div className="flex flex-col h-full bg-background">
            {/* 헤더 - 모바일/태블릿 페이지와 동일 스타일 */}
            <div className="border-b border-border bg-background p-6 shrink-0 rounded-t-2xl">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                                <Trophy className="h-6 w-6 text-primary" />
                                쯔동여지도 랭킹
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-muted" title="랭킹 산정 기준 보기">
                                            <Info className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto max-w-sm">
                                        <div className="space-y-1">
                                            <h4 className="font-medium text-sm whitespace-nowrap">📊 랭킹 산정 기준</h4>
                                            <p className="text-xs text-muted-foreground whitespace-nowrap">
                                                인증된 리뷰(도장) 수가 많을수록 높은 순위를 받습니다.
                                            </p>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </h1>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            맛집 리뷰를 작성하고 랭킹을 올려보세요!
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 hover:bg-muted rounded-full">
                                <X className="h-5 w-5" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* 랭킹 목록 */}
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
                                    <div className="flex-shrink-0 w-10 flex items-center justify-center">{getRankIcon(user.rank)}</div>
                                    <div className="flex-1 min-w-0 max-w-xs">
                                        {onOpenUserProfile ? (
                                            <div
                                                onClick={() => onOpenUserProfile(user.id)}
                                                className={cn("font-semibold text-base truncate block hover:underline cursor-pointer", isCurrentUser ? "text-primary" : "hover:text-primary")}
                                            >
                                                {user.username}{isCurrentUser && " (나)"}
                                            </div>
                                        ) : (
                                            <Link href={`/user/${user.id}`} className={cn("font-semibold text-base truncate block hover:underline cursor-pointer", isCurrentUser ? "text-primary" : "hover:text-primary")}>
                                                {user.username}{isCurrentUser && " (나)"}
                                            </Link>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 ml-auto shrink-0">
                                        <div className="flex items-center gap-1">
                                            <Stamp className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span className="font-bold text-sm">{user.verifiedReviewCount}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs">❤️</span>
                                            <span className="font-bold text-sm text-red-600">{user.totalLikes}</span>
                                        </div>
                                        <Badge variant="outline" className={cn("text-xs px-2 h-5 whitespace-nowrap min-w-[70px] justify-center", tier.bgColor, tier.color, "border-current")}>
                                            {tier.name}
                                        </Badge>
                                    </div>
                                </div>
                            );
                        })}

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
