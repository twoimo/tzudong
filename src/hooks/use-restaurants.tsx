import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant, Region } from "@/types/restaurant";
import { Tables } from "@/integrations/supabase/types";

type DBRestaurant = Tables<"restaurants">;


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
                .eq("status", "approved") // status가 approved인 것만 조회
                .order("name"); // 이름순으로 정렬

            // Apply bounds filter if provided
            if (bounds) {
                query = query
                    .gte("lat", bounds.south)
                    .lte("lat", bounds.north)
                    .gte("lng", bounds.west)
                    .lte("lng", bounds.east);
            }

            // Apply category filter (categories는 배열 타입)
            if (category && category.length > 0) {
                // categories는 TEXT[] 타입으로 저장됨
                query = query.overlaps("categories", category);
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

            // 상호명이 같은 맛집들을 통합
            const restaurantMap = new Map<string, DBRestaurant>();

            (data || []).forEach((restaurant: DBRestaurant) => {
                const key = `${restaurant.name}_${restaurant.jibun_address || restaurant.road_address}`;

                if (restaurantMap.has(key)) {
                    // 이미 있는 맛집이면 youtube_links와 tzuyang_reviews를 병합
                    const existing = restaurantMap.get(key)!;

                    // youtube_links 병합 (중복 제거)
                    const mergedYoutubeLinks = [
                        ...(existing.youtube_links || []),
                        ...(restaurant.youtube_links || [])
                    ].filter((link, index, self) => self.indexOf(link) === index);

                    // tzuyang_reviews 병합
                    const mergedTzuyangReviews = [
                        ...(Array.isArray(existing.tzuyang_reviews) ? existing.tzuyang_reviews : []),
                        ...(Array.isArray(restaurant.tzuyang_reviews) ? restaurant.tzuyang_reviews : [])
                    ];

                    // youtube_metas 병합
                    const mergedYoutubeMetas = [
                        ...(Array.isArray(existing.youtube_metas) ? existing.youtube_metas : []),
                        ...(Array.isArray(restaurant.youtube_metas) ? restaurant.youtube_metas : [])
                    ];

                    // 병합된 데이터로 업데이트
                    restaurantMap.set(key, {
                        ...existing,
                        youtube_links: mergedYoutubeLinks,
                        tzuyang_reviews: mergedTzuyangReviews,
                        youtube_metas: mergedYoutubeMetas,
                        review_count: (existing.review_count || 0) + (restaurant.review_count || 0),
                    });
                } else {
                    restaurantMap.set(key, restaurant);
                }
            });

            // Map을 배열로 변환하고 호환성 속성 추가
            const restaurants = Array.from(restaurantMap.values()).map((restaurant: DBRestaurant) => ({
                ...restaurant,
                // 호환성 속성 추가
                address: restaurant.road_address || restaurant.jibun_address || '',
                category: restaurant.categories,
                youtube_link: Array.isArray(restaurant.youtube_links) && restaurant.youtube_links.length > 0
                    ? restaurant.youtube_links[0]
                    : null,
                tzuyang_review: Array.isArray(restaurant.tzuyang_reviews) && restaurant.tzuyang_reviews.length > 0 && restaurant.tzuyang_reviews[0]
                    ? (restaurant.tzuyang_reviews[0] as any).review
                    : null,
            }));

            return restaurants as Restaurant[];
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

            if (!data) return null;

            // 호환성을 위한 데이터 변환
            const dbData = data as DBRestaurant;
            const restaurant: Restaurant = {
                ...dbData,
                address: dbData.road_address || dbData.jibun_address || '',
                category: dbData.categories,
                youtube_link: Array.isArray(dbData.youtube_links) && dbData.youtube_links.length > 0
                    ? dbData.youtube_links[0]
                    : null,
                tzuyang_review: Array.isArray(dbData.tzuyang_reviews) && dbData.tzuyang_reviews.length > 0 && dbData.tzuyang_reviews[0]
                    ? (dbData.tzuyang_reviews[0] as any).review
                    : null,
            };

            return restaurant;
        },
        enabled: !!id,
    });
}

