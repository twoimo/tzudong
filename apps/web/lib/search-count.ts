'use client';

import { supabase } from '@/integrations/supabase/client';

/**
 * 맛집 검색 카운트 증가
 * @param restaurantId - 검색한 레스토랑 ID
 */
export async function incrementSearchCount(restaurantId: string): Promise<void> {
    try {
        // search_count를 1 증가
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).rpc('increment_search_count', {
            restaurant_id: restaurantId
        });

        if (error) {
            console.error('검색 카운트 증가 실패:', error);
        }
    } catch (err) {
        console.error('검색 카운트 증가 중 오류:', err);
    }
}
