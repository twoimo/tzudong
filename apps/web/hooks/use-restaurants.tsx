import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant, Region, YoutubeMeta } from "@/types/restaurant";
import { Tables } from "@/integrations/supabase/types";
import { OVERSEAS_REGIONS } from "@/constants/overseas-regions";

type DBRestaurant = Tables<"restaurants">;

/**
 * 레벤슈타인 거리 계산 (문자열 유사도 측정용)
 * 두 문자열 사이의 편집 거리를 계산합니다.
 * 
 * @param str1 기준 문자열
 * @param str2 비교 대상 문자열
 * @returns 편집 거리 (숫자)
 */
function levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,    // 삭제
                    dp[i][j - 1] + 1,    // 삽입
                    dp[i - 1][j - 1] + 1 // 치환
                );
            }
        }
    }

    return dp[len1][len2];
}

/**
 * 문자열 유사도 계산 함수
 * 0-1 사이의 값으로 반환하며, 1에 가까울수록 두 문자열이 유사합니다.
 * 
 * @param str1 기준 문자열
 * @param str2 비교 대상 문자열
 * @returns 유사도 (0.0 ~ 1.0)
 */
function calculateSimilarity(str1: string, str2: string): number {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1.0;
    const distance = levenshteinDistance(str1, str2);
    return 1 - distance / maxLen;
}

/**
 * 주소 정규화 함수
 * 층/호수 정보를 제거하고, 공백과 특수문자를 제거하여 비교 용이성을 높입니다.
 * 
 * @param address 원본 주소 문자열
 * @returns 정규화된 주소 문자열
 */
function normalizeAddress(address: string): string {
    return address
        // 층/호수 정보 제거 (같은 건물 다른 층은 같은 주소로 취급)
        .replace(/지하\s*\d+\s*층/g, '')
        .replace(/지상\s*\d+\s*층/g, '')
        .replace(/\d+\s*층/g, '')
        .replace(/\d+\s*호/g, '')
        // 공백 및 특수문자 제거
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '')
        .toLowerCase();
}

import { perfMonitor } from "@/lib/performance-monitor";

type RestaurantWithOptionalName = DBRestaurant & {
    name?: string | null;
    approved_name?: string | null;
};

type ReviewCountRow = {
    restaurant_id: string | null;
};

function getRestaurantName(restaurant: RestaurantWithOptionalName): string {
    return restaurant.name || restaurant.approved_name || '';
}

/**
 * 레스토랑 데이터 병합 함수
 * 이름과 주소가 유사한 중복 데이터들을 하나로 병합합니다.
 * 
 * [OPTIMIZATION] O(N) 수준의 grouping 및 Union-Find를 이용한 최적화
 * 기존 O(N^2) 루프를 제거하여 대량의 데이터 처리 시 성능 대폭 개선
 * 
 * @param restaurants DB에서 조회된 레스토랑 목록
 * @returns 병합된 레스토랑 목록
 */
