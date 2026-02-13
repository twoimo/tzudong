/**
 * 마커 클러스터링 유틸리티
 * 
 * Supercluster 기반 고성능 지리공간 클러스터링
 * - KD-Tree 알고리즘으로 대량 마커 처리 최적화
 * - 지역별 동적 maxZoom 설정 지원
 */

import Supercluster from 'supercluster';
import { REGION_MAP_CONFIG } from '@/config/maps';
import type { Restaurant, Region } from '@/types/restaurant';
import { getPerformanceBasedClusterOptions } from './device-performance';

// Supercluster 타입 정의 (패키지에서 export하지 않으므로 직접 정의)
type BBox = [number, number, number, number];
type GeoJsonProperties = Record<string, any>;

/**
 * 클러스터 포인트 속성 인터페이스
 */
export interface ClusterProperties extends GeoJsonProperties {
    restaurantId: string;
    name: string;
    category: string;
    categories?: string[];
    cluster?: boolean;
    point_count?: number;
    point_count_abbreviated?: string | number;
}

/**
 * 레스토랑 GeoJSON Feature 타입
 */
export type RestaurantFeature = GeoJSON.Feature<GeoJSON.Point, ClusterProperties>;

/**
 * 클러스터 설정 옵션
 */
export interface ClusterOptions {
    /** 클러스터 반경 (픽셀) */
    radius?: number;
    /** 최소 줌 레벨 */
    minZoom?: number;
    /** 최대 줌 레벨 (이 줌 이상이면 클러스터링 해제) */
    maxZoom?: number;
    /** 클러스터를 만들기 위한 최소 포인트 수 */
    minPoints?: number;
}

/**
 * 지역별 클러스터링 최대 줌 레벨 계산
 * 
 * [성능 최적화] 줌 12까지 클러스터링을 유지하여 마커 폭발 방지
 * 
 * 특정 지역 선택 시: 해당 지역의 기본 줌 레벨 - 1로 설정하여,
 * 기본 줌 레벨 도달 시 클러스터가 해제되고 모든 개별 마커가 표시됩니다.
 * 
 * 전국 선택 시: 줌 12까지 클러스터링, 줌 13부터 개별 마커
 * 
 * @example
 * // 전국(selectedRegion = null) → maxZoom: 12 (줌 13부터 개별 마커)
 * getClusterMaxZoom(null) // 12
 * 
 * // 서울(zoom: 12) → maxZoom: 11 → 12레벨부터 개별 마커
 * getClusterMaxZoom('서울특별시') // 11
 * 
 * @param selectedRegion 선택된 지역 (null이면 전국)
 * @param defaultMaxZoom 기본 최대 줌 레벨 (전국일 때 사용)
 * @returns 클러스터링 최대 줌 레벨
 */
export const getClusterMaxZoom = (selectedRegion: Region | null, defaultMaxZoom: number = 12): number => {
    // 전국 선택 시 기본값 사용 (줌 12까지 클러스터링)
    if (!selectedRegion) {
        return defaultMaxZoom;
    }

    // 지역 설정이 없으면 기본값 사용
    if (!(selectedRegion in REGION_MAP_CONFIG)) {
        return defaultMaxZoom;
    }

    // 특정 지역 선택 시 해당 지역의 기본 줌 - 1
    const regionConfig = REGION_MAP_CONFIG[selectedRegion as keyof typeof REGION_MAP_CONFIG];
    return regionConfig.zoom - 1;
};

/**
 * [성능 최적화] GeoJSON 변환 캐시
 * WeakMap을 사용하여 동일한 레스토랑 배열에 대한 재변환을 방지
 */
const geoJsonCache = new WeakMap<Restaurant[], RestaurantFeature[]>();

/**
 * 레스토랑 데이터를 GeoJSON Feature로 변환 (캐싱 포함)
 * 
 * @param restaurants 레스토랑 목록
 * @returns GeoJSON Feature 배열
 */
