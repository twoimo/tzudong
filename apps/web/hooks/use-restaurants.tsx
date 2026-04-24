import { useQuery } from "@tanstack/react-query";
import { OVERSEAS_REGIONS } from "@/constants/overseas-regions";
import { perfMonitor } from "@/lib/performance-monitor";
import { Restaurant, Region, YoutubeMeta } from "@/types/restaurant";
import { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { buildRelatedVerifiedReviewCountMap } from "@/lib/restaurant-review-counts";

type DBRestaurant = Tables<"restaurants">;

const SIMILARITY_THRESHOLD = 0.95;
const QUERY_KEY_COORDINATE_PRECISION = 4;

type RestaurantWithOptionalName = DBRestaurant & {
    name?: string | null;
    approved_name?: string | null;
};

type ReviewCountRow = {
    restaurant_id: string | null;
};

type ReviewCountCandidateRestaurant = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address' | 'status'
>;

const REVIEW_COUNT_RELATED_RESTAURANT_SELECT = 'id, name:approved_name, approved_name, road_address, jibun_address, status';
const SUPABASE_IN_CHUNK_SIZE = 80;

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

type NormalizedBounds = [number, number, number, number];

const mergePerfCounters = {
    similarityChecks: 0,
    mainSelectionComparisons: 0,
};

/**
 * 레벤슈타인 거리 계산 (문자열 유사도 측정용)
 * 두 문자열 사이의 편집 거리를 계산합니다.
 *
 * @param str1 기준 문자열
 * @param str2 비교 대상 문자열
 * @param maxDistance 허용되는 최대 거리 (초과하면 즉시 종료)
 * @returns 편집 거리 (숫자)
 */
function levenshteinDistance(str1: string, str2: string, maxDistance: number = Number.MAX_SAFE_INTEGER): number {
    const len1 = str1.length;
    const len2 = str2.length;

    if (Math.abs(len1 - len2) > maxDistance) return maxDistance + 1;
    if (len1 === 0) return Math.min(len2, maxDistance + 1);
    if (len2 === 0) return Math.min(len1, maxDistance + 1);

    const normalizedStr1 = len1 >= len2 ? str1 : str2;
    const normalizedStr2 = len1 >= len2 ? str2 : str1;
    const n = normalizedStr1.length;
    const m = normalizedStr2.length;

    let previous = new Int32Array(m + 1);
    let current = new Int32Array(m + 1);

    for (let j = 0; j <= m; j++) {
        previous[j] = j;
    }

    for (let i = 1; i <= n; i++) {
        current[0] = i;
        let rowMin = current[0];

        const windowStart = Math.max(1, i - maxDistance);
        const windowEnd = Math.min(m, i + maxDistance);

        for (let j = 1; j < windowStart; j++) {
            current[j] = maxDistance + 1;
        }

        for (let j = windowStart; j <= windowEnd; j++) {
            const deletion = previous[j] + 1;
            const insertion = current[j - 1] + 1;
            const substitution = previous[j - 1] + (normalizedStr1[i - 1] === normalizedStr2[j - 1] ? 0 : 1);
            const cost = Math.min(deletion, insertion, substitution);
            current[j] = cost;
            if (cost < rowMin) {
                rowMin = cost;
            }
        }

        for (let j = windowEnd + 1; j <= m; j++) {
            current[j] = maxDistance + 1;
        }

        if (rowMin > maxDistance) {
            return maxDistance + 1;
        }

        const temp = previous;
        previous = current;
        current = temp;
    }

    const distance = previous[m];
    return distance > maxDistance ? maxDistance + 1 : distance;
}

/**
 * 문자열 유사도 계산 함수
 * 0-1 사이의 값으로 반환하며, 1에 가까울수록 두 문자열이 유사합니다.
 *
 * @param str1 기준 문자열
 * @param str2 비교 대상 문자열
 * @param similarityThreshold similarity 임계값
 * @returns 유사도 (0.0 ~ 1.0)
 */
function calculateSimilarity(str1: string, str2: string, similarityThreshold = SIMILARITY_THRESHOLD): number {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1.0;

    mergePerfCounters.similarityChecks += 1;

    const maxDistance = Math.floor(maxLen * (1 - similarityThreshold));
    if (maxDistance <= 0) {
        return str1 === str2 ? 1.0 : 0;
    }

    const distance = levenshteinDistance(str1, str2, maxDistance);
    if (distance > maxDistance) return 0;

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

function getRestaurantName(restaurant: RestaurantWithOptionalName): string {
    return restaurant.name || restaurant.approved_name || '';
}

function isLengthDiffWithinSimilarityThreshold(
    str1: string,
    str2: string,
    threshold = SIMILARITY_THRESHOLD
): boolean {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return true;
    const lenDiff = Math.abs(str1.length - str2.length);
    return lenDiff <= maxLen * (1 - threshold);
}

function normalizeBounds(bounds?: UseRestaurantsOptions["bounds"]): NormalizedBounds | null {
    if (!bounds) return null;
    const round = (value: number) => Number(value.toFixed(QUERY_KEY_COORDINATE_PRECISION));
    return [round(bounds.south), round(bounds.west), round(bounds.north), round(bounds.east)];
}

function normalizeCategories(category?: string[]): string[] {
    if (!category || category.length === 0) return [];
    const normalized = category
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item));

    const deduped = new Set(normalized);
    return [...deduped].sort((a, b) => a.localeCompare(b));
}

