import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const RankingWidget = () => {
    const { user } = useAuth();
    const [onlineUsers, setOnlineUsers] = useState(0);

    // Fetch user ranking
    const { data: myRank } = useQuery({
        queryKey: ['my-ranking', user?.id],
        queryFn: async () => {
            if (!user?.id) return null;

            // 1. Get all profiles to calculate rank (simplified for widget)
            // Note: In a real app with many users, this should be a database function or materialized view
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id')
                .not('nickname', 'is', null)
                .neq('nickname', '탈퇴한 사용자');

            if (!profilesData) return null;

            const userIds = profilesData.map(p => p.user_id);

            // 2. Get review counts
            const { data: reviewsData } = await supabase
                .from('reviews')
                .select('user_id')
                .in('user_id', userIds);

            if (!reviewsData) return null;

            const reviewCountMap = new Map<string, number>();
            reviewsData.forEach(r => {
                reviewCountMap.set(r.user_id, (reviewCountMap.get(r.user_id) || 0) + 1);
            });

            // 3. Sort and find rank
            const sortedUsers = userIds
                .map(id => ({ id, count: reviewCountMap.get(id) || 0 }))
                .sort((a, b) => b.count - a.count);

            const rank = sortedUsers.findIndex(u => u.id === user.id) + 1;
            return rank > 0 ? rank : null;
        },
        enabled: !!user,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

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
                            <div className="flex items-center gap-1.5 text-sm font-medium bg-primary/10 text-primary px-2 py-1 rounded-md border border-primary/20">
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
