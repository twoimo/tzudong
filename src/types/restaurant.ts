import { Tables } from "@/integrations/supabase/types";

export type Restaurant = Tables<"restaurants">;
export type Review = Tables<"reviews">;
export type RestaurantCategory = Tables<"restaurants">["category"];

export interface RestaurantWithDetails extends Restaurant {
    reviews?: Review[];
    review_count: number;
    visit_count: number;
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

