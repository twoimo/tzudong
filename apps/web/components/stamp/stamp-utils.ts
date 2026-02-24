// 도장 관련 공통 유틸리티 함수 및 상수
// stamp/page.tsx와 StampOverlay.tsx에서 공유
import { parseCategoryList } from '@/lib/category-utils';

// ========== Constants ==========

/** 지역 목록 */
export const REGIONS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

/** 지역 패턴 (주소에서 지역 추출용) */
export const regionPatterns = [
    { pattern: /^서울|서울특별시/, region: "서울" },
    { pattern: /^경기도|^경기/, region: "경기" },
    { pattern: /^인천|인천광역시/, region: "인천" },
    { pattern: /^부산|부산광역시/, region: "부산" },
    { pattern: /^대구|대구광역시/, region: "대구" },
    { pattern: /^광주|광주광역시/, region: "광주" },
    { pattern: /^대전|대전광역시/, region: "대전" },
    { pattern: /^울산|울산광역시/, region: "울산" },
    { pattern: /^세종|세종특별자치시/, region: "세종" },
    { pattern: /^강원|강원특별자치도|강원도/, region: "강원" },
    { pattern: /^충청북도|^충북/, region: "충북" },
    { pattern: /^충청남도|^충남/, region: "충남" },
    { pattern: /^전라북도|^전북|^전북특별자치도/, region: "전북" },
    { pattern: /^전라남도|^전남/, region: "전남" },
    { pattern: /^경상북도|^경북/, region: "경북" },
    { pattern: /^경상남도|^경남/, region: "경남" },
    { pattern: /^제주|제주특별자치도/, region: "제주" },
    { pattern: /미국|USA|United States/i, region: "미국" },
    { pattern: /일본|Japan/i, region: "일본" },
    { pattern: /태국|Thailand/i, region: "태국" },
    { pattern: /인도네시아|Indonesia/i, region: "인도네시아" },
    { pattern: /튀르키예|Turkey|Türkiye/i, region: "튀르키예" },
    { pattern: /헝가리|Hungary/i, region: "헝가리" },
    { pattern: /오스트레일리아|Australia/i, region: "오스트레일리아" },
];

// ========== Types ==========

export interface StampFilterState {
    searchQuery: string;
    categories: string[];
    regions: string[];
    fanVisitsMin?: number;
    showUnvisitedOnly: boolean;
}

export interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
}

// ========== Utility Functions ==========

/** 주소에서 지역 추출 */
export const extractRegion = (roadAddress: string | null, jibunAddress: string | null): string => {
    const address = roadAddress || jibunAddress || "";
    if (!address) return "";
    for (const { pattern, region } of regionPatterns) {
        if (pattern.test(address)) return region;
    }
    return "";
};

/** 카테고리 데이터 파싱 */
export const parseCategory = (categoryData: any): string | null => {
    const categories = parseCategoryList(categoryData);
    return categories[0] || null;
};

/** YouTube 비디오 ID 추출 */
export const extractYouTubeVideoId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

/** YouTube 썸네일 URL 생성 */
export const getYouTubeThumbnailUrl = (url: string): string | null => {
    const videoId = extractYouTubeVideoId(url);
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
};
