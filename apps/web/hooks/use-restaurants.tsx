import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant, Region, YoutubeMeta } from "@/types/restaurant";
import { Tables } from "@/integrations/supabase/types";

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

type IntermediateRestaurant = DBRestaurant & {
    mergedRestaurants?: DBRestaurant[];
    mergedYoutubeLinks?: string[];
    mergedTzuyangReviews?: string[];
    mergedYoutubeMetas?: YoutubeMeta[];
};

/**
 * 레스토랑 데이터 병합 함수
 * 이름과 주소가 유사한 중복 데이터들을 하나로 병합합니다.
 * 
 * @param restaurants DB에서 조회된 레스토랑 목록
 * @returns 병합된 레스토랑 목록
 */
export function mergeRestaurants(restaurants: DBRestaurant[]): Restaurant[] {
    const restaurantMap = new Map<string, IntermediateRestaurant>();

    restaurants.forEach((restaurant: DBRestaurant) => {
        const currentName = restaurant.name || '';
        const currentAddress = normalizeAddress(restaurant.jibun_address || restaurant.road_address || '');

        // 이미 처리된 레스토랑 중에서 유사한 것 찾기
        let merged = false;

        for (const [existingKey, existingRestaurant] of restaurantMap.entries()) {
            const existingName = existingRestaurant.name || '';
            const existingAddress = normalizeAddress(existingRestaurant.jibun_address || existingRestaurant.road_address || '');

            // 이름 유사도 계산
            const nameSimilarity = calculateSimilarity(currentName, existingName);

            // 동일한 이름 (100% 일치) 또는 주소가 같고 이름이 95% 이상 유사하면 병합
            const isSameName = currentName === existingName;
            const isSimilarNameAndAddress = currentAddress === existingAddress && nameSimilarity >= 0.95;

            if (isSameName || isSimilarNameAndAddress) {
                const mergedRestaurants = existingRestaurant.mergedRestaurants || [existingRestaurant];
                mergedRestaurants.push(restaurant);

                // 이름 길이순으로 정렬
                const sortedByNameLength = [...mergedRestaurants].sort((a, b) =>
                    (b.name?.length || 0) - (a.name?.length || 0)
                );

                // 가장 긴 이름
                const longestName = sortedByNameLength[0]?.name || currentName;

                // 가장 긴 이름의 좌표 (없으면 다음으로 긴 이름의 좌표)
                let coordinates = { latitude: 0, longitude: 0 };
                for (const r of sortedByNameLength) {
                    if (r.lat && r.lng) {
                        coordinates = { latitude: r.lat, longitude: r.lng };
                        break;
                    }
                }

                // 모든 카테고리 수집 (중복 제거) - 모든 배열을 펼쳐서 Set으로 중복 제거
                const allCategories = Array.from(new Set(
                    mergedRestaurants.flatMap(r => r.categories || [])
                ));

                // 날짜순 정렬을 위해 restaurant와 youtube_meta를 페어로 관리
                const restaurantPairs = mergedRestaurants.map(r => ({
                    restaurant: r,
                    publishedAt: (r.youtube_meta as YoutubeMeta | null)?.publishedAt || ''
                }));

                // publishedAt 날짜 기준 내림차순 정렬 (최신 영상이 먼저)
                restaurantPairs.sort((a, b) => {
                    if (!a.publishedAt) return 1;
                    if (!b.publishedAt) return -1;
                    return b.publishedAt.localeCompare(a.publishedAt);
                });

                const sortedRestaurants = restaurantPairs.map(p => p.restaurant);

                // youtube_link 병합 (중복 제거) - 정렬된 순서로 수집
                const mergedYoutubeLinks = sortedRestaurants
                    .map(r => r.youtube_link)
                    .filter((link): link is string => link != null)
                    .filter((link, index, self) => self.indexOf(link) === index);

                // tzuyang_review 병합 - 정렬된 순서로 수집
                const mergedTzuyangReviews = sortedRestaurants
                    .map(r => r.tzuyang_review)
                    .filter((review): review is string => review != null);

                // youtube_meta는 각 레코드에 하나씩만 있으므로 정렬된 순서로 수집
                const mergedYoutubeMetas = sortedRestaurants
                    .map(r => r.youtube_meta as YoutubeMeta | null)
                    .filter((meta): meta is YoutubeMeta => meta != null);

                // 병합된 데이터로 업데이트
                const updatedRestaurant = {
                    ...existingRestaurant,
                    name: longestName,
                    lat: coordinates.latitude,
                    lng: coordinates.longitude,
                    categories: allCategories, // 모든 카테고리 배열
                    youtube_link: mergedYoutubeLinks[0] || null, // 첫 번째 링크 (DB 저장용)
                    tzuyang_review: mergedTzuyangReviews[0] || null, // 첫 번째 리뷰 (DB 저장용)
                    youtube_meta: (mergedYoutubeMetas[0] || null) as any, // 가장 첫 번째 메타 (DB 저장용)
                    // 병합된 전체 배열 (UI 표시용)
                    mergedYoutubeLinks: mergedYoutubeLinks,
                    mergedTzuyangReviews: mergedTzuyangReviews,
                    mergedYoutubeMetas: mergedYoutubeMetas,
                    review_count: mergedRestaurants.reduce((sum, r) => sum + (r.review_count || 0), 0),
                    mergedRestaurants: mergedRestaurants,
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                restaurantMap.set(existingKey, updatedRestaurant);

                merged = true;
                break;
            }
        }

        // [리팩토링] 명시적인 더티 체크 대신 의존성 체크 접근 방식
        // 선택된 맛집이나 지역이 실제로 변경되었는지 확인해야 합니다.
        // 이전 props를 추적하기 위해 ref를 사용하는 것은 표준 패턴입니다.

        // 여기서는 로직 단순화를 위해:
        // 만약 사용자가 이동했다면(hasUserMovedMapRef.current), 새로운 항목으로 추가
        if (!merged) {
            const key = `${currentName}_${currentAddress}_${restaurantMap.size}`;
            restaurantMap.set(key, restaurant);
        }
    });

    // Map을 배열로 변환하고 호환성 속성 추가
    const mergedRestaurants = Array.from(restaurantMap.values()).map((restaurant: IntermediateRestaurant) => ({
        ...restaurant,
        // 호환성 속성 추가
        address: restaurant.road_address || restaurant.jibun_address || '',
        category: restaurant.categories,
        // 병합된 데이터 명시적으로 포함
        mergedRestaurants: restaurant.mergedRestaurants,
        mergedYoutubeLinks: restaurant.mergedYoutubeLinks,
        mergedTzuyangReviews: restaurant.mergedTzuyangReviews,
        mergedYoutubeMetas: restaurant.mergedYoutubeMetas,
    })) as Restaurant[];

    return mergedRestaurants;
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
            let query = supabase
                .from("restaurants")
                .select("*")
                .eq("status", "approved") // status가 approved인 것만 조회
                .order("name"); // 이름순으로 정렬

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

            // 병합 로직 적용
            const restaurants = mergeRestaurants(data || []);

            return restaurants;
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
            };

            return restaurant;
        },
        enabled: !!id,
    });
}