function normalizeRegion(region?: Region): string | null {
    const normalized = region?.trim();
    return normalized ? normalized : null;
}

function normalizeMinReviews(minReviews?: number): number | null {
    return typeof minReviews === "number" && Number.isFinite(minReviews) && minReviews > 0 ? minReviews : null;
}

function buildRestaurantQueryKey(
    normalizedBounds: NormalizedBounds | null,
    normalizedCategory: string[],
    normalizedRegion: string | null,
    normalizedMinReviews: number | null
): [
    "restaurants",
    NormalizedBounds | null,
    string[],
    string | null,
    number | null
] {
    return ["restaurants", normalizedBounds, normalizedCategory, normalizedRegion, normalizedMinReviews];
}


function getUniqueRestaurantNames(restaurants: RestaurantWithOptionalName[]): string[] {
    return [...new Set(restaurants
        .map((restaurant) => getRestaurantName(restaurant).trim())
        .filter(Boolean))];
}

async function fetchRelatedRestaurantCandidates(names: string[]): Promise<ReviewCountCandidateRestaurant[]> {
    if (names.length === 0) return [];

    const candidateRows: ReviewCountCandidateRestaurant[] = [];
    for (let index = 0; index < names.length; index += SUPABASE_IN_CHUNK_SIZE) {
        const nameChunk = names.slice(index, index + SUPABASE_IN_CHUNK_SIZE);
        const { data, error } = await supabase
            .from('restaurants')
            .select(REVIEW_COUNT_RELATED_RESTAURANT_SELECT)
            .in('approved_name', nameChunk);

        if (error) throw error;
        candidateRows.push(...((data ?? []) as ReviewCountCandidateRestaurant[]));
    }

    return candidateRows;
}

async function fetchVerifiedReviewRows(restaurantIds: string[]): Promise<ReviewCountRow[]> {
    if (restaurantIds.length === 0) return [];

    const reviewRows: ReviewCountRow[] = [];
    for (let index = 0; index < restaurantIds.length; index += SUPABASE_IN_CHUNK_SIZE) {
        const idChunk = restaurantIds.slice(index, index + SUPABASE_IN_CHUNK_SIZE);
        const { data, error } = await supabase
            .from('reviews')
            .select('restaurant_id')
            .in('restaurant_id', idChunk)
            .eq('is_verified', true);

        if (error) throw error;
        reviewRows.push(...((data ?? []) as ReviewCountRow[]));
    }

    return reviewRows;
}

export async function buildRelatedVerifiedReviewCounts(restaurants: RestaurantWithOptionalName[]): Promise<Map<string, number>> {
    const relatedCandidates = await fetchRelatedRestaurantCandidates(getUniqueRestaurantNames(restaurants));
    const relatedRestaurantIds = [...new Set(relatedCandidates.map((restaurant) => restaurant.id).filter(Boolean))];
    const reviewRows = await fetchVerifiedReviewRows(relatedRestaurantIds);

    return buildRelatedVerifiedReviewCountMap(
        restaurants as Restaurant[],
        relatedCandidates,
        reviewRows
    );
}

export function getMergePerfCounters() {
    return { ...mergePerfCounters };
}

export function resetMergePerfCounters() {
    mergePerfCounters.similarityChecks = 0;
    mergePerfCounters.mainSelectionComparisons = 0;
}

