'use client';

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { Trophy, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { LeaderboardSkeleton } from "@/components/ui/skeleton-loaders";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

export default function LeaderboardPage() {
    const { user: currentUser } = useAuth();
    const [period, setPeriod] = useState<'all' | 'monthly'>('all');
    const { data: leaderboardData = [], isLoading } = useLeaderboard(period);
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


    useEffect(() => {
        if (!isLoading && currentUser && leaderboardData.length > 0) {
            const timer = setTimeout(() => {
                userItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isLoading, currentUser, leaderboardData]);

    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > 1024) return null;

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden relative">
            <ScrollArea className="h-full">
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
                                                title="랭킹 및 티어 산정 기준 보기"
                                            >
                                                <Info className="h-4 w-4 text-muted-foreground" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto max-w-sm">
                                            <div className="space-y-3">
                                                <div>
                                                    <h4 className="font-medium text-sm">📊 랭킹 산정 기준</h4>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        품질 점수 = 리뷰수 × (1 + 평균좋아요 × 0.1)
                                                    </p>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-sm">🏅 티어 산정 기준</h4>
                                                    <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                                                        <li>👑 마스터: 150점 이상</li>
                                                        <li>💎 다이아몬드: 75점 이상</li>
                                                        <li>🏆 골드: 35점 이상</li>
                                                        <li>🥈 실버: 15점 이상</li>
                                                        <li>🥉 브론즈: 7점 이상</li>
                                                        <li>🌱 뉴비: 7점 미만</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </h1>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                맛집 리뷰를 작성하고 랭킹을 올려보세요!
                            </p>
                        </div>
                        <div>
                            <Tabs value={period} onValueChange={(v) => setPeriod(v as 'all' | 'monthly')} className="w-auto">
                                <TabsList className="h-8">
                                    <TabsTrigger value="all" className="text-xs px-3">전체</TabsTrigger>
                                    <TabsTrigger value="monthly" className="text-xs px-3">월간</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </div>
                    </div>
                </div>

                {/* List Content */}
                <div>
                    {isLoading ? (
                        <LeaderboardSkeleton count={8} showHeader={false} />
                    ) : (
                        <LeaderboardList
                            users={leaderboardData}
                            currentUserId={currentUser?.id}
                            userItemRef={userItemRef}
                        />
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
