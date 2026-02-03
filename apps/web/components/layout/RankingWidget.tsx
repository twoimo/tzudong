import { useEffect, useState, memo, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { useHydration } from "@/hooks/useHydration";

const RankingWidgetComponent = () => {
    const { user } = useAuth();
    const [onlineUsers, setOnlineUsers] = useState(0);
    const isHydrated = useHydration();

    // Fetch user ranking using shared hook
    const { data: leaderboardData = [] } = useLeaderboard();

    // Find my rank (메모이제이션)
    const myRank = useMemo(() => {
        if (!user) return null;
        return leaderboardData.find((u: any) => u.id === user.id)?.rank ?? null;
    }, [user, leaderboardData]);

    // Real-time online users
    useEffect(() => {
        const channel = supabase.channel('online-users')
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                // 고유 user_id만 카운트 (동일 유저의 여러 탭/브라우저를 1명으로 계산)
                const uniqueUserIds = new Set<string>();
                Object.entries(state).forEach(([presenceKey, presences]) => {
                    (presences as any[]).forEach((presence: any) => {
                        // 로그인 사용자는 user_id로, 비로그인은 presence_ref로 식별
                        uniqueUserIds.add(presence.user_id || presence.presence_ref || presenceKey);
                    });
                });
                setOnlineUsers(uniqueUserIds.size);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: user?.id,
                        online_at: new Date().toISOString(),
                    });
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    // Get rank color (메모이제이션)
    const rankColorClass = useMemo(() => {
        if (!myRank) return "";
        if (myRank === 1) return "text-yellow-500 border-yellow-500/20 bg-yellow-500/10";
        if (myRank === 2) return "text-muted-foreground border-muted-foreground/20 bg-muted";
        if (myRank === 3) return "text-amber-600 border-amber-600/20 bg-amber-600/10";
        return "text-primary border-primary/20 bg-primary/10";
    }, [myRank]);

    return (
        <div className={cn(
            "flex items-center gap-3 mr-2 transition-opacity duration-300",
            isHydrated ? "opacity-100" : "opacity-0"
        )}>
            {/* Online Users */}
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                            <Users className="h-4 w-4" />
                            <span className="font-medium">{onlineUsers}명</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>현재 접속 중인 사용자</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {/* User Rank */}
            {user && myRank && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className={`flex items-center gap-1.5 text-sm font-medium px-2 py-1 rounded-md border ${rankColorClass}`}>
                                <Trophy className="h-4 w-4" />
                                <span>{myRank}위</span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>나의 실시간 랭킹</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
};

// React.memo로 래핑
export const RankingWidget = memo(RankingWidgetComponent);
RankingWidget.displayName = "RankingWidget";

