
export interface OverseasRegionConfig {
    label: string; // Display Name: 미국(LA)
    country: string; // DB Matching Country: 미국
    keywords: string[]; // DB Matching Address Keywords: ["Los Angeles", "California"]
    center: {
        lat: number;
        lng: number;
        zoom: number;
    };
}

export const OVERSEAS_REGIONS: Record<string, OverseasRegionConfig> = {
    "헝가리(부다페스트)": {
        label: "헝가리(부다페스트)",
        country: "헝가리",
        keywords: ["Budapest", "부다페스트"],
        center: { lat: 47.4979, lng: 19.0402, zoom: 10 }
    },
    "태국(방콕)": {
        label: "태국(방콕)",
        country: "태국",
        keywords: ["Bangkok", "방콕"],
        center: { lat: 13.7563, lng: 100.5018, zoom: 11 }
    },
    "일본(나고야)": {
        label: "일본(나고야)",
        country: "일본",
        keywords: ["Nagoya", "나고야", "Aichi"],
        center: { lat: 35.1815, lng: 136.9066, zoom: 11 }
    },
    "일본(오사카)": {
        label: "일본(오사카)",
        country: "일본",
        keywords: ["Osaka", "오사카"],
        center: { lat: 34.6937, lng: 135.5023, zoom: 11 }
    },
    "일본(삿포로)": {
        label: "일본(삿포로)",
        country: "일본",
        keywords: ["Sapporo", "삿포로", "Hokkaido"],
        center: { lat: 43.0618, lng: 141.3545, zoom: 11 }
    },
    "대만(타이베이)": {
        label: "대만(타이베이)",
        country: "대만",
        keywords: ["Taipei", "타이베이"],
        center: { lat: 25.0330, lng: 121.5654, zoom: 11 }
    },
    "호주(시드니)": {
        label: "호주(시드니)",
        country: "오스트레일리아",
        keywords: ["Sydney", "시드니", "NSW"],
        center: { lat: -33.8688, lng: 151.2093, zoom: 11 }
    },
    "인도네시아(자카르타)": {
        label: "인도네시아(자카르타)",
        country: "인도네시아",
        keywords: ["Jakarta", "자카르타"],
        center: { lat: -6.1754, lng: 106.8272, zoom: 11 }
    },
    "인도네시아(발리)": {
        label: "인도네시아(발리)",
        country: "인도네시아",
        keywords: ["Bali", "발리", "Denpasar", "Ubud"],
        center: { lat: -8.4095, lng: 115.1889, zoom: 9 }
    },
    "미국(LA)": {
        label: "미국(LA)",
        country: "미국",
        keywords: ["Los Angeles", "California", "로스앤젤레스", "캘리포니아"],
        center: { lat: 34.0522, lng: -118.2437, zoom: 11 }
    },
    "미국(뉴욕)": {
        label: "미국(뉴욕)",
        country: "미국",
        keywords: ["New York", "Manhattan", "Brooklyn", "뉴욕", "맨해튼", "브루클린"],
        center: { lat: 40.7128, lng: -74.0060, zoom: 11 }
    },
    "튀르키예(이스탄불)": {
        label: "튀르키예(이스탄불)",
        country: "튀르키예",
        keywords: ["Istanbul", "이스탄불"],
        center: { lat: 41.0082, lng: 28.9784, zoom: 11 }
    }
};

export const OVERSEAS_REGION_LIST = Object.keys(OVERSEAS_REGIONS);
