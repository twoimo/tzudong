'use client';

import { useState, useEffect, useRef } from "react";
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
import { Trophy, Medal, Award, TrendingUp, ChevronRight, ChevronLeft, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { Button } from "@/components/ui/button";

interface LeaderboardPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
}

export default function LeaderboardPanel({ isOpen, onClose, onToggleCollapse, isCollapsed }: LeaderboardPanelProps) {
    const { user: currentUser } = useAuth();
    const [sortBy, setSortBy] = useState<"reviews">("reviews");
    const userRowRef = useRef<HTMLTableRowElement>(null);

    // Fetch leaderboard data using custom hook
    const { data: leaderboardData = [], isLoading } = useLeaderboard();

    // Apply sorting
    const sortedLeaderboard = [...leaderboardData].sort((a, b) => {
        if (sortBy === "reviews") {
            return b.verifiedReviewCount - a.verifiedReviewCount;
        }
        return 0;
    });

    const getRankIcon = (rank: number) => {
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
        if (!isLoading && currentUser && userRowRef.current && isOpen) {
            setTimeout(() => {
                userRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 500);
        }
    }, [isLoading, currentUser, sortedLeaderboard, isOpen]);

    return (
        <TooltipProvider>
            <div className="flex flex-col h-full bg-background border-l border-border relative">
                {/* 플로팅 접기/펼치기 버튼 */}
                {onToggleCollapse && (
                    <button
                        onClick={onToggleCollapse}
                        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                        title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                        aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    >
                        {!isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                        ) : (
                            <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                        )}
                    </button>
                )}

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-primary" />
                            쯔동여지도 랭킹
                        </h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            리뷰를 작성하고 랭킹을 올려보세요!
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="hover:bg-muted"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* My Rank Summary */}
                {currentUser && (
                    <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">나의 순위</span>
                        <span className="text-xl font-bold text-primary">{myRank ? `${myRank}위` : "-"}</span>
                    </div>
                )}

                {/* Rankings Table */}
                <div className="flex-1 overflow-hidden p-0">
                    <ScrollArea className="h-full">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                <TableRow>
                                    <TableHead className="w-14 text-center whitespace-nowrap px-2">순위</TableHead>
                                    <TableHead className="text-left whitespace-nowrap px-2">사용자</TableHead>
                                    <TableHead className="w-16 text-center whitespace-nowrap px-2">
                                        기록
                                    </TableHead>
                                    <TableHead className="w-16 text-center whitespace-nowrap px-2">티어</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array.from({ length: 10 }).map((_, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="px-2"><div className="w-8 h-8 bg-muted rounded animate-pulse mx-auto"></div></TableCell>
                                            <TableCell className="px-2"><div className="h-4 bg-muted rounded animate-pulse w-20"></div></TableCell>
                                            <TableCell className="px-2"><div className="h-4 bg-muted rounded animate-pulse w-8 mx-auto"></div></TableCell>
                                            <TableCell className="px-2"><div className="h-4 bg-muted rounded animate-pulse w-10 mx-auto"></div></TableCell>
                                        </TableRow>
                                    ))
                                ) : sortedLeaderboard.map((user, index) => {
                                    const isCurrentUser = currentUser?.id === user.id;
                                    const tier = getUserTier(user.verifiedReviewCount);
                                    return (
                                        <TableRow
                                            key={`${user.id}-${index}`}
                                            ref={isCurrentUser ? userRowRef : null}
                                            className={`hover:bg-muted/50 ${isCurrentUser ? "bg-primary/5 hover:bg-primary/10" : ""}`}
                                        >
                                            <TableCell className="text-center whitespace-nowrap px-2 py-3">
                                                <div className="flex items-center justify-center">
                                                    {getRankIcon(user.rank)}
                                                </div>
                                            </TableCell>
                                            <TableCell className="max-w-[120px] px-2 py-3">
                                                <div className="flex flex-col">
                                                    <span className={`font-medium truncate text-sm ${isCurrentUser ? "text-primary font-bold" : ""}`}>
                                                        {user.username}
                                                        {isCurrentUser && " (나)"}
                                                    </span>
                                                    <div className="flex items-center text-[10px] text-muted-foreground mt-0.5">
                                                        <span className="text-red-500 mr-0.5">❤️</span> {user.totalLikes}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center whitespace-nowrap px-2 py-3">
                                                <span className="font-semibold text-sm">{user.verifiedReviewCount}</span>
                                            </TableCell>
                                            <TableCell className="text-center whitespace-nowrap px-2 py-3">
                                                <Badge variant="outline" className={`${tier.bgColor} ${tier.color} border-current text-[10px] px-1.5 py-0`}>
                                                    {tier.name.split(' ')[1]}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}

                                {!isLoading && sortedLeaderboard.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-12">
                                            <div className="text-muted-foreground">
                                                <Trophy className="h-10 w-10 mx-auto mb-3 opacity-50" />
                                                <p className="text-sm">랭킹 데이터가 없습니다</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>
            </div>
        </TooltipProvider>
    );
}
