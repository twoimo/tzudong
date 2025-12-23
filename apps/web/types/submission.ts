// 제보 시스템 타입 정의

// 제보 유형
export type SubmissionType = 'new' | 'edit';

// 제보 상태 (submissions 테이블)
export type SubmissionStatus = 'pending' | 'approved' | 'partially_approved' | 'rejected';

// 개별 항목 상태 (items 테이블)
export type ItemStatus = 'pending' | 'approved' | 'rejected';

// restaurant_requests 테이블 (쯔양에게 맛집 추천)
export interface RestaurantRequest {
    id: string;
    user_id: string;
    restaurant_name: string;
    address: string;
    phone: string | null;
    categories: string[] | null;
    recommendation_reason: string;
    youtube_link: string | null;
    lat: number | null;
    lng: number | null;
    geocoding_success: boolean;
    created_at: string;
}

// restaurant_submissions 테이블
export interface RestaurantSubmission {
    id: string;
    user_id: string;
    submission_type: SubmissionType;
    status: SubmissionStatus;
    restaurant_name: string;
    restaurant_address: string | null;
    restaurant_phone: string | null;
    restaurant_categories: string[] | null;
    target_restaurant_id: string | null;
    admin_notes: string | null;
    rejection_reason: string | null;
    resolved_by_admin_id: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
}

// restaurant_submission_items 테이블 (20251216 마이그레이션 반영)
export interface SubmissionItem {
    id: string;
    submission_id: string;
    youtube_link: string;
    tzuyang_review: string | null;
    item_status: ItemStatus;
    rejection_reason: string | null;
    target_restaurant_id: string | null; // 승인 후 연결된 restaurants.id
    created_at: string;
}

// 사용자 정보가 포함된 제보
export interface SubmissionWithUser extends RestaurantSubmission {
    items: SubmissionItem[];
    profiles: {
        nickname: string;
    } | null;
}

// 사용자 정보가 포함된 요청
export interface RequestWithUser extends RestaurantRequest {
    profiles: {
        nickname: string;
    } | null;
}

// 제보 폼 데이터 (신규 맛집)
export interface NewSubmissionFormData {
    restaurant_name: string;
    restaurant_address: string;
    restaurant_phone: string;
    restaurant_categories: string[];
    youtube_reviews: {
        youtube_link: string;
        tzuyang_review: string;
    }[];
}

// 제보 폼 데이터 (수정 요청)
export interface EditSubmissionFormData {
    target_restaurant_id: string;
    restaurant_name: string;
    restaurant_address: string;
    restaurant_phone: string;
    restaurant_categories: string[];
    youtube_reviews: {
        youtube_link: string;
        tzuyang_review: string;
        target_unique_id?: string; // 수정 대상 레코드의 unique_id
    }[];
}

// 요청 폼 데이터 (쯔양에게 추천)
export interface RequestFormData {
    restaurant_name: string;
    address: string;
    phone: string;
    categories: string[];
    recommendation_reason: string;
    youtube_link: string;
}

// 중복 검사 결과
export interface DuplicateCheckResult {
    is_duplicate: boolean;
    duplicate_type: 'exact_unique_id' | 'similar_name_address' | 'none';
    existing_restaurant_id: string | null;
    existing_name: string | null;
    existing_address: string | null;
    similarity_score: number;
}
