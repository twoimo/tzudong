import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";


interface UseRestaurantsOptions {
    bounds?: {
        south: number;
        west: number;
        north: number;
        east: number;
    };
    category?: string[];
    minRating?: number;
    minReviews?: number;
    minUserVisits?: number;
    minJjyangVisits?: number;
    enabled?: boolean;
}

export function useRestaurants(options: UseRestaurantsOptions = {}) {
    const { bounds, category, minRating, minReviews, minUserVisits, minJjyangVisits, enabled = true } = options;

    return useQuery({
        queryKey: ["restaurants", bounds, category, minRating, minReviews, minUserVisits, minJjyangVisits],
        // 새로고침 시 더 안정적인 로딩을 위해 staleTime 증가
        staleTime: 20 * 60 * 1000, // 20분
        gcTime: 60 * 60 * 1000, // 60분
        retry: (failureCount, error: any) => {
            // 새로고침 시 네트워크 에러에 더 관대하게
            if (error?.status === 401 || error?.code === 'PGRST301') {
                return failureCount < 1; // 401 에러는 1회만 재시도
            }
            return failureCount < 2; // 다른 에러는 2회 재시도
        },
        queryFn: async () => {
            try {
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
                    query = query.in("category", category);
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

                // 에러가 발생하면 빈 배열 반환
                if (error) {
                    console.warn('레스토랑 데이터 조회 실패:', error.message);
                    return [];
                }

                return (data || []) as Restaurant[];
            } catch (error) {
                console.warn('레스토랑 데이터 조회 중 오류 발생:', error);
                return [];
            }
        },
        enabled,
        staleTime: 5 * 60 * 1000, // 5 minutes - 데이터를 신선하게 유지
        gcTime: 10 * 60 * 1000, // 10 minutes - 캐시 유지
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