export const restaurantsToGeoJSON = (restaurants: Restaurant[]): RestaurantFeature[] => {
    // 캐시 확인
    const cached = geoJsonCache.get(restaurants);
    if (cached) {
        return cached;
    }

    // 새로 변환
    const features = restaurants
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
            type: 'Feature' as const,
            properties: {
                restaurantId: r.id,
                name: r.name,
                category: (Array.isArray(r.categories) ? r.categories[0] : r.category || '기타') as string,
                categories: r.categories || (r.category ? [r.category] : []),
                // 추가 속성들
                address: r.address,
                reviewCount: r.review_count,
            },
            geometry: {
                type: 'Point' as const,
                coordinates: [r.lng!, r.lat!], // GeoJSON은 [lng, lat] 순서
            },
        })) as RestaurantFeature[];

    // 캐시 저장
    geoJsonCache.set(restaurants, features);

    return features;
};

/**
 * Supercluster 인덱스 생성
 * 
 * [성능 최적화] 디바이스 성능에 따라 동적으로 클러스터 옵션 조정
 * - 저사양: maxZoom 14, radius 60px (더 공격적인 클러스터링)
 * - 중사양: maxZoom 13, radius 50px
 * - 고사양: maxZoom 12, radius 40px (정밀한 클러스터링)
 * 
 * @param selectedRegion 선택된 지역 (동적 maxZoom 계산용, null이면 전국)
 * @param options 클러스터 옵션
 * @param usePerformanceOptimization 성능 기반 최적화 사용 여부 (기본: true)
 * @returns Supercluster 인스턴스
 */
export const createClusterIndex = (
    selectedRegion: Region | null,
    options: ClusterOptions = {},
    usePerformanceOptimization: boolean = true
): Supercluster<ClusterProperties> => {
    // 성능 기반 옵션 가져오기
    const performanceOptions = usePerformanceOptimization
        ? getPerformanceBasedClusterOptions()
        : { maxZoom: 12, radius: 40, minPoints: 2 };

    // maxZoom 결정: 지역별 설정 vs 성능 기반 설정 중 더 높은 값(더 늦게 해제) 사용
    const regionMaxZoom = getClusterMaxZoom(selectedRegion, performanceOptions.maxZoom);
    const finalMaxZoom = options.maxZoom ?? Math.max(regionMaxZoom, performanceOptions.maxZoom);

    return new Supercluster<ClusterProperties>({
        radius: options.radius ?? performanceOptions.radius,
        maxZoom: finalMaxZoom,
        minZoom: options.minZoom ?? 0,
        minPoints: options.minPoints ?? performanceOptions.minPoints,
    });
};

/**
 * 현재 뷰포트의 클러스터 가져오기
 * 
 * @param index Supercluster 인스턴스
 * @param bbox 바운딩 박스 [west, south, east, north]
 * @param zoom 현재 줌 레벨
 * @returns 클러스터/포인트 배열
 */
export const getClusters = (
    index: Supercluster<ClusterProperties>,
    bbox: BBox,
    zoom: number
): Array<Supercluster.ClusterFeature<ClusterProperties> | Supercluster.PointFeature<ClusterProperties>> => {
    return index.getClusters(bbox, Math.floor(zoom)) as Array<Supercluster.ClusterFeature<ClusterProperties> | Supercluster.PointFeature<ClusterProperties>>;
};

/**
 * 클러스터 확장 (클러스터를 개별 포인트로 펼치기)
 * 
 * @param index Supercluster 인스턴스
 * @param clusterId 클러스터 ID
 * @returns 클러스터에 포함된 레스토랑 ID 배열
 */
export const expandCluster = (
    index: Supercluster<ClusterProperties>,
    clusterId: number
): string[] => {
    const leaves = index.getLeaves(clusterId, Infinity);
    return leaves.map((leaf) => leaf.properties.restaurantId);
};

/**
 * 클러스터의 카테고리 목록 가져오기 (애니메이션용)
 * 
 * @param index Supercluster 인스턴스
 * @param clusterId 클러스터 ID
 * @returns 중복 제거된 카테고리 배열
 */
