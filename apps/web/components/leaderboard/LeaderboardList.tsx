'use client';

import React from 'react';
import Link from 'next/link';
import { Heart, Stamp, Trophy, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getRankIconElement, getUserTier, LeaderboardUser } from './leaderboard-utils';

const COMPACT_LEFT_PANEL_ROW_STYLE = {
    paddingLeft: '0.5rem',
    paddingRight: '1.25rem',
} as const;

interface LeaderboardListProps {
    users: LeaderboardUser[];
    currentUserId?: string;
    onOpenUserProfile?: (userId: string) => void;
    userItemRef?: React.RefObject<HTMLDivElement | null>;
    compactLeftPanel?: boolean;
}

export function LeaderboardList({
    users,
    currentUserId,
    onOpenUserProfile,
    userItemRef,
    compactLeftPanel = false
}: LeaderboardListProps) {
    return (
        <div className="divide-y divide-border">
            {users.map((user, index) => {
                const isCurrentUser = currentUserId === user.id;
                const tier = getUserTier(user.qualityScore);

                return (
                            <div
                                key={`${user.id}-${index}`}
                                ref={isCurrentUser ? userItemRef : null}
                                style={
                                    compactLeftPanel
                                        ? COMPACT_LEFT_PANEL_ROW_STYLE
                                        : undefined
                                }
                                className={cn(
                                compactLeftPanel
                                    ? "flex w-full max-w-full items-center gap-2 overflow-hidden pl-2 pr-5 py-4 sm:gap-2.5 sm:pl-2 sm:pr-5 sm:py-4.5 md:pl-2 md:pr-5 lg:gap-2.5 lg:pl-2 lg:pr-5 lg:py-3 transition-colors hover:bg-muted/50 min-w-0"
                                    : "flex w-full max-w-full items-center gap-1.5 sm:gap-4 md:gap-5 overflow-hidden pl-2 pr-2 sm:px-6 py-4 sm:py-4.5 lg:gap-4 lg:px-6 lg:py-3 transition-colors hover:bg-muted/50 min-w-0",
                                isCurrentUser && "bg-primary/5 border-l-4 border-l-primary"
                            )}
                        >
                        {/* Rank */}
                        <div
                            className={cn(
                                "flex-shrink-0 w-8 sm:w-10 flex items-center justify-center",
                                compactLeftPanel && "w-7 sm:w-7"
                            )}
                        >
                            {getRankIconElement(user.rank)}
                        </div>

                        {/* Username */}
                        <div
                            className={cn(
                                "flex-1 min-w-0",
                                compactLeftPanel && "max-w-none sm:max-w-none"
                            )}
                        >
                            {onOpenUserProfile ? (
                                <button
                                    type="button"
                                    onClick={() => onOpenUserProfile(user.id)}
                                    className={cn(
                                        "w-full text-left font-semibold text-base sm:text-lg truncate block hover:underline cursor-pointer lg:text-base",
                                        isCurrentUser ? "text-primary" : "hover:text-primary"
                                    )}
                                >
                                    {user.username}
                                    {isCurrentUser && " (나)"}
                                </button>
                            ) : (
                                <Link
                                    href={`/user/${user.id}`}
                                    className={cn(
                                        "font-semibold text-base sm:text-lg truncate block hover:underline cursor-pointer lg:text-base",
                                        isCurrentUser ? "text-primary" : "hover:text-primary"
                                    )}
                                >
                                    {user.username}
                                    {isCurrentUser && " (나)"}
                                </Link>
                            )}
                        </div>

                        {/* Stats */}
                        <div
                            className={cn(
                                "ml-auto flex min-w-max shrink-0 items-center gap-1 text-sm tabular-nums sm:gap-3 sm:text-base md:gap-4",
                                compactLeftPanel && "gap-1.5 sm:gap-2 md:gap-2"
                            )}
                            data-leaderboard-mobile-stats="no-clip"
                        >
                            <div className="flex items-center gap-0.5 shrink-0 sm:gap-1">
                                <Sparkles className="h-3.5 w-3.5 sm:h-5 sm:w-5 lg:h-3.5 lg:w-3.5 text-amber-500 fill-amber-100" />
                                <span className="font-bold text-sm sm:text-lg lg:text-sm text-amber-600">
                                    {user.qualityScore ?? 0}
                                </span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0 sm:gap-1">
                                <Stamp className="h-3.5 w-3.5 sm:h-5 sm:w-5 lg:h-3.5 lg:w-3.5 text-muted-foreground" />
                                <span className="font-bold text-sm sm:text-lg lg:text-sm">
                                    {user.verifiedReviewCount}
                                </span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0 sm:gap-1">
                                <Heart
                                    className="h-3.5 w-3.5 text-red-500 fill-red-500 sm:h-5 sm:w-5 lg:h-3.5 lg:w-3.5"
                                    aria-hidden="true"
                                />
                                <span className="font-bold text-sm sm:text-lg lg:text-sm text-red-600">
                                    {user.totalLikes}
                                </span>
                            </div>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "hidden sm:inline-flex text-sm px-2.5 h-5 whitespace-nowrap min-w-[76px] justify-center shrink-0 sm:h-6 sm:text-sm lg:min-w-[70px] lg:px-2",
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

            {/* Empty State */}
            {users.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                    <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm mb-2">아직 랭킹 데이터가 없습니다</p>
                    <p className="text-xs">리뷰를 작성하고 랭킹에 도전해보세요!</p>
                </div>
            )}
        </div>
    );
}
