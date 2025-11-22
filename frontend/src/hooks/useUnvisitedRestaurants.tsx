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
    tzuyang_review?: string;
    created_at: string;
    mergedYoutubeLinks?: string[];
    mergedTzuyangReviews?: string[];
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
                .select('id, name, youtube_link, review_count, categories, road_address, jibun_address, lat, lng, tzuyang_review, created_at')
                .eq('status', 'approved')
                .not('youtube_link', 'is', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data as Restaurant[];
        },
        staleTime: 5 * 60 * 1000, // 5분 동안 캐시 유지
    });

    // 방문한 맛집 ID Set 생성
    const visitedRestaurantIds = new Set(
        userReviewData.map(review => review.restaurant_id)
    );

    // 데이터 병합 로직
    const mergedRestaurants = (restaurantsData || []).reduce((acc: Restaurant[], curr) => {
        const existingIndex = acc.findIndex(r =>
            r.name === curr.name &&
            (r.jibun_address === curr.jibun_address || r.road_address === curr.road_address)
        );

        if (existingIndex >= 0) {
            const existing = acc[existingIndex];

            // 유튜브 링크 병합
            const existingLinks = existing.mergedYoutubeLinks || (existing.youtube_link ? [existing.youtube_link] : []);
            const newLinks = curr.youtube_link ? [curr.youtube_link] : [];
            const mergedLinks = Array.from(new Set([...existingLinks, ...newLinks]));

            // 쯔양 리뷰 병합
            const existingReviews = existing.mergedTzuyangReviews || (existing.tzuyang_review ? [existing.tzuyang_review] : []);
            const newReviews = curr.tzuyang_review ? [curr.tzuyang_review] : [];
            const mergedReviews = Array.from(new Set([...existingReviews, ...newReviews]));

            acc[existingIndex] = {
                ...existing,
                mergedYoutubeLinks: mergedLinks,
                mergedTzuyangReviews: mergedReviews
            };
        } else {
            acc.push({
                ...curr,
                mergedYoutubeLinks: curr.youtube_link ? [curr.youtube_link] : [],
                mergedTzuyangReviews: curr.tzuyang_review ? [curr.tzuyang_review] : []
            });
        }
        return acc;
    }, []);

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
