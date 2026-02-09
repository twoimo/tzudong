'use client';

import { useEffect, useRef, useState } from 'react';
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { LeaderboardUser } from '@/components/leaderboard/leaderboard-utils';
import { Trophy, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from '@/contexts/AuthContext';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { GlobalLoader } from '@/components/ui/global-loader';

interface LeaderboardOverlayProps {
    onClose?: () => void;
    onOpenUserProfile?: (userId: string) => void;
}


/**
 * 랭킹 오버레이
 * - 모바일/태블릿 랭킹 페이지와 동일한 헤더 스타일
 */
export default function LeaderboardOverlay({ onClose, onOpenUserProfile }: LeaderboardOverlayProps) {
    const { user: currentUser } = useAuth();
    const [period, setPeriod] = useState<'all' | 'monthly'>('all');
    const { data: leaderboardData = [], isLoading } = useLeaderboard(period);
    const userItemRef = useRef<HTMLDivElement>(null);

    // 이미 useLeaderboard에서 qualityScore 기준으로 정렬됨
    const myRank = currentUser ? leaderboardData.find((u: LeaderboardUser) => u.id === currentUser.id)?.rank : null;

    useEffect(() => {
        if (!isLoading && currentUser && leaderboardData.length > 0) {
            const timer = setTimeout(() => {
                userItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isLoading, currentUser, leaderboardData]);

    if (isLoading) return <GlobalLoader message="랭킹 데이터를 불러오는 중..." />;

    return (
        <div className="flex flex-col bg-background h-full">
            <ScrollArea className="h-full">
                {/* 헤더 - 모바일/태블릿 페이지와 동일 스타일 */}
                <div className="border-b border-border bg-background p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                                    <Trophy className="h-6 w-6 text-primary" />
                                    쯔동여지도 랭킹
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-muted" title="랭킹 및 티어 산정 기준 보기">
                                                <Info className="h-4 w-4 text-muted-foreground" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto max-w-sm z-[100]" align="start">
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
                        <div className="flex items-center gap-4">
                            <Tabs value={period} onValueChange={(v) => setPeriod(v as 'all' | 'monthly')} className="w-auto">
                                <TabsList>
                                    <TabsTrigger value="all">전체</TabsTrigger>
                                    <TabsTrigger value="monthly">월간</TabsTrigger>
                                </TabsList>
                            </Tabs>

                            {onClose && (
                                <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 hover:bg-muted rounded-full">
                                    <X className="h-5 w-5" />
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 랭킹 목록 */}
                <div>
                    <LeaderboardList
                        users={leaderboardData}
                        currentUserId={currentUser?.id}
                        onOpenUserProfile={onOpenUserProfile}
                        userItemRef={userItemRef}
                    />
                </div>
            </ScrollArea>
        </div>
    );
}
