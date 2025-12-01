import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeaderboard } from "@/hooks/useLeaderboard";

export const RankingWidget = () => {
    const { user } = useAuth();
    const [onlineUsers, setOnlineUsers] = useState(0);

    // Fetch user ranking using shared hook
    const { data: leaderboardData = [] } = useLeaderboard();

    // Find my rank
    const myRank = user
        ? leaderboardData.find((u: any) => u.id === user.id)?.rank
        : null;

    // Real-time online users
    useEffect(() => {
        const channel = supabase.channel('online-users')
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                setOnlineUsers(Object.keys(state).length);
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

    // Get rank color
    const getRankColor = (rank: number) => {
        if (rank === 1) return "text-yellow-500 border-yellow-500/20 bg-yellow-500/10";
        if (rank === 2) return "text-gray-400 border-gray-400/20 bg-gray-400/10";
        if (rank === 3) return "text-amber-600 border-amber-600/20 bg-amber-600/10";
        return "text-primary border-primary/20 bg-primary/10";
    };

    return (
        <div className="flex items-center gap-3 mr-2">
            {/* Online Users */}
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                            <Users className="h-4 w-4" />
                            <span className="font-medium">{onlineUsers}명</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>현재 접속 중인 사용자</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {/* User Rank */}
            {user && myRank && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className={`flex items-center gap-1.5 text-sm font-medium px-2 py-1 rounded-md border ${getRankColor(myRank)}`}>
                                <Trophy className="h-4 w-4" />
                                <span>{myRank}위</span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>나의 실시간 랭킹</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
};
