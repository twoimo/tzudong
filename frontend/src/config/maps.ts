// Google Maps Configuration (글로벌 버전)
export const GOOGLE_MAPS_CONFIG = {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
};

// Naver Maps Configuration (한국 버전)
// 홈 지도 Dynamic용 - 다른 사람의 네이버 지도 API 키
export const NAVER_MAPS_CONFIG = {
    clientId: import.meta.env.VITE_NAVER_CLIENT_ID || '',
    clientSecret: import.meta.env.VITE_NAVER_CLIENT_SECRET || '',
};

// 관리자 재지오코딩용 - 본인의 NCP Maps API 키
// MissingRestaurantForm, EditRestaurantModal에서 사용
export const NCP_GEOCODING_CONFIG = {
    clientId: import.meta.env.VITE_NAVER_CLIENT_ID || '',
    clientSecret: import.meta.env.VITE_NAVER_CLIENT_SECRET || '',
};

// 지역별 지도 중심 좌표 및 줌 레벨
export const REGION_MAP_CONFIG = {
    "전국": { center: [36.5, 127.5], zoom: 7 }, // 한반도 전체가 보이도록 설정
    "서울특별시": { center: [37.5512, 126.9882], zoom: 12 },
    "부산광역시": { center: [35.1152, 129.0000], zoom: 12 },
    "대구광역시": { center: [35.8714, 128.6014], zoom: 12 },
    "인천광역시": { center: [37.4496, 126.6231], zoom: 12 },
    "광주광역시": { center: [35.1595, 126.8526], zoom: 12 },
    "대전광역시": { center: [36.3504, 127.3845], zoom: 12 },
    "울산광역시": { center: [35.5384, 129.3114], zoom: 12 },
    "세종특별자치시": { center: [36.4800, 127.2890], zoom: 12 },
    "경기도": { center: [37.4492, 127.1739], zoom: 10 },
    "충청북도": { center: [36.6357, 127.4915], zoom: 10 },
    "충청남도": { center: [36.5184, 126.8000], zoom: 10 },
    "전라남도": { center: [34.8161, 126.4629], zoom: 10 },
    "경상북도": { center: [36.2419, 128.8889], zoom: 9 },
    "경상남도": { center: [35.4606, 128.2132], zoom: 9 },
    "전북특별자치도": { center: [35.7175, 127.1530], zoom: 10 },
    "제주특별자치도": { center: [33.3625, 126.5339], zoom: 11 },
    "울릉도": { center: [37.4918, 130.8616], zoom: 13 },
    "욕지도": { center: [34.6354, 128.2661], zoom: 14 }
} as const;

