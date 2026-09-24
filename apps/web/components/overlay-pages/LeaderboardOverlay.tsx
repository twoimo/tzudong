'use client';

import { useEffect, useRef, useState, useMemo, useCallback, type CSSProperties } from 'react';
import { MapPanelHeader, mapPanelIconButtonClass } from "@/components/home/map-panel-chrome";
import { LeaderboardList } from "@/components/leaderboard/LeaderboardList";
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from '@/contexts/AuthContext';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { LeaderboardSkeleton } from '@/components/ui/skeleton-loaders';

interface LeaderboardOverlayProps {
    onClose?: () => void;
    onOpenUserProfile?: (userId: string) => void;
}

const DESKTOP_LEFT_PANEL_LEADERBOARD_LIST_STYLE: CSSProperties = {
    width: 'calc(100% - 1.5rem)',
    maxWidth: '368px',
    marginInline: 'auto',
};

/**
 * 랭킹 오버레이
 * - 모바일/태블릿 랭킹 페이지와 동일한 헤더 스타일
 */
export default function LeaderboardOverlay({ onClose, onOpenUserProfile }: LeaderboardOverlayProps) {
    const { user: currentUser } = useAuth();
    const LEADERBOARD_PAGE_SIZE = 15;
    const [period, setPeriod] = useState<'all' | 'monthly'>('all');
    const {
        data: leaderboardData = [],
        isError,
        isLoading,
        refetch,
    } = useLeaderboard(period);
    const scrollRef = useRef<HTMLDivElement>(null);
    const userItemRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [displayLimit, setDisplayLimit] = useState(LEADERBOARD_PAGE_SIZE);

    // 이미 useLeaderboard에서 qualityScore 기준으로 정렬됨
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
            { root: scrollRef.current, threshold: 0.1 }
        );

        const target = loadMoreRef.current;
        if (target) observer.observe(target);

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

    return (
        <div className="flex flex-col bg-background h-full">
            <div
                ref={scrollRef}
                className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"
            >
                {/* 헤더 - 모바일/태블릿 페이지와 동일 스타일 */}
                <MapPanelHeader
                    title="랭킹"
                    titleAs="h1"
                    description="리뷰를 남기고 순위를 올려 보세요"
                    closeLabel="랭킹 패널 닫기"
                    onClose={onClose}
                    actions={(
                        <>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="ghost" size="icon" className={mapPanelIconButtonClass} title="랭킹 및 티어 산정 기준 보기" aria-label="랭킹 및 티어 산정 기준 보기">
                                                <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
                            <Tabs value={period} onValueChange={(v) => setPeriod(v as 'all' | 'monthly')} className="w-auto">
                                <TabsList className="h-8">
                                    <TabsTrigger value="all" className="px-2 text-xs">전체</TabsTrigger>
                                    <TabsTrigger value="monthly" className="px-2 text-xs">월간</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </>
                    )}
                />

                {/* 랭킹 목록 */}
                <div>
                    <div
                        data-desktop-left-panel-leaderboard-list="true"
                        style={DESKTOP_LEFT_PANEL_LEADERBOARD_LIST_STYLE}
                    >
                        {isLoading ? (
                            <LeaderboardSkeleton
                                count={8}
                                showHeader={false}
                                compactLeftPanel
                            />
                        ) : (
                            <LeaderboardList
                                users={displayedUsers}
                                currentUserId={currentUser?.id}
                                onOpenUserProfile={onOpenUserProfile}
                                userItemRef={userItemRef}
                                compactLeftPanel
                                isError={isError}
                                onRetry={() => { void refetch(); }}
                            />
                        )}
                    </div>
                    <div
                        ref={loadMoreRef}
                        className="flex h-10 items-center justify-center"
                        style={DESKTOP_LEFT_PANEL_LEADERBOARD_LIST_STYLE}
                    >
                        {hasMoreToDisplay && (
                            <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
                                더 불러오는 중… ({displayedUsers.length} / {leaderboardData.length}명)
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
