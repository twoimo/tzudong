'use client';

import React from 'react';
import Link from 'next/link';
import { Stamp, Trophy, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getRankIconElement, getUserTier, LeaderboardUser } from './leaderboard-utils';

interface LeaderboardListProps {
    users: LeaderboardUser[];
    currentUserId?: string;
    onOpenUserProfile?: (userId: string) => void;
    userItemRef?: React.RefObject<HTMLDivElement | null>;
}

export function LeaderboardList({
    users,
    currentUserId,
    onOpenUserProfile,
    userItemRef
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
                                className={cn(
                                "flex items-center gap-2.5 sm:gap-4 md:gap-5 px-4 sm:px-6 md:px-6 py-4 sm:py-4.5 lg:gap-4 lg:px-6 lg:py-3 transition-colors hover:bg-muted/50 min-w-0",
                                isCurrentUser && "bg-primary/5 border-l-4 border-l-primary"
                            )}
                        >
                        {/* Rank */}
                        <div className="flex-shrink-0 w-10 sm:w-10 flex items-center justify-center">
                            {getRankIconElement(user.rank)}
                        </div>

                        {/* Username */}
                        <div className="flex-1 min-w-0 max-w-[42vw] sm:max-w-xs">
                            {onOpenUserProfile ? (
                                <div
                                    onClick={() => onOpenUserProfile(user.id)}
                                    className={cn(
                                        "font-semibold text-base sm:text-lg truncate block hover:underline cursor-pointer lg:text-base",
                                        isCurrentUser ? "text-primary" : "hover:text-primary"
                                    )}
                                >
                                    {user.username}
                                    {isCurrentUser && " (나)"}
                                </div>
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
                        <div className="flex items-center gap-2 sm:gap-3 md:gap-4 ml-auto min-w-0">
                            <div className="flex items-center gap-1 shrink-0">
                                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 lg:h-3.5 lg:w-3.5 text-amber-500 fill-amber-100" />
                                <span className="font-bold text-base sm:text-lg lg:text-sm text-amber-600">
                                    {user.qualityScore ?? 0}
                                </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <Stamp className="h-4 w-4 sm:h-5 sm:w-5 lg:h-3.5 lg:w-3.5 text-muted-foreground" />
                                <span className="font-bold text-base sm:text-lg lg:text-sm">
                                    {user.verifiedReviewCount}
                                </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <span className="text-base lg:text-xs">❤️</span>
                                <span className="font-bold text-base sm:text-lg lg:text-sm text-red-600">
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
