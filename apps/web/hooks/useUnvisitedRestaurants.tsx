import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mergeRestaurants, RESTAURANT_MERGE_SELECT } from "@/hooks/use-restaurants";
import { Tables } from "@/integrations/supabase/types";
import { hasRelatedVerifiedUserReview } from "@/lib/restaurant-visit-matching";
import type { Restaurant } from "@/types/restaurant";

type ReviewedRestaurant = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address'
>;

interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
    restaurant?: ReviewedRestaurant | null;
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
                .eq('is_verified', true)
                .overrideTypes<UserReview[], { merge: false }>();

            if (error) throw error;

            const reviews = data ?? [];
            const restaurantIds = [...new Set(reviews.map((review) => review.restaurant_id).filter(Boolean))];
            if (restaurantIds.length === 0) return reviews;

            const { data: restaurants, error: restaurantsError } = await supabase
                .from('restaurants')
                .select('id, name:approved_name, approved_name, road_address, jibun_address, status')
                .in('id', restaurantIds)
                .overrideTypes<ReviewedRestaurant[], { merge: false }>();

            if (restaurantsError) throw restaurantsError;

            const restaurantMap = new Map<string, ReviewedRestaurant>();
            for (const restaurant of restaurants ?? []) {
                restaurantMap.set(restaurant.id, restaurant);
            }

            return reviews.map((review) => ({
                ...review,
                restaurant: restaurantMap.get(review.restaurant_id) ?? null,
            }));
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
                .select(RESTAURANT_MERGE_SELECT)
                .eq('status', 'approved')
                .not('youtube_link', 'is', null)
                .order('created_at', { ascending: false })
                .overrideTypes<Tables<"restaurants">[], { merge: false }>();

            if (error) throw error;
            return data ?? [];
        },
        staleTime: 5 * 60 * 1000, // 5분 동안 캐시 유지
    });

    // 데이터 병합 로직 (공통 유틸리티 사용) - 입력이 그대로면 다시 병합하지 않는다.
    const mergedRestaurants = useMemo(
        () => mergeRestaurants(restaurantsData || []),
        [restaurantsData]
    );

    // 리뷰 기반 방문 판정은 입력(병합 목록, 사용자 리뷰)이 바뀔 때만 다시 계산한다.
    const { unvisitedRestaurants, visitedCount } = useMemo(() => {
        const visitedRestaurantIds = new Set(
            userReviewData.map(review => review.restaurant_id)
        );
        const reviewedRestaurantCandidates = userReviewData
            .map((review) => review.restaurant)
            .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));

        // 방문 여부를 한 번만 계산해 미방문 목록과 방문 수를 함께 만든다(같은 목록을 두 번 순회하지 않는다).
        const unvisited: Restaurant[] = [];
        let visited = 0;
        for (const restaurant of mergedRestaurants) {
            if (hasRelatedVerifiedUserReview({
                restaurant,
                reviewedRestaurantIds: visitedRestaurantIds,
                reviewedRestaurants: reviewedRestaurantCandidates,
            })) {
                visited += 1;
            } else {
                unvisited.push(restaurant);
            }
        }

        return { unvisitedRestaurants: unvisited, visitedCount: visited };
    }, [mergedRestaurants, userReviewData]);

    return {
        unvisitedRestaurants,
        visitedCount,
        totalCount: restaurantsData?.length || 0,
        isLoading,
        isLoggedIn: !!user,
    };
}
