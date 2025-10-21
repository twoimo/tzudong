import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";

// 더미 데이터 - 실제 데이터가 없을 때 표시
const DUMMY_RESTAURANTS: Restaurant[] = [
    {
        id: "dummy-1",
        name: "홍대 떡볶이 (샘플)",
        address: "서울특별시 마포구 홍익로 123",
        phone: "02-1234-5678",
        category: "분식",
        youtube_link: "https://youtube.com/watch?v=sample1",
        tzuyang_review: "정말 맛있었어요! 떡볶이가 쫄깃하고 양념이 딱 좋아요 👍",
        description: "쯔양이 두 번이나 방문한 떡볶이 맛집. 매콤달콤한 떡볶이가 일품!",
        lat: 37.5563,
        lng: 126.9236,
        ai_rating: 9.2,
        jjyang_visit_count: 2,
        visit_count: 156,
        review_count: 45,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_admin_id: null,
    },
    {
        id: "dummy-2",
        name: "강남 삼겹살 (샘플)",
        address: "서울특별시 강남구 테헤란로 456",
        phone: "02-2345-6789",
        category: "고기",
        youtube_link: "https://youtube.com/watch?v=sample2",
        tzuyang_review: "양이 많고 고기 질이 정말 좋아요! 1인분이 일반 식당의 2인분이에요",
        description: "1인분 양이 푸짐한 삼겹살집. 육즙 가득한 두툼한 삼겹살이 특징",
        lat: 37.4979,
        lng: 127.0276,
        ai_rating: 8.8,
        jjyang_visit_count: 1,
        visit_count: 89,
        review_count: 32,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_admin_id: null,
    },
    {
        id: "dummy-3",
        name: "명동 칼국수 (샘플)",
        address: "서울특별시 중구 명동길 789",
        phone: "02-3456-7890",
        category: "한식",
        youtube_link: null,
        tzuyang_review: "국물이 진하고 면발이 쫄깃해요. 칼제비도 추천!",
        description: "40년 전통의 칼국수 전문점. 직접 뽑은 면이 일품",
        lat: 37.5636,
        lng: 126.9850,
        ai_rating: 8.5,
        jjyang_visit_count: 1,
        visit_count: 67,
        review_count: 28,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_admin_id: null,
    },
    {
        id: "dummy-4",
        name: "신촌 치킨 (샘플)",
        address: "서울특별시 서대문구 신촌역로 234",
        phone: "02-4567-8901",
        category: "치킨",
        youtube_link: "https://youtube.com/watch?v=sample4",
        tzuyang_review: "바삭바삭한 튀김옷이 최고! 양념도 맛있어요",
        description: "24시간 영업하는 치킨집. 야식으로 딱!",
        lat: 37.5559,
        lng: 126.9366,
        ai_rating: 7.9,
        jjyang_visit_count: 1,
        visit_count: 102,
        review_count: 38,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_admin_id: null,
    },
    {
        id: "dummy-5",
        name: "이태원 파스타 (샘플)",
        address: "서울특별시 용산구 이태원로 567",
        phone: "02-5678-9012",
        category: "양식",
        youtube_link: null,
        tzuyang_review: "로제 파스타가 진짜 맛있어요. 크림이 부드럽고 해산물도 신선해요",
        description: "이탈리안 셰프가 직접 만드는 정통 파스타",
        lat: 37.5345,
        lng: 126.9945,
        ai_rating: 8.3,
        jjyang_visit_count: 1,
        visit_count: 54,
        review_count: 22,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_admin_id: null,
    },
    {
        id: "dummy-6",
        name: "종로 찜닭 (샘플)",
        address: "서울특별시 종로구 종로 890",
        phone: "02-6789-0123",
        category: "찜·탕",
        youtube_link: "https://youtube.com/watch?v=sample6",
        tzuyang_review: "찜닭이 엄청 크고 맛있어요! 당면도 쫄깃하고 양념이 일품",
        description: "대왕 찜닭으로 유명한 맛집. 2인분이 3-4인분 양",
        lat: 37.5701,
        lng: 126.9910,
        ai_rating: 9.0,
        jjyang_visit_count: 3,
        visit_count: 134,
        review_count: 52,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_admin_id: null,
    },
];

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

                // 에러가 발생하거나 데이터가 없으면 더미 데이터 반환
                if (error) {
                    console.warn('레스토랑 데이터 조회 실패, 샘플 데이터 표시:', error.message);
                    return DUMMY_RESTAURANTS;
                }

                const restaurants = (data || []) as Restaurant[];
                if (restaurants.length === 0) {
                    return DUMMY_RESTAURANTS;
                }

                return restaurants;
            } catch (error) {
                console.warn('레스토랑 데이터 조회 중 오류 발생, 샘플 데이터 표시:', error);
                return DUMMY_RESTAURANTS;
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