export const getClusterCategories = (
    index: Supercluster<ClusterProperties>,
    clusterId: number
): string[] => {
    const leaves = index.getLeaves(clusterId, Infinity);
    const categoryCounts = new Map<string, number>();

    leaves.forEach((leaf) => {
        const category = leaf.properties.category;
        if (category) {
            categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
        }
    });

    return Array.from(categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((entry) => entry[0]);
};

/**
 * 클러스터인지 개별 포인트인지 판별
 * 
 * @param feature 클러스터 또는 포인트 Feature
 * @returns 클러스터면 true
 */
export const isCluster = (
    feature: Supercluster.ClusterFeature<ClusterProperties> | Supercluster.PointFeature<ClusterProperties>
): feature is Supercluster.ClusterFeature<ClusterProperties> => {
    return feature.properties.cluster === true;
};

/**
 * 클러스터 포인트 개수 가져오기
 * 
 * @param feature 클러스터 Feature
 * @returns 포함된 포인트 개수
 */
export const getClusterCount = (
    feature: Supercluster.ClusterFeature<ClusterProperties>
): number => {
    return feature.properties.point_count || 0;
};

/**
 * 18개 지역 중심 좌표 (행정구역 클러스터링용 - 17개 행정구역 + 울릉도)
 */
export const REGIONAL_CENTERS: Record<string, { lat: number; lng: number }> = {
    "서울특별시": { lat: 37.5512, lng: 126.9882 },
    "부산광역시": { lat: 35.1152, lng: 129.0000 },
    "대구광역시": { lat: 35.8714, lng: 128.6014 },
    "인천광역시": { lat: 37.4496, lng: 126.6231 },
    "광주광역시": { lat: 35.1595, lng: 126.8526 },
    "대전광역시": { lat: 36.3504, lng: 127.3845 },
    "울산광역시": { lat: 35.5384, lng: 129.3114 },
    "세종특별자치시": { lat: 36.4800, lng: 127.2890 },
    "경기도": { lat: 37.4492, lng: 127.1739 },
    "충청북도": { lat: 36.6357, lng: 127.4915 },
    "충청남도": { lat: 36.5184, lng: 126.8000 },
    "전라남도": { lat: 34.8161, lng: 126.4629 },
    "경상북도": { lat: 36.2419, lng: 128.8889 },
    "경상남도": { lat: 35.4606, lng: 128.2132 },
    "전북특별자치도": { lat: 35.7175, lng: 127.1530 },
    "강원특별자치도": { lat: 37.8228, lng: 128.1555 },
    "제주특별자치도": { lat: 33.3625, lng: 126.5339 },
    "울릉도": { lat: 37.4918, lng: 130.8616 },
};

/**
 * 서울특별시 25개 자치구 중심 좌표 (줌 10-12 최적화용)
 */
export const SEOUL_DISTRICT_CENTERS: Record<string, { lat: number; lng: number }> = {
    "강남구": { lat: 37.5172, lng: 127.0473 },
    "강동구": { lat: 37.5301, lng: 127.1238 },
    "강북구": { lat: 37.6396, lng: 127.0257 },
    "강서구": { lat: 37.5509, lng: 126.8497 },
    "관악구": { lat: 37.4784, lng: 126.9516 },
    "광진구": { lat: 37.5385, lng: 127.0823 },
    "구로구": { lat: 37.4954, lng: 126.8874 },
    "금천구": { lat: 37.4568, lng: 126.8952 },
    "노원구": { lat: 37.6542, lng: 127.0568 },
    "도봉구": { lat: 37.6688, lng: 127.0471 },
    "동대문구": { lat: 37.5744, lng: 127.0400 },
    "동작구": { lat: 37.5124, lng: 126.9393 },
    "마포구": { lat: 37.5665, lng: 126.9018 },
    "서대문구": { lat: 37.5791, lng: 126.9368 },
    "서초구": { lat: 37.4837, lng: 127.0324 },
    "성동구": { lat: 37.5633, lng: 127.0371 },
    "성북구": { lat: 37.5891, lng: 127.0182 },
    "송파구": { lat: 37.5145, lng: 127.1066 },
    "양천구": { lat: 37.5169, lng: 126.8660 },
    "영등포구": { lat: 37.5264, lng: 126.8962 },
    "용산구": { lat: 37.5326, lng: 126.9904 },
    "은평구": { lat: 37.6027, lng: 126.9291 },
    "종로구": { lat: 37.5730, lng: 126.9794 },
    "중구": { lat: 37.5641, lng: 126.9970 },
    "중랑구": { lat: 37.6066, lng: 127.0927 },
};

/**
 * 행정구역 클러스터 인터페이스
 */
export interface RegionalCluster {
    /** 행정구역 이름 */
    region: string;
    /** 중심 좌표 */
    center: { lat: number; lng: number };
    /** 해당 지역 맛집 수 */
    count: number;
    /** 해당 지역 맛집 ID 배열 */
    restaurantIds: string[];
    /** 해당 지역 카테고리 배열 (중복 제거) */
    categories: string[];
}

/**
 * 서울 자치구 클러스터 인터페이스 (RegionalCluster 구조 상속)
 */
export type SeoulDistrictCluster = RegionalCluster;

/**
 * 두 좌표 간의 거리 계산 (Haversine formula 간소화)
 */
export const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    return Math.sqrt(dLat * dLat + dLng * dLng);
};

