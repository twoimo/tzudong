import { supabase } from '@/integrations/supabase/client';

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictType?: 'name_mismatch' | 'merge_needed';
  conflictingRestaurants?: any[];
  message?: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchedRestaurant?: any;
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
 * 1. 지번주소 앞 20자로 같은 지역 필터링
 * 2. 이름 유사도 85% 이상이면 중복으로 판정
 */
export async function checkRestaurantDuplicate(
  name: string,
  jibunAddress: string,
  restaurantId?: string
): Promise<DuplicateCheckResult> {
  const NAME_SIMILARITY_THRESHOLD = 0.85; // 이름 유사도 85% 이상
  const ADDRESS_MATCH_LENGTH = 20; // 지번주소 앞 20자 비교

  // 지번주소 정규화 (앞 20자만 사용)
  const normalizedAddress = jibunAddress.trim().substring(0, ADDRESS_MATCH_LENGTH);

  try {
    // 같은 지역의 맛집들 조회
    let query = supabase
      .from('restaurants')
      .select('id, name, jibun_address, road_address')
      .ilike('jibun_address', `${normalizedAddress}%`);

    // 수정 시 자기 자신 제외
    if (restaurantId) {
      query = query.neq('id', restaurantId);
    }

    const { data: existingRestaurants, error } = await query;

    if (error) throw error;

    if (!existingRestaurants || existingRestaurants.length === 0) {
      return { isDuplicate: false, similarityScore: 0 };
    }

    // 각 맛집과 유사도 비교
    for (const restaurant of existingRestaurants) {
      const similarity = calculateSimilarity(name, restaurant.name);

      if (similarity >= NAME_SIMILARITY_THRESHOLD) {
        return {
          isDuplicate: true,
          matchedRestaurant: restaurant,
          similarityScore: similarity,
          reason: `"${restaurant.name}"와 이름이 ${(similarity * 100).toFixed(0)}% 유사하며 같은 주소입니다.`
        };
      }
    }

    return { isDuplicate: false, similarityScore: 0 };
  } catch (error) {
    console.error('중복 검사 실패:', error);
    throw error;
  }
}

/**
 * 오류 체크 함수
 * 
 * 충돌 조건:
 * 1. 같은 지번주소 + 같은 youtube_link + 다른 음식점명 → 오류 (name_mismatch)
 * 2. 같은 지번주소 + 같은 음식점명 + 다른 youtube_link → 병합 필요 (merge_needed)
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

  try {
    // 같은 지번주소의 모든 음식점 검색
    let query = supabase
      .from('restaurants')
      .select('*')
      .eq('jibun_address', trimmedJibunAddress);

    // 수정 시 본인 제외
    if (excludeRestaurantId) {
      query = query.neq('id', excludeRestaurantId);
    }

    const { data: existingRestaurants, error } = await query;

    if (error) throw error;
    if (!existingRestaurants || existingRestaurants.length === 0) {
      return { hasConflict: false };
    }

    // 충돌 타입 1: 같은 주소 + 같은 youtube_link + 다른 음식점명
    const nameMismatchConflicts = existingRestaurants.filter(restaurant =>
      restaurant.youtube_links?.includes(trimmedYoutubeLink) &&
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
      !restaurant.youtube_links?.includes(trimmedYoutubeLink)
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
 * 병합 처리 함수
 */
export async function mergeRestaurantData(params: {
  existingRestaurant: any;
  newYoutubeLink: string;
  newYoutubeMeta?: any;
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
    // 중복 방지하면서 추가
    const updatedYoutubeLinks = [
      ...existingRestaurant.youtube_links,
      ...(existingRestaurant.youtube_links.includes(newYoutubeLink) ? [] : [newYoutubeLink])
    ];

    const updatedYoutubeMetas = [
      ...existingRestaurant.youtube_metas,
      ...(newYoutubeMeta ? [newYoutubeMeta] : [])
    ];

    const updatedTzuyangReviews = [
      ...existingRestaurant.tzuyang_reviews,
      ...(newTzuyangReview ? [newTzuyangReview] : [])
    ];

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
      .update({
        youtube_links: updatedYoutubeLinks,
        youtube_metas: updatedYoutubeMetas,
        tzuyang_reviews: updatedTzuyangReviews,
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

  } catch (error: any) {
    console.error('병합 실패:', error);
    return { success: false, error: error.message };
  }
}