function isNameBetterForMainCandidate(candidate: RestaurantWithOptionalName, current: RestaurantWithOptionalName): boolean {
    const candidateName = getRestaurantName(candidate);
    const currentName = getRestaurantName(current);

    if (candidateName.length !== currentName.length) {
        return candidateName.length > currentName.length;
    }

    const candidateReviewCount = candidate.review_count || 0;
    const currentReviewCount = current.review_count || 0;
    if (candidateReviewCount !== currentReviewCount) {
        return candidateReviewCount > currentReviewCount;
    }

    const candidatePublishedAt = (candidate.youtube_meta as YoutubeMeta | null)?.publishedAt || '';
    const currentPublishedAt = (current.youtube_meta as YoutubeMeta | null)?.publishedAt || '';
    const publishedAtDiff = candidatePublishedAt.localeCompare(currentPublishedAt);
    if (publishedAtDiff !== 0) {
        return publishedAtDiff > 0;
    }

    return candidate.id < current.id;
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

        // 정확 일치 병합은 값이 이미 동일한 경우 매우 빠르게 처리
        if (name) {
            const sameNameList = nameToIndices.get(name);
            if (sameNameList) {
                sameNameList.push(i);
            } else {
                nameToIndices.set(name, [i]);
            }
        }

        const addr = normalizeAddress(r.jibun_address || r.road_address || '');
        if (addr) {
            const sameAddressList = addressToIndices.get(addr);
            if (sameAddressList) {
                sameAddressList.push(i);
            } else {
                addressToIndices.set(addr, [i]);
            }
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
            const idx1 = indices[j];
            for (let k = j + 1; k < indices.length; k++) {
                const idx2 = indices[k];
                if (find(idx1) === find(idx2)) continue;

                const name1 = normalizedData[idx1].name;
                const name2 = normalizedData[idx2].name;

                // 이름 유사도 체크 (이 부분은 주소가 같을 때만 실행되므로 매우 효율적)
                if (name1 === name2) {
                    union(idx1, idx2);
                    continue;
                }

                if (!isLengthDiffWithinSimilarityThreshold(name1, name2)) {
                    continue;
                }

                if (calculateSimilarity(name1, name2) >= SIMILARITY_THRESHOLD) {
                    union(idx1, idx2);
                }
            }
        }
    }

    // 4. 그룹별 데이터 실제 병합 (O(N))
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        const existing = groups.get(root);
        if (existing) {
            existing.push(i);
        } else {
            groups.set(root, [i]);
        }
    }

    const mergedResults: Restaurant[] = Array.from(groups.values()).map((indices) => {
        const groupRestaurants = indices.map(idx => restaurants[idx]);

        // 메인 레스토랑은 단일 패스 비교로 선택 (정렬 제거)
        let mainRestaurant = groupRestaurants[0];
        for (let i = 1; i < groupRestaurants.length; i++) {
            const candidate = groupRestaurants[i];
            mergePerfCounters.mainSelectionComparisons += 1;
            if (isNameBetterForMainCandidate(candidate, mainRestaurant)) {
                mainRestaurant = candidate;
            }
        }

        // 유효한 좌표를 가진 메인 후보 선택
        const latLngRestaurant = groupRestaurants.find((restaurant) => restaurant.lat && restaurant.lng) || mainRestaurant;

        const lat = latLngRestaurant?.lat || 0;
        const lng = latLngRestaurant?.lng || 0;

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

export function useRestaurants(options: UseRestaurantsOptions = {}) {
    const { bounds, category, region, minReviews, enabled = true } = options;

    const normalizedBounds = normalizeBounds(bounds);
    const normalizedCategory = normalizeCategories(category);
    const normalizedRegion = normalizeRegion(region);
    const normalizedMinReviews = normalizeMinReviews(minReviews);
    const queryKey = buildRestaurantQueryKey(normalizedBounds, normalizedCategory, normalizedRegion, normalizedMinReviews);

    return useQuery({
        queryKey,
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
                // queryKey에는 반올림 bounds를 사용해 캐시 키 폭주를 막고,
                // 실제 필터는 원본 bounds를 사용해 경계 데이터 누락을 방지합니다.
                const { south, west, north, east } = bounds;
                query = query
                    .gte("lat", south)
                    .lte("lat", north)
                    .gte("lng", west)
                    .lte("lng", east);
            }

            // 카테고리 필터 적용 (categories는 배열 타입)
            if (normalizedCategory.length > 0) {
                // categories는 TEXT[] 타입으로 저장됨
                query = query.overlaps("categories", normalizedCategory);
            }

            // 지역(Region) 필터 적용
            if (normalizedRegion) {
                if (normalizedRegion === "울릉도") {
                    // 울릉도는 주소에 '울릉'이 포함된 데이터 필터링
                    query = query.or(`road_address.ilike.%울릉%,jibun_address.ilike.%울릉%`);
                } else if (normalizedRegion === "욕지도") {
                    // 욕지도는 주소에 '욕지'가 포함된 데이터 필터링
                    query = query.or(`road_address.ilike.%욕지%,jibun_address.ilike.%욕지%`);
                } else if (normalizedRegion in OVERSEAS_REGIONS) {
                    const config = OVERSEAS_REGIONS[normalizedRegion as keyof typeof OVERSEAS_REGIONS];
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
                    query = query.or(`road_address.ilike.%${normalizedRegion}%,jibun_address.ilike.%${normalizedRegion}%`);
                }
            }

            // 리뷰 수 필터 적용
            if (normalizedMinReviews && normalizedMinReviews > 0) {
                query = query.gte("review_count", normalizedMinReviews);
            }

            const { data, error } = await query;

            if (error) {
                console.error('레스토랑 데이터 조회 실패:', error.message);
                throw error;
            }

            // 승인된 리뷰 수 조회: approved canonical과 동일 이름/동일 주소 deleted duplicate 리뷰도 합산합니다.
            const rawRestaurants = (data || []) as RestaurantWithOptionalName[];
            const restaurants = mergeRestaurants(rawRestaurants);
            const verifiedCountMap = await buildRelatedVerifiedReviewCounts(restaurants as RestaurantWithOptionalName[]);

            return restaurants.map(r => ({
                ...r,
                verified_review_count: verifiedCountMap.get(r.id) || 0,
            })) as Restaurant[];
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
