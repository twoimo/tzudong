import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant, Region } from "@/types/restaurant";


interface UseRestaurantsOptions {
    bounds?: {
        south: number;
        west: number;
        north: number;
        east: number;
    };
    category?: string[];
    region?: Region;
    minRating?: number;
    minReviews?: number;
    minUserVisits?: number;
    minJjyangVisits?: number;
    enabled?: boolean;
}

export function useRestaurants(options: UseRestaurantsOptions = {}) {
    const { bounds, category, region, minRating, minReviews, minUserVisits, minJjyangVisits, enabled = true } = options;

    return useQuery({
        queryKey: ["restaurants", bounds, category, region, minRating, minReviews, minUserVisits, minJjyangVisits],
        staleTime: 5 * 60 * 1000, // 5분 동안 fresh 상태 유지
        gcTime: 10 * 60 * 1000, // 10분 동안 캐시 유지
        queryFn: async () => {
            let query = supabase
                .from("restaurants")
                .select("*")
                .order("ai_rating", { ascending: false });

            // Apply bounds filter if provided
            if (bounds) {
                query = query
                    .gte("lat", bounds.south)
                    .lte("lat", bounds.north)
                    .gte("lng", bounds.west)
                    .lte("lng", bounds.east);
            }

            // Apply category filter
            if (category && category.length > 0) {
                // restaurants 테이블의 category 필드는 restaurant_category 타입이므로
                // 일단 첫 번째 카테고리만 사용하여 필터링
                query = query.eq("category", category[0]);
            }

            // Apply region filter
            if (region) {
                if (region === "울릉도") {
                    // 울릉도는 주소에 '울릉'이 포함된 데이터 필터링
                    query = query.ilike("address", "%울릉%");
                } else if (region === "욕지도") {
                    // 욕지도는 주소에 '욕지'가 포함된 데이터 필터링
                    query = query.ilike("address", "%욕지%");
                } else {
                    // 일반 지역은 region 필드로 필터링
                    query = query.eq("region", region);
                }
            }

            // Apply rating filter
            if (minRating && minRating > 1) {
                query = query.gte("ai_rating", minRating);
            }

            // Apply review count filter
            if (minReviews && minReviews > 0) {
                query = query.gte("review_count", minReviews);
            }

            // Apply user visit count filter
            if (minUserVisits && minUserVisits > 0) {
                query = query.gte("visit_count", minUserVisits);
            }

            // Apply jjyang visit count filter
            if (minJjyangVisits && minJjyangVisits > 0) {
                query = query.gte("jjyang_visit_count", minJjyangVisits);
            }

            const { data, error } = await query;

            if (error) {
                console.error('레스토랑 데이터 조회 실패:', error.message);
                throw error;
            }

            return (data || []) as Restaurant[];
        },
        enabled,
        refetchOnWindowFocus: false, // 윈도우 포커스 시 재요청 안 함
        refetchOnReconnect: false, // 재연결 시 재요청 안 함
    });
}

export function useRestaurant(id: string | null) {
    return useQuery({
        queryKey: ["restaurant", id],
        queryFn: async () => {
            if (!id) return null;

            const { data, error } = await supabase
                .from("restaurants")
                .select("*")
                .eq("id", id)
                .single();

            if (error) throw error;
            return data as Restaurant;
        },
        enabled: !!id,
    });
}

