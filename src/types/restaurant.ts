import { Tables } from "@/integrations/supabase/types";

export type Restaurant = Tables<"restaurants">;
export type Review = Tables<"reviews">;
// categories는 배열 타입
export type RestaurantCategory = string[];

export interface RestaurantWithDetails extends Restaurant {
    reviews?: Review[];
    review_count?: number;
    visit_count?: number;
}

export interface MapMarker {
    id: string;
    position: google.maps.LatLngLiteral;
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
    "전북특별자치도",
    "제주특별자치도",
    "울릉도",
    "욕지도"
] as const;

export const GLOBAL_REGIONS = [
    "미국",
    "일본",
    "태국",
    "인도네시아",
    "튀르키예",
    "헝가리",
    "오스트레일리아"
] as const;

export type Region = typeof REGIONS[number] | typeof GLOBAL_REGIONS[number];

