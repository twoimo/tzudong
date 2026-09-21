import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readCompletePublicProfileLeaderboard } from "@/lib/public-profile-read";

export interface LeaderboardUser {
    id: string;
    rank: number;
    username: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number;
    avgLikesPerReview: number;
    qualityScore: number;
}

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
        queryFn: async () => {
            const rows = await readCompletePublicProfileLeaderboard(supabase, period);
            return rows.map((row, index): LeaderboardUser => ({
                id: row.user_id,
                rank: index + 1,
                username: row.nickname,
                reviewCount: row.review_count,
                verifiedReviewCount: row.verified_review_count,
                totalLikes: row.total_likes,
                avgLikesPerReview: row.avg_likes_per_review,
                qualityScore: row.quality_score,
            }));
        },
        staleTime: 0, // 실시간 업데이트를 위해 0으로 설정
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        placeholderData: keepPreviousData,
    });
};
