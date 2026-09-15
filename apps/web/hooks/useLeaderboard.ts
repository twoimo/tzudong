import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readCompletePublicProfileLeaderboard } from "@/lib/public-profile-read";

import { readLeaderboardUsers } from "./leaderboard-read-result";
export type { LeaderboardUser } from "./leaderboard-read-result";

export const useLeaderboard = (period: 'all' | 'monthly' = 'all') => {
    const queryClient = useQueryClient();
    const channelNameRef = useRef(`leaderboard-realtime-${Math.random().toString(36).slice(2)}`);

    // 실시간 구독 설정
    useEffect(() => {
        const channel = supabase
            .channel(channelNameRef.current)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'reviews' },
                () => {
                    queryClient.invalidateQueries({ queryKey: ['leaderboard-users'] });
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'review_likes' },
                () => {
                    queryClient.invalidateQueries({ queryKey: ['leaderboard-users'] });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [queryClient]);

    return useQuery({
        queryKey: ['leaderboard-users', period],
        queryFn: () => readLeaderboardUsers(() => readCompletePublicProfileLeaderboard(supabase, period)),
        staleTime: 0, // 실시간 업데이트를 위해 0으로 설정
        placeholderData: () => undefined,
    });
};
