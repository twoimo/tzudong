import { supabase } from '@/integrations/supabase/client';

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictType?: 'name_mismatch' | 'merge_needed';
  conflictingRestaurants?: any[];
  message?: string;
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
