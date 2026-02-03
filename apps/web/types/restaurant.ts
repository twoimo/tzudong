import { Tables } from "@/integrations/supabase/types";

// DB에서 가져온 기본 Restaurant 타입
type BaseRestaurant = Tables<"restaurants">;

// YouTube Meta 타입 정의 (DB에 저장된 실제 구조)
export interface YoutubeMeta {
    title?: string;
    ads_info?: {
        is_ads: boolean;
        what_ads: string[] | null;
    };
    duration?: number;
    is_shorts?: boolean;
    publishedAt?: string; // ISO 8601 날짜 문자열
}

// 호환성을 위한 확장 Restaurant 타입
export interface Restaurant extends BaseRestaurant {
    // 호환성 속성들 (기존 코드와의 호환을 위해)
    address?: string; // road_address 또는 jibun_address의 가상 속성
    category?: string[]; // categories의 별칭

    // 검색 관련 (주간 인기 검색용)
    weekly_search_count?: number; // 주간 검색 횟수

    // 마커 그룹화 시 병합된 데이터 (배열)
    mergedYoutubeLinks?: string[]; // 병합된 모든 유튜브 링크
    mergedTzuyangReviews?: string[]; // 병합된 모든 쯔양 리뷰
    mergedYoutubeMetas?: YoutubeMeta[]; // 병합된 모든 유튜브 메타

    // 마커 클릭 시 동일 name+jibun_address 레코드 병합 데이터
    youtube_links?: string[]; // 모든 유튜브 링크 배열
    tzuyang_reviews?: string[]; // 모든 쯔양 리뷰 배열

    // 병합된 원본 레코드들
    mergedRestaurants?: BaseRestaurant[]; // 병합된 모든 레스토랑 레코드
}

export type Review = Tables<"reviews">;
// categories는 배열 타입
export type RestaurantCategory = string[];

export interface RestaurantWithDetails extends Omit<Restaurant, 'visit_count'> {
    reviews?: Review[];
    visit_count?: number;
}

export interface MapMarker {
    id: string;
    position: { lat: number; lng: number };
    restaurant: Restaurant;
    markerType: "fire" | "star";
}

export interface MapBounds {
    south: number;
    west: number;
    north: number;
    east: number;
}

export const RESTAURANT_CATEGORIES = [
    "치킨",
    "중식",
    "돈까스·회",
    "피자",
    "패스트푸드",
    "찜·탕",
    "족발·보쌈",
    "분식",
    "카페·디저트",
    "한식",
    "고기",
    "양식",
    "아시안",
    "야식",
    "도시락",
] as const;

export const REGIONS = [
    "서울특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "광주광역시",
    "대전광역시",
    "울산광역시",
    "세종특별자치시",
    "경기도",
    "충청북도",
    "충청남도",
    "전라남도",
    "경상북도",
    "경상남도",
    "강원특별자치도",
    "전북특별자치도",
    "제주특별자치도",
    "울릉도",
    "욕지도"
] as const;

export const GLOBAL_REGIONS = [
    "미국",
    "일본",
    "대만",
    "태국",
    "인도네시아",
    "튀르키예",
    "헝가리",
    "오스트레일리아"
] as const;

export type Region = typeof REGIONS[number] | typeof GLOBAL_REGIONS[number];

