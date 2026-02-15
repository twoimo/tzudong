'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
import { BREAKPOINTS } from "@/hooks/useDeviceType";

export default function LeaderboardPage() {
    const router = useRouter();
    const { user: currentUser } = useAuth();
    const LEADERBOARD_PAGE_SIZE = 15;
    const [period, setPeriod] = useState<'all' | 'monthly'>('all');
    const { data: leaderboardData = [], isLoading } = useLeaderboard(period);
    const userItemRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [displayLimit, setDisplayLimit] = useState(LEADERBOARD_PAGE_SIZE);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);

        const redirectIfDesktop = () => {
            if (window.innerWidth > BREAKPOINTS.tabletMax) {
                router.replace('/');
            }
        };

        redirectIfDesktop();
        window.addEventListener('resize', redirectIfDesktop, { passive: true });

        return () => {
            window.removeEventListener('resize', redirectIfDesktop);
        };
    }, [router]);

    const displayedUsers = useMemo(
        () => leaderboardData.slice(0, displayLimit),
        [leaderboardData, displayLimit]
    );

    const hasMoreToDisplay = displayLimit < leaderboardData.length;

    const loadMoreUsers = useCallback(() => {
        if (hasMoreToDisplay) {
            setDisplayLimit(prev => prev + LEADERBOARD_PAGE_SIZE);
        }
    }, [hasMoreToDisplay]);

    useEffect(() => {
        setDisplayLimit(LEADERBOARD_PAGE_SIZE);
    }, [period]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreUsers();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreUsers]);

    useEffect(() => {
        if (!isLoading && currentUser && leaderboardData.length > 0) {
            const timer = setTimeout(() => {
                userItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isLoading, currentUser, leaderboardData]);

    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > BREAKPOINTS.tabletMax) return null;

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden relative">
            <ScrollArea className="h-full">
                {/* Header */}
                <div className="border-b border-border bg-background p-4 sm:p-6">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <h1 className="text-[1.125rem] xs:text-xl sm:text-2xl font-bold text-primary flex items-center gap-1.5 sm:gap-2 min-w-0">
                                    <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
                                    <span className="whitespace-nowrap">쯔동여지도 랭킹</span>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="hidden xs:inline-flex h-6 w-6 rounded-full hover:bg-muted shrink-0"
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
                            <p className="text-xs xs:text-sm text-muted-foreground whitespace-nowrap mt-1">
                                맛집 리뷰를 작성하고 랭킹을 올려보세요!
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Tabs value={period} onValueChange={(v) => setPeriod(v as 'all' | 'monthly')} className="w-auto">
                                <TabsList className="h-8">
                                    <TabsTrigger value="all" className="text-xs px-2 sm:px-3">전체</TabsTrigger>
                                    <TabsTrigger value="monthly" className="text-xs px-2 sm:px-3">월간</TabsTrigger>
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
                            users={displayedUsers}
                            currentUserId={currentUser?.id}
                            userItemRef={userItemRef}
                        />
                    )}
                    <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
                        {hasMoreToDisplay && (
                            <span className="text-sm text-muted-foreground">
                                더 불러오는 중... ({displayedUsers.length} / {leaderboardData.length}명)
                            </span>
                        )}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