export function mergeRestaurants(restaurants: DBRestaurant[]): Restaurant[] {
    if (!restaurants.length) return [];

    perfMonitor.startMeasure('mergeRestaurants');

    const n = restaurants.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
        if (parent[i] === i) return i;
        parent[i] = find(parent[i]);
        return parent[i];
    };
    const union = (i: number, j: number) => {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) parent[rootI] = rootJ;
    };

    const nameToIndices = new Map<string, number[]>();
    const addressToIndices = new Map<string, number[]>();

    // 1. 데이터 정규화 및 인덱싱 (O(N))
    const normalizedData = restaurants.map((r, i) => {
        const name = getRestaurantName(r as RestaurantWithOptionalName);
        const addr = normalizeAddress(r.jibun_address || r.road_address || '');

        if (name) {
            if (!nameToIndices.has(name)) nameToIndices.set(name, []);
            nameToIndices.get(name)!.push(i);
        }

        if (addr) {
            if (!addressToIndices.has(addr)) addressToIndices.set(addr, []);
            addressToIndices.get(addr)!.push(i);
        }

        return { name, addr };
    });

    // 2. 동일 이름 병합 (O(N))
    for (const indices of nameToIndices.values()) {
        for (let k = 1; k < indices.length; k++) {
            union(indices[0], indices[k]);
        }
    }

    // 3. 동일 주소 내 유사 이름 병합 (O(N * M^2), M은 동일 주소 맛집 수 - 대개 매우 작음)
    for (const indices of addressToIndices.values()) {
        if (indices.length < 2) continue;
        for (let j = 0; j < indices.length; j++) {
            for (let k = j + 1; k < indices.length; k++) {
                const idx1 = indices[j];
                const idx2 = indices[k];
                if (find(idx1) === find(idx2)) continue;

                // 이름 유사도 체크 (이 부분은 주소가 같을 때만 실행되므로 매우 효율적)
                if (calculateSimilarity(normalizedData[idx1].name, normalizedData[idx2].name) >= 0.95) {
                    union(idx1, idx2);
                }
            }
        }
    }

    // 4. 그룹별 데이터 실제 병합 (O(N))
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(i);
    }

    const mergedResults: Restaurant[] = Array.from(groups.values()).map(indices => {
        const groupRestaurants = indices.map(idx => restaurants[idx]);

        // 이름 길이순으로 정렬하여 가장 긴 이름을 메인으로 사용
        const sortedByNameLength = [...groupRestaurants].sort((a, b) => {
            const nameA = getRestaurantName(a as RestaurantWithOptionalName);
            const nameB = getRestaurantName(b as RestaurantWithOptionalName);
            return nameB.length - nameA.length;
        });

        const mainRestaurant = sortedByNameLength[0];

        // 유효한 좌표 찾기
        let lat = 0, lng = 0;
        for (const r of sortedByNameLength) {
            if (r.lat && r.lng) {
                lat = r.lat;
                lng = r.lng;
                break;
            }
        }

        // 카테고리 병합
        const allCategories = Array.from(new Set(
            groupRestaurants.flatMap(r => r.categories || [])
        ));

        // 최신 영상 순으로 정렬
        const sortedByDate = [...groupRestaurants].sort((a, b) => {
            const dateA = (a.youtube_meta as YoutubeMeta | null)?.publishedAt || '';
            const dateB = (b.youtube_meta as YoutubeMeta | null)?.publishedAt || '';
            return dateB.localeCompare(dateA);
        });

        // 유튜브 링크 중복 제거 수집
        const mergedYoutubeLinks = Array.from(new Set(
            sortedByDate.map(r => r.youtube_link).filter((l): l is string => !!l)
        ));

        // 리뷰 수집
        const mergedTzuyangReviews = sortedByDate
            .map(r => r.tzuyang_review)
            .filter((rev): rev is string => !!rev);

        // 유튜브 메타 수집
        const mergedYoutubeMetas = sortedByDate
            .map(r => r.youtube_meta as YoutubeMeta | null)
            .filter((m): m is YoutubeMeta => !!m);

        return {
            ...mainRestaurant,
            name: getRestaurantName(mainRestaurant as RestaurantWithOptionalName),
            lat,
            lng,
            categories: allCategories,
            address: mainRestaurant.road_address || mainRestaurant.jibun_address || '',
            category: allCategories,
            youtube_link: mergedYoutubeLinks[0] || null,
            tzuyang_review: mergedTzuyangReviews[0] || null,
            youtube_meta: mergedYoutubeMetas[0] || null,
            mergedYoutubeLinks,
            mergedTzuyangReviews,
            mergedYoutubeMetas,
            review_count: groupRestaurants.reduce((sum, r) => sum + (r.review_count || 0), 0),
            mergedRestaurants: groupRestaurants,
        } as Restaurant;
    });

    perfMonitor.endMeasure('mergeRestaurants');
    if (process.env.NODE_ENV === 'development' && restaurants.length > 50) {
        perfMonitor.report();
    }

    return mergedResults;
}


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
            // [OPTIMIZATION] 필요한 필드만 선택하여 네트워크 전송량 및 파싱 시간 감소
            let query = supabase
                .from("restaurants")
                .select("id, name:approved_name, lat, lng, road_address, jibun_address, categories, phone, review_count, youtube_link, tzuyang_review, youtube_meta, english_address, status, created_at")
                .eq("status", "approved") // status가 approved인 것만 조회
                .order("approved_name"); // 이름순으로 정렬

            // 경계(Bounds) 필터 적용 (제공된 경우)
            if (bounds) {
                query = query
                    .gte("lat", bounds.south)
                    .lte("lat", bounds.north)
                    .gte("lng", bounds.west)
                    .lte("lng", bounds.east);
            }

            // 카테고리 필터 적용 (categories는 배열 타입)
            if (category && category.length > 0) {
                // categories는 TEXT[] 타입으로 저장됨
                query = query.overlaps("categories", category);
            }

            // 지역(Region) 필터 적용
            if (region) {
                if (region === "울릉도") {
                    // 울릉도는 주소에 '울릉'이 포함된 데이터 필터링
                    query = query.or(`road_address.ilike.%울릉%,jibun_address.ilike.%울릉%`);
                } else if (region === "욕지도") {
                    // 욕지도는 주소에 '욕지'가 포함된 데이터 필터링
                    query = query.or(`road_address.ilike.%욕지%,jibun_address.ilike.%욕지%`);
                } else if (region in OVERSEAS_REGIONS) {
                    const config = OVERSEAS_REGIONS[region as keyof typeof OVERSEAS_REGIONS];
                    const conditions: string[] = [];
                    config.keywords.forEach((keyword: string) => {
                        conditions.push(`road_address.ilike.%${keyword}%`);
                        conditions.push(`jibun_address.ilike.%${keyword}%`);
                        conditions.push(`english_address.ilike.%${keyword}%`);
                    });

                    if (conditions.length > 0) {
                        query = query.or(conditions.join(','));
                    }
                } else {
                    // address_elements의 SIDO에서 지역 필터링
                    // 도로명 주소나 지번 주소에 지역명이 포함되어 있는지 확인
                    query = query.or(`road_address.ilike.%${region}%,jibun_address.ilike.%${region}%`);
                }
            }

            // 리뷰 수 필터 적용
            if (minReviews && minReviews > 0) {
                query = query.gte("review_count", minReviews);
            }

            const { data, error } = await query;

            if (error) {
                console.error('레스토랑 데이터 조회 실패:', error.message);
                throw error;
            }

            // 승인된 리뷰 수 조회
            const rawRestaurants = (data || []) as RestaurantWithOptionalName[];
            const restaurantIds = rawRestaurants.map(r => r.id);
            const verifiedCountMap = new Map<string, number>();

            if (restaurantIds.length > 0) {
                const { data: reviewCounts } = await supabase
                    .from('reviews')
                    .select('restaurant_id')
                    .in('restaurant_id', restaurantIds)
                    .eq('is_verified', true);

                (reviewCounts as ReviewCountRow[] | null)?.forEach((r) => {
                    if (!r.restaurant_id) return;
                    verifiedCountMap.set(r.restaurant_id, (verifiedCountMap.get(r.restaurant_id) || 0) + 1);
                });
            }

            // 병합 로직 적용
            const restaurants = mergeRestaurants(rawRestaurants);

            // 승인된 리뷰 수 추가 (병합된 모든 레스토랑 ID의 리뷰 합산)
            return restaurants.map(r => {
                // 병합된 레스토랑들의 모든 ID에 대한 verified_review_count 합산
                const mergedIds = r.mergedRestaurants?.map((mr) => mr.id) || [r.id];
                const totalVerifiedCount = mergedIds.reduce((sum: number, id: string) =>
                    sum + (verifiedCountMap.get(id) || 0), 0);
                return {
                    ...r,
                    verified_review_count: totalVerifiedCount
                };
            }) as Restaurant[];
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
                .select("*, name:approved_name")
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
            };

            return restaurant;
        },
        enabled: !!id,
    });
}

