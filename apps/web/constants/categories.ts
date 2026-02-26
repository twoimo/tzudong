/**
 * 레스토랑 카테고리 상수
 * 
 * 쯔양 맛집 크롤링 프롬프트에서 정의된 필수 카테고리 목록입니다.
 * 이 배열은 전체 애플리케이션에서 일관되게 사용됩니다.
 */
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

export type RestaurantCategory = (typeof RESTAURANT_CATEGORIES)[number];

export const OVERSEAS_COUNTRIES = [
    '일본',
    '중국',
    '미국',
    '베트남',
    '태국',
    '대만',
    '홍콩',
    '영국',
    '프랑스',
    '이탈리아',
    '스페인',
    '독일',
    '기타 해외',
] as const;

export type OverseasCountry = typeof OVERSEAS_COUNTRIES[number];
