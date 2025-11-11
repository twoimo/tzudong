// 평가 레코드 타입 정의 (restaurants 테이블 기반)

export interface NaverAddressInfo {
  road_address: string | null;
  jibun_address: string;
  english_address: string | null;
  address_elements: any;
  x: string; // lng
  y: string; // lat
}

export interface RestaurantInfo {
  name: string;
  phone: string | null;
  category: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  reasoning_basis: string;
  tzuyang_review: string;
  naver_address_info: NaverAddressInfo | null;
}

export interface EvaluationResult {
  visit_authenticity: {
    name: string;
    eval_value: number;
    eval_basis: string;
  } | null;
  rb_inference_score: {
    name: string;
    eval_value: number;
    eval_basis: string;
  } | null;
  rb_grounding_TF: {
    name: string;
    eval_value: boolean;
    eval_basis: string;
  } | null;
  review_faithfulness_score: {
    name: string;
    eval_value: number;
    eval_basis: string;
  } | null;
  category_TF: {
    name: string;
    eval_value: boolean;
    category_revision: string | null;
    eval_basis?: string;
  } | null;
  category_validity_TF: {
    name: string;
    eval_value: boolean;
  } | null;
  location_match_TF: {
    name: string;
    eval_value: boolean;
    origin_address: string;
    naver_address: any[] | null;
    falseMessage?: string;
  } | null;
}

export interface DbConflictInfo {
  existing_restaurant: {
    id: string;
    name: string;
    jibun_address: string;
    phone: string | null;
    category: string[];
    youtube_links: string[];
    created_at: string;
  };
  new_restaurant: RestaurantInfo;
}

export type EvaluationRecordStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'hold'
  | 'deleted'
  | 'missing'
  | 'db_conflict'
  | 'geocoding_failed'
  | 'not_selected';

// restaurants 테이블 구조에 맞춘 EvaluationRecord
export interface EvaluationRecord {
  id: string;
  name: string; // restaurant_name 대신 name
  phone: string | null;
  categories: string[] | null; // category 배열
  lat: number | null;
  lng: number | null;
  road_address: string | null;
  jibun_address: string | null;
  english_address: string | null;
  address_elements: any;
  origin_address: any; // JSONB
  youtube_links: string[] | null; // 배열로 변경
  youtube_meta: {
    title: string;
    publishedAt: string;
    is_shorts: boolean;
    duration: number;
    ads_info: {
      is_ads: boolean;
      what_ads: string | null;
    };
  } | null;
  youtube_metas: any; // JSONB 배열
  unique_id: string | null;
  tzuyang_reviews: any; // JSONB 배열
  reasoning_basis: string | null;
  evaluation_results: EvaluationResult | null;
  source_type: string | null;
  geocoding_success: boolean;
  geocoding_false_stage: number | null;
  status: EvaluationRecordStatus;
  is_missing: boolean;
  is_not_selected: boolean;
  review_count: number;
  created_by: string | null;
  updated_by_admin_id: string | null;
  created_at: string;
  updated_at: string;

  // 호환성을 위한 추가 필드 (기존 코드와의 호환)
  restaurant_name?: string; // name의 별칭
  youtube_link?: string; // youtube_links[0]의 별칭
  restaurant_info?: RestaurantInfo | null;
  geocoding_fail_reason?: string | null;
  db_conflict_info?: DbConflictInfo | null;
  missing_message?: string | null;
  processed_by?: string | null;
  processed_at?: string | null;
  deleted_at?: string | null;
}

export interface EvaluationFilter {
  status?: EvaluationRecordStatus[];
  category?: string[];
  visit_authenticity?: number[];
  rb_grounding_TF?: boolean[];
  location_match_TF?: ('true' | 'false' | 'geocoding_failed')[];
  category_TF?: boolean[];
}

export interface CategoryStats {
  total: number;
  pending: number;
  approved: number;
  hold: number;
  missing: number;
  db_conflict: number;
  geocoding_failed: number;
  not_selected: number;
  deleted: number;
}