/**
 * 맛집의 주소에서 행정구역 추출
 */
const extractRegionFromAddress = (restaurant: Restaurant): string | null => {
    const address = restaurant.road_address || restaurant.jibun_address || '';

    for (const region of Object.keys(REGIONAL_CENTERS)) {
        if (address.includes(region)) {
            return region;
        }
    }

    // 약어 매핑
    const shortNames: Record<string, string> = {
        "서울": "서울특별시",
        "부산": "부산광역시",
        "대구": "대구광역시",
        "인천": "인천광역시",
        "광주": "광주광역시",
        "대전": "대전광역시",
        "울산": "울산광역시",
        "세종": "세종특별자치시",
        "경기": "경기도",
        "충북": "충청북도",
        "충남": "충청남도",
        "전남": "전라남도",
        "경북": "경상북도",
        "경남": "경상남도",
        "전북": "전북특별자치도",
        "강원": "강원특별자치도",
        "제주": "제주특별자치도",
        "울릉": "울릉도",
    };

    for (const [short, full] of Object.entries(shortNames)) {
        if (address.startsWith(short)) {
            return full;
        }
    }

    return null;
};

/**
 * 가장 가까운 행정구역 중심 찾기
 */
const findNearestRegion = (lat: number, lng: number): string => {
    let nearestRegion = "서울특별시";
    let minDistance = Infinity;

    for (const [region, center] of Object.entries(REGIONAL_CENTERS)) {
        const distance = getDistance(lat, lng, center.lat, center.lng);
        if (distance < minDistance) {
            minDistance = distance;
            nearestRegion = region;
        }
    }

    return nearestRegion;
};

/**
 * 17개 행정구역 중앙 기준 클러스터링 (줌 레벨 8 이하)
 * 
 * 각 맛집을 가장 가까운 행정구역 중심에 할당하여 17개 클러스터 생성
 * 
 * @param restaurants 레스토랑 목록
 * @returns 행정구역별 클러스터 배열
 */
export const getRegionalClusters = (restaurants: Restaurant[]): RegionalCluster[] => {
    // 각 행정구역별로 맛집 그룹화
    const regionMap = new Map<string, {
        restaurantIds: string[];
        categories: Map<string, number>;
    }>();

    // 모든 17개 행정구역 초기화
    for (const region of Object.keys(REGIONAL_CENTERS)) {
        regionMap.set(region, { restaurantIds: [], categories: new Map() });
    }

    // 각 맛집을 행정구역에 할당
    restaurants.forEach((restaurant) => {
        if (!restaurant.lat || !restaurant.lng) return;

        // 1. 주소에서 행정구역 추출 시도
        let region = extractRegionFromAddress(restaurant);

        // 2. 주소에서 찾지 못하면 좌표로 가장 가까운 행정구역 찾기
        if (!region) {
            region = findNearestRegion(restaurant.lat, restaurant.lng);
        }

        const group = regionMap.get(region);
        if (group) {
            group.restaurantIds.push(restaurant.id);

            // 카테고리 추가
            const category = Array.isArray(restaurant.categories)
                ? restaurant.categories[0]
                : (restaurant.category || '기타');
            if (category) {
                const count = group.categories.get(category as string) || 0;
                group.categories.set(category as string, count + 1);
            }
        }
    });

    // 맛집이 있는 행정구역만 클러스터로 반환
    const clusters: RegionalCluster[] = [];

    for (const [region, group] of regionMap.entries()) {
        if (group.restaurantIds.length > 0) {
            clusters.push({
                region,
                center: REGIONAL_CENTERS[region],
                count: group.restaurantIds.length,
                restaurantIds: group.restaurantIds,
                categories: Array.from(group.categories.entries())
                    .sort((a, b) => b[1] - a[1]) // 빈도수 내림차순 정렬
                    .slice(0, 3) // 상위 3개만 추출
                    .map(entry => entry[0]),
            });
        }
    }

    return clusters;
};

