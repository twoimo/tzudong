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
 * 특정 지역 선택 시: 해당 지역의 기본 줌 레벨 - 1로 설정하여,
 * 기본 줌 레벨 도달 시 클러스터가 해제되고 모든 개별 마커가 표시됩니다.
 * 
 * 전국 선택 시: 기본 maxZoom(16) 사용하여 계속 클러스터링
 * 
 * @example
 * // 전국(selectedRegion = null) → maxZoom: 8 (기본값, 9레벨부터 개별 마커)
 * getClusterMaxZoom(null) // 8
 * 
 * // 서울(zoom: 12) → maxZoom: 11 → 12레벨부터 개별 마커
 * getClusterMaxZoom('서울특별시') // 11
 * 
 * // 욕지도(zoom: 14) → maxZoom: 13 → 14레벨부터 개별 마커
 * getClusterMaxZoom('욕지도') // 13
 * 
 * @param selectedRegion 선택된 지역 (null이면 전국)
 * @param defaultMaxZoom 기본 최대 줌 레벨 (전국일 때 사용)
 * @returns 클러스터링 최대 줌 레벨
 */
export const getClusterMaxZoom = (selectedRegion: Region | null, defaultMaxZoom: number = 8): number => {
    // 전국 선택 시 기본값 사용 (계속 클러스터링)
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
 * @param selectedRegion 선택된 지역 (동적 maxZoom 계산용, null이면 전국)
 * @param options 클러스터 옵션
 * @returns Supercluster 인스턴스
 */
export const createClusterIndex = (
    selectedRegion: Region | null,
    options: ClusterOptions = {}
): Supercluster<ClusterProperties> => {
    // maxZoom: options에 명시되어 있으면 사용, 없으면 지역별 동적 계산
    const maxZoom = options.maxZoom ?? getClusterMaxZoom(selectedRegion);

    return new Supercluster<ClusterProperties>({
        radius: options.radius ?? 60, // 기본 60픽셀
        maxZoom: maxZoom,
        minZoom: options.minZoom ?? 0,
        minPoints: options.minPoints ?? 2, // 최소 2개부터 클러스터링
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
    const categories = new Set<string>();

    leaves.forEach((leaf) => {
        const category = leaf.properties.category;
        if (category) {
            categories.add(category);
        }
    });

    return Array.from(categories);
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
