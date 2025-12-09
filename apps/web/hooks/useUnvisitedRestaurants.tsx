import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant } from "@/types/restaurant";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import { Tables } from "@/integrations/supabase/types";

interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
}

/**
 * 미방문 맛집 목록 조회 훅
 * StampPage와 동일한 로직을 사용하여 아직 방문하지 않은 맛집을 필터링합니다.
 */
export function useUnvisitedRestaurants() {
    const { user } = useAuth();

    // 사용자가 작성한 리뷰 조회 (로그인한 경우)
    const { data: userReviewData = [] } = useQuery({
        queryKey: ['user-reviews', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];

            const { data, error } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('user_id', user.id)
                .eq('is_verified', true);

            if (error) throw error;
            return data as UserReview[];
        },
        enabled: !!user?.id,
        staleTime: 5 * 60 * 1000, // 5분 동안 캐시 유지
    });

    // 쯔양이 방문한 모든 맛집 조회 (승인된 맛집만)
    const { data: restaurantsData, isLoading } = useQuery({
        queryKey: ['unvisited-restaurants-all'],
        queryFn: async () => {
            // 모든 필드를 가져와야 mergeRestaurants가 올바르게 작동하고
            // AdminRestaurantModal 등에서 필요한 데이터를 사용할 수 있음
            const { data, error } = await supabase
                .from('restaurants')
                .select('*')
                .eq('status', 'approved')
                .not('youtube_link', 'is', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data as Tables<"restaurants">[];
        },
        staleTime: 5 * 60 * 1000, // 5분 동안 캐시 유지
    });

    // 방문한 맛집 ID Set 생성
    const visitedRestaurantIds = new Set(
        userReviewData.map(review => review.restaurant_id)
    );

    // 데이터 병합 로직 (공통 유틸리티 사용)
    const mergedRestaurants = mergeRestaurants(restaurantsData || []);

    // 방문하지 않은 맛집만 필터링
    const unvisitedRestaurants = mergedRestaurants.filter(restaurant => {
        return !visitedRestaurantIds.has(restaurant.id);
    });

    return {
        unvisitedRestaurants,
        visitedCount: visitedRestaurantIds.size,
        totalCount: restaurantsData?.length || 0,
        isLoading,
        isLoggedIn: !!user,
    };
}