/**
 * 서울 자치구 클러스터링 결과 인터페이스
 * clusters: 마커 3개 이상인 구 (클러스터로 표시)
 * individualRestaurants: 마커 2개 이하인 구의 맛집들 (개별 마커로 표시)
 */
export interface SeoulDistrictClusterResult {
    clusters: SeoulDistrictCluster[];
    individualRestaurantIds: string[];
}

/**
 * 서울시 25개 자치구 기준 클러스터링
 * 
 * @param restaurants 레스토랑 목록
 * @param minClusterSize 클러스터로 표시할 최소 마커 수 (기본값: 1)
 *   - minClusterSize=1: 마커가 1개 이상이면 모두 클러스터로 표시 (줌 9-10)
 *   - minClusterSize=3: 마커가 3개 이상일 때만 클러스터, 2개 이하는 개별 마커 (줌 11-12)
 */
export const getSeoulDistrictClusters = (restaurants: Restaurant[], minClusterSize: number = 1): SeoulDistrictClusterResult => {
    const districtMap = new Map<string, {
        restaurantIds: string[];
        categories: Map<string, number>;
        positions: Array<{ lat: number; lng: number }>;
    }>();

    const districtNames = Object.keys(SEOUL_DISTRICT_CENTERS);
    const districtEntries = Object.entries(SEOUL_DISTRICT_CENTERS);

    // 25개 구 초기화
    for (const district of districtNames) {
        districtMap.set(district, { restaurantIds: [], categories: new Map(), positions: [] });
    }

    restaurants.forEach((restaurant) => {
        if (!restaurant.lat || !restaurant.lng) return;

        // 서울 지역만 처리 (주소 체크)
        const address = restaurant.road_address || restaurant.jibun_address || '';
        if (!address.includes('서울')) return;

        // 1. 주소에서 '구' 추출
        let district = null;
        for (const d of districtNames) {
            if (address.includes(d)) {
                district = d;
                break;
            }
        }

        // 2. 주소에 구가 명시되지 않거나 매칭 안되면 거리 기반 (보조)
        if (!district) {
            let minDistance = Infinity;
            for (const [d, center] of districtEntries) {
                const distance = getDistance(restaurant.lat, restaurant.lng, center.lat, center.lng);
                if (distance < minDistance) {
                    minDistance = distance;
                    district = d;
                }
            }
        }

        if (district) {
            const group = districtMap.get(district);
            if (group) {
                group.restaurantIds.push(restaurant.id);
                group.positions.push({ lat: restaurant.lat, lng: restaurant.lng });
                const category = Array.isArray(restaurant.categories)
                    ? restaurant.categories[0]
                    : (restaurant.category || '기타');
                if (category) {
                    const count = group.categories.get(category as string) || 0;
                    group.categories.set(category as string, count + 1);
                }
            }
        }
    });

    const clusters: SeoulDistrictCluster[] = [];
    const individualRestaurantIds: string[] = [];

    for (const [district, group] of districtMap.entries()) {
        if (group.restaurantIds.length >= minClusterSize) {
            // minClusterSize 이상: 실제 마커들의 중심점 계산
            const centerLat = group.positions.reduce((sum, p) => sum + p.lat, 0) / group.positions.length;
            const centerLng = group.positions.reduce((sum, p) => sum + p.lng, 0) / group.positions.length;

            clusters.push({
                region: district,
                center: { lat: centerLat, lng: centerLng },
                count: group.restaurantIds.length,
                restaurantIds: group.restaurantIds,
                categories: Array.from(group.categories.entries())
                    .sort((a, b) => b[1] - a[1]) // 빈도수 내림차순 정렬
                    .slice(0, 3) // 상위 3개만 추출
                    .map(entry => entry[0]),
            });
        } else if (group.restaurantIds.length > 0) {
            // minClusterSize 미만: 개별 마커로 표시
            individualRestaurantIds.push(...group.restaurantIds);
        }
    }

    return { clusters, individualRestaurantIds };
};
