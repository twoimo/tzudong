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
    minReviews?: number;
    enabled?: boolean;
}

export function useRestaurants(options: UseRestaurantsOptions = {}) {
    const { bounds, category, region, minReviews, enabled = true } = options;

    return useQuery({
        queryKey: ["restaurants", bounds, category, region, minReviews],
        staleTime: 5 * 60 * 1000, // 5분 동안 fresh 상태 유지
        gcTime: 10 * 60 * 1000, // 10분 동안 캐시 유지
        queryFn: async () => {
            let query = supabase
                .from("restaurants")
                .select("*")
                .order("name"); // 이름순으로 정렬

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
                // 실제 데이터베이스에서 category는 TEXT[] 타입으로 저장됨
                query = query.overlaps("category", category);
            }

            // Apply region filter
            if (region) {
                if (region === "울릉도") {
                    // 울릉도는 주소에 '울릉'이 포함된 데이터 필터링
                    query = query.or(`road_address.ilike.%울릉%,jibun_address.ilike.%울릉%`);
                } else if (region === "욕지도") {
                    // 욕지도는 주소에 '욕지'가 포함된 데이터 필터링
                    query = query.or(`road_address.ilike.%욕지%,jibun_address.ilike.%욕지%`);
                } else {
                    // address_elements의 SIDO에서 지역 필터링
                    // 도로명 주소나 지번 주소에 지역명이 포함되어 있는지 확인
                    query = query.or(`road_address.ilike.%${region}%,jibun_address.ilike.%${region}%`);
                }
            }

            // Apply review count filter
            if (minReviews && minReviews > 0) {
                query = query.gte("review_count", minReviews);
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

