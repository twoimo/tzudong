import { supabase } from '@/integrations/supabase/client';
import { debugLog } from '@/lib/debug-log';

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictType?: 'name_mismatch' | 'merge_needed';
  conflictingRestaurants?: Array<{
    id: string;
    name: string;
    jibun_address: string | null;
    youtube_link: string | null;
  }>;
  message?: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchedRestaurant?: {
    id: string;
    name: string;
    jibun_address: string;
    road_address: string | null;
    youtube_link: string | null;
  };
  similarityScore: number;
  reason?: string;
}

/**
 * Levenshtein Distance 계산
 * 두 문자열 간의 편집 거리를 계산
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 치환
          matrix[i][j - 1] + 1,     // 삽입
          matrix[i - 1][j] + 1      // 삭제
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * 주소 정규화 함수
 * - 층/호수 제거 (같은 건물 다른 층은 같은 주소로 취급)
 * - 공백 및 특수문자 제거
 * - 소문자 변환
 * 
 * 주의: use-restaurants.tsx의 normalizeAddress()와 동일하게 유지해야 함
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

/**
 * 문자열 유사도 계산 (0-1 사이 값)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const normalizedStr1 = str1.toLowerCase().trim();
  const normalizedStr2 = str2.toLowerCase().trim();

  const distance = levenshteinDistance(normalizedStr1, normalizedStr2);
  const maxLength = Math.max(normalizedStr1.length, normalizedStr2.length);

  if (maxLength === 0) return 1; // 둘 다 빈 문자열

  return 1 - distance / maxLength;
}

/**
 * 맛집 중복 체크 (Levenshtein Distance 기반)
 * 
 * 검사 로직:
 * 1. status가 'approved'인 레스토랑 중에서만 검사
 * 2. 정규화된 지번주소가 일치하는 레스토랑 필터링
 *    - 정규화: 공백 제거, 층/호수 제거 (지하n층, 지상n층, n층, n호)
 * 3. 이름 유사도 85% 이상이면 중복으로 판정
 * 4. YouTube 링크는 중복 판단에 사용하지 않음 (상위에서 별도 처리)
 */
export async function checkRestaurantDuplicate(
  name: string,
  jibunAddress: string,
  restaurantId?: string,
  youtubeLink?: string
): Promise<DuplicateCheckResult> {
  const NAME_SIMILARITY_THRESHOLD = 0.85; // 이름 유사도 85% 이상

  try {
    const normalizedInputAddress = normalizeAddress(jibunAddress);

    debugLog('🔍 중복 검사 시작:', {
      name,
      jibunAddress,
      normalizedAddress: normalizedInputAddress,
      restaurantId,
      youtubeLink,
    });

    // 모든 승인된 맛집들 조회 후 정규화된 주소로 필터링
    let query = supabase
      .from('restaurants')
      .select('id, name:approved_name, jibun_address, road_address, status, youtube_link')
      .eq('status', 'approved'); // ✅ approved 상태만 검사

    // 수정 시 자기 자신 제외
    if (restaurantId) {
      query = query.neq('id', restaurantId);
    }

    const { data: allRestaurants, error } = await query;

    if (error) {
      console.error('❌ DB 조회 에러:', error);
      throw error;
    }

    // 타입 명시
    type RestaurantRecord = {
      id: string;
      name: string;
      jibun_address: string | null;
      road_address: string | null;
      status: string;
      youtube_link: string | null;
    };

    const typedRestaurants = (allRestaurants || []) as RestaurantRecord[];

    // 정규화된 주소가 일치하는 레스토랑만 필터링
    const existingRestaurants = typedRestaurants.filter(r =>
      r.jibun_address && normalizeAddress(r.jibun_address) === normalizedInputAddress
    );

    debugLog('📊 정규화된 주소 일치 approved 레스토랑:', existingRestaurants.length, '개');

    if (existingRestaurants.length === 0) {
      debugLog('✅ 중복 없음 (정규화된 주소 일치하는 approved 레스토랑 없음)');
      return { isDuplicate: false, similarityScore: 0 };
    }

    // 각 맛집과 유사도 비교
    for (const restaurant of existingRestaurants) {
      if (!restaurant.name) continue;

      const similarity = calculateSimilarity(name, restaurant.name);

      debugLog('🔍 유사도 비교:', {
        current: name,
        existing: restaurant.name,
        similarity: Math.round(similarity * 100) + '%',
      });

      // 🔥 85% 이상 유사하면 중복으로 판단 (YouTube 링크 무관)
      if (similarity >= NAME_SIMILARITY_THRESHOLD) {
        debugLog('⚠️ 중복 감지! (유사도 85% 이상)');

        return {
          isDuplicate: true,
          matchedRestaurant: {
            id: restaurant.id,
            name: restaurant.name,
            jibun_address: restaurant.jibun_address || '',
            road_address: restaurant.road_address || null,
            youtube_link: restaurant.youtube_link || null, // ✅ 반환만 함 (비교는 상위에서)
          },
          similarityScore: similarity,
          reason: `같은 지번주소에 유사한 이름의 맛집이 이미 존재합니다 (유사도: ${Math.round(similarity * 100)}%)`
        };
      }
    }

    debugLog('✅ 중복 없음 (유사도 85% 미만)');
    return { isDuplicate: false, similarityScore: 0 };
  } catch (error) {
    console.error('💥 중복 검사 에러:', error);
    throw error;
  }
}

/**
 * 오류 체크 함수
 * 
 * 충돌 조건:
 * 1. 같은 정규화된 지번주소 + 같은 youtube_link + 다른 음식점명 → 오류 (name_mismatch)
 * 2. 같은 정규화된 지번주소 + 같은 음식점명 + 다른 youtube_link → 병합 필요 (merge_needed)
 */
