// 평가 레코드 타입 정의

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
  | 'hold'
  | 'deleted'
  | 'missing'
  | 'db_conflict'
  | 'geocoding_failed'
  | 'not_selected';

export interface EvaluationRecord {
  id: string;
  youtube_link: string;
  restaurant_name: string;
  status: EvaluationRecordStatus;
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
  evaluation_results: EvaluationResult | null;
  restaurant_info: RestaurantInfo | null;
  geocoding_success: boolean;
  geocoding_fail_reason: string | null;
  db_conflict_info: DbConflictInfo | null;
  missing_message: string | null;
  created_at: string;
  updated_at: string;
  processed_by: string | null;
  processed_at: string | null;
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
