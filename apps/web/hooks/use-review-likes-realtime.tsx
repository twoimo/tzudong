'use client';

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * 리뷰 좋아요 실시간 반영 훅
 * Supabase Realtime으로 review_likes 테이블 변경 감지하여 쿼리 캐시 무효화
 */
export function useReviewLikesRealtime() {
    const queryClient = useQueryClient();

    const invalidateLikesQueries = useCallback(() => {
        // 리뷰 관련 모든 쿼리 무효화
        queryClient.invalidateQueries({ queryKey: ['review-feed'] });
        queryClient.invalidateQueries({ queryKey: ['restaurant-reviews'] });
        queryClient.invalidateQueries({ queryKey: ['user-reviews'] });
        queryClient.invalidateQueries({ queryKey: ['user-stats'] });
    }, [queryClient]);

    useEffect(() => {
        // Supabase Realtime 채널 구독
        const channel = supabase
            .channel('review-likes-realtime')
            .on(
                'postgres_changes',
                {
                    event: '*', // INSERT, UPDATE, DELETE 모두 감지
                    schema: 'public',
                    table: 'review_likes',
                },
                (payload) => {
                    // 좋아요 변경 시 관련 쿼리 무효화
                    console.log('[Realtime] review_likes 변경 감지:', payload.eventType);
                    invalidateLikesQueries();
                }
            )
            .subscribe();

        // Cleanup
        return () => {
            supabase.removeChannel(channel);
        };
    }, [invalidateLikesQueries]);
}