export async function checkDbConflict(params: {
  jibunAddress: string;
  restaurantName: string;
  youtubeLink: string;
  excludeRestaurantId?: string; // 수정 시 본인 제외
}): Promise<ConflictCheckResult> {
  const { jibunAddress, restaurantName, youtubeLink, excludeRestaurantId } = params;

  // 입력값 trim
  const trimmedJibunAddress = jibunAddress.trim();
  const trimmedRestaurantName = restaurantName.trim();
  const trimmedYoutubeLink = youtubeLink.trim();

  // 주소 정규화 (층/호수 제거)
  const normalizedInputAddress = normalizeAddress(trimmedJibunAddress);

  try {
    // 모든 승인된 음식점 검색 후 정규화된 주소로 필터링
    let query = supabase
      .from('restaurants')
      // restaurants 테이블은 approved_name 이므로 alias로 name 호환 유지
      .select('id, name:approved_name, jibun_address, youtube_link')
      .eq('status', 'approved'); // 승인된 것만 검사

    // 수정 시 본인 제외
    if (excludeRestaurantId) {
      query = query.neq('id', excludeRestaurantId);
    }

    const { data: allRestaurants, error } = await query;

    if (error) throw error;

    // 타입 단언으로 Supabase 타입 문제 해결
    type RestaurantRecord = {
      id: string;
      name: string;
      jibun_address: string | null;
      youtube_link: string | null;
    };

    const typedAllRestaurants = (allRestaurants || []) as RestaurantRecord[];

    // 정규화된 주소가 일치하는 레스토랑만 필터링
    const existingRestaurants = typedAllRestaurants.filter(r =>
      r.jibun_address && normalizeAddress(r.jibun_address) === normalizedInputAddress
    );

    if (existingRestaurants.length === 0) {
      return { hasConflict: false };
    }

    // 충돌 타입 1: 같은 주소 + 같은 youtube_link + 다른 음식점명
    const nameMismatchConflicts = existingRestaurants.filter(restaurant =>
      restaurant.youtube_link === trimmedYoutubeLink &&
      restaurant.name.trim() !== trimmedRestaurantName
    );

    if (nameMismatchConflicts.length > 0) {
      return {
        hasConflict: true,
        conflictType: 'name_mismatch',
        conflictingRestaurants: nameMismatchConflicts,
        message: `같은 주소(${trimmedJibunAddress})와 영상 링크를 가진 다른 음식점명이 존재합니다: ${nameMismatchConflicts.map(r => r.name).join(', ')}`,
      };
    }

    // 충돌 타입 2: 같은 주소 + 같은 음식점명 + 다른 youtube_link (병합 필요)
    const mergeNeededRestaurants = existingRestaurants.filter(restaurant =>
      restaurant.name.trim() === trimmedRestaurantName &&
      restaurant.youtube_link !== trimmedYoutubeLink
    );

    if (mergeNeededRestaurants.length > 0) {
      return {
        hasConflict: true,
        conflictType: 'merge_needed',
        conflictingRestaurants: mergeNeededRestaurants,
        message: `같은 주소와 음식점명을 가진 레코드가 존재합니다. 영상 링크를 병합해야 합니다.`,
      };
    }

    return { hasConflict: false };

  } catch (error) {
    console.error('오류 체크 실패:', error);
    throw error;
  }
}

/**
 * 병합 처리 함수 (단일 값 처리)
 */
export async function mergeRestaurantData(params: {
  existingRestaurant: {
    id: string;
    youtube_link: string | null;
    youtube_meta: Record<string, unknown> | null;
    tzuyang_review: string | null;
    categories: string[] | string;
    updated_at: string;
  };
  newYoutubeLink: string;
  newYoutubeMeta?: Record<string, unknown>;
  newTzuyangReview?: string;
  newCategory?: string;
}): Promise<{ success: boolean; error?: string }> {
  const {
    existingRestaurant,
    newYoutubeLink,
    newYoutubeMeta,
    newTzuyangReview,
    newCategory
  } = params;

  try {
    // 단일 값 처리: 기존 값 유지, 없으면 새 값 사용
    const updatedYoutubeLink = existingRestaurant.youtube_link || newYoutubeLink;
    const updatedYoutubeMeta = existingRestaurant.youtube_meta || newYoutubeMeta || null;
    const updatedTzuyangReview = existingRestaurant.tzuyang_review || newTzuyangReview || null;

    // 카테고리 병합 (중복 제거)
    const currentCategories = Array.isArray(existingRestaurant.categories)
      ? existingRestaurant.categories
      : (existingRestaurant.categories ? [existingRestaurant.categories] : []);

    const updatedCategories = newCategory && !currentCategories.includes(newCategory)
      ? [...currentCategories, newCategory]
      : currentCategories;

    // Optimistic Locking으로 업데이트
    const { error: updateError } = await supabase
      .from('restaurants')
      // @ts-expect-error - Supabase 자동 생성 타입 문제
      .update({
        youtube_link: updatedYoutubeLink,
        youtube_meta: updatedYoutubeMeta,
        tzuyang_review: updatedTzuyangReview,
        categories: updatedCategories,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingRestaurant.id)
      .eq('updated_at', existingRestaurant.updated_at);

    if (updateError) {
      if (updateError.message.includes('updated_at')) {
        return {
          success: false,
          error: '다른 관리자가 수정했습니다. 새로고침 후 다시 시도하세요.'
        };
      }
      throw updateError;
    }

    return { success: true };

  } catch (error) {
    console.error('병합 실패:', error);
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    return { success: false, error: errorMessage };
  }
}
