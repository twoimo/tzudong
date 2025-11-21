import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Restaurant {
    id: string;
    name: string;
    youtube_link: string | null;
    review_count: number;
    categories: string[];
    road_address: string | null;
    jibun_address: string | null;
    lat?: number;
    lng?: number;
}

interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
}

/**
 * 사용자가 방문하지 않은 음식점 목록을 가져오는 커스텀 훅
 * StampPage와 동일한 로직을 사용하여 미방문 음식점을 필터링합니다.
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
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name, youtube_link, review_count, categories, road_address, jibun_address, lat, lng')
                .eq('status', 'approved')
                .not('youtube_link', 'is', null)
                .order('created_at', { ascending: true });

            if (error) throw error;
            return data as Restaurant[];
        },
        staleTime: 5 * 60 * 1000, // 5분 동안 캐시 유지
    });

    // 방문한 맛집 ID Set 생성
    const visitedRestaurantIds = new Set(
        userReviewData.map(review => review.restaurant_id)
    );

    // 방문하지 않은 맛집만 필터링
    const unvisitedRestaurants = (restaurantsData || []).filter(
        restaurant => !visitedRestaurantIds.has(restaurant.id)
    );

    return {
        unvisitedRestaurants,
        visitedCount: visitedRestaurantIds.size,
        totalCount: restaurantsData?.length || 0,
        isLoading,
        isLoggedIn: !!user,
    };
}
