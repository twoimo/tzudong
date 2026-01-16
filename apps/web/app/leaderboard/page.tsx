'use client';

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { Trophy, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { GlobalLoader } from "@/components/ui/global-loader";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export default function LeaderboardPage() {
    const { user: currentUser } = useAuth();
    const { data: leaderboardData = [], isLoading } = useLeaderboard();
    const userItemRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        // [DESKTOP CHECK]
        if (window.innerWidth > 1024) {
            router.replace('/');
        }
    }, [router]);

    const sortedLeaderboard = [...leaderboardData].sort((a, b) => b.verifiedReviewCount - a.verifiedReviewCount);
    const myRank = currentUser ? sortedLeaderboard.find((u) => u.id === currentUser.id)?.rank : null;


    useEffect(() => {
        if (currentUser && userItemRef.current) {
            setTimeout(() => {
                userItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500);
        }
    }, [currentUser, sortedLeaderboard]);

    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > 1024) return null;

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
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                                <Trophy className="h-6 w-6 text-primary" />
                                쯔동여지도 랭킹
                                {/* Info Icon with Popover */}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 rounded-full hover:bg-muted"
                                            title="랭킹 산정 기준 보기"
                                        >
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
                <LeaderboardList
                    users={sortedLeaderboard}
                    currentUserId={currentUser?.id}
                    userItemRef={userItemRef}
                />
            </div>
        </div>
    );
}
