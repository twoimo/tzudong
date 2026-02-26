'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import { usePathname } from "next/navigation";

import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { FilterState } from "@/components/filters/FilterPanel";
import { Restaurant, Region } from "@/types/restaurant";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { useLayout } from "@/contexts/LayoutContext";
import { useDeviceType } from "@/hooks/useDeviceType";
import Supercluster from 'supercluster';
import {
    createClusterIndex,
    restaurantsToGeoJSON,
    getClusters,
    getClusterCategories,
    isCluster,
    getClusterCount,
    getClusterMaxZoom,
    getRegionalClusters,
    type RestaurantFeature,
    type ClusterProperties,
    type RegionalCluster,
    type SeoulDistrictCluster,
    type SeoulDistrictClusterResult,
    getSeoulDistrictClusters,
    SEOUL_DISTRICT_CENTERS,
    getDistance
} from "@/lib/clustering";
import { markerPool } from "@/lib/marker-pool";
import {
    createClusterMarkerHTML,
    createIndividualMarkerHTML,
    clusterAnimationManager,
    injectClusterCSS,
    removeClusterCSS
} from "@/lib/cluster-marker";
import { perfMonitor } from "@/lib/performance-monitor";
import { useMapOptimization } from "@/hooks/useMapOptimization";
import { supabase } from "@/integrations/supabase/client";

// 상수 정의
const PANEL_WIDTH = 400; // 상세 패널 너비 (px)
const ZOOM_DIFF_THRESHOLD = 4; // 즉시 로드할 줌 차이 임계값
const DISTANCE_KM_THRESHOLD = 50; // 즉시 로드할 거리 임계값 (km)

// [성능 최적화] 가시영역 필터링 및 이벤트 처리 상수
const VIEWPORT_FILTER_ENABLED = true; // 가시영역 필터링 활성화
const VIEWPORT_PADDING = 0.05; // 가시영역 여백 (5% 확장)
const PERFORMANCE_LOG_ENABLED = false; // 성능 로깅 활성화 (개발용)

// 클러스터링 상수 (네이버 지도 스타일)
const ENABLE_CLUSTERING = true; // 클러스터링 전체 활성화
const CLUSTER_MAX_ZOOM = 16; // 이 줌 레벨까지 클러스터링 (16 초과 시 모든 개별 마커 표시)
// [OPTIMIZATION] 클러스터 반경, 최소 포인트, 애니메이션은 useMapOptimization 훅에서 동적으로 결정

// [OPTIMIZATION] 서울 경계 확인 헬퍼 (최적화: 컴포넌트 외부로 이동)
// [OPTIMIZATION] 서울 경계 확인 헬퍼 (개선된 로직: 단순 BBox 대신 거리 기반 체크)
const isPointInSeoul = (lat: number, lng: number) => {
    // 1. 단순 BBox로 1차 필터링 (기존보다 약간 좁게 설정하여 확실히 아닌 것 제외)
    // 서울 극단: 37.42 ~ 37.70, 126.76 ~ 127.18
    if (lat < 37.42 || lat > 37.70 || lng < 126.76 || lng > 127.18) {
        return false;
    }

    // 2. 서울 25개 자치구 중심과의 거리 체크 (반경 3.5km 이내면 서울로 간주)
    // 이는 고양, 광명 등 인접 도시가 BBox에 포함되어 숨겨지는 것을 방지함
    for (const center of Object.values(SEOUL_DISTRICT_CENTERS)) {
        if (getDistance(lat, lng, center.lat, center.lng) < 0.035) { // 약 3.5km (1도 ≈ 111km)
            return true;
        }
    }
    return false;
};

interface NaverMapViewProps {
    mapFocusZoom?: number | null; // [New] 강제 줌 레벨
    filters: FilterState;
    selectedRegion: Region | null;
    searchedRestaurant: Restaurant | null;
    selectedRestaurant: Restaurant | null;
    refreshTrigger: number;
    onAdminAddRestaurant?: () => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    isGridMode?: boolean;
    gridSelectedRestaurant?: Restaurant | null; // 그리드 모드에서 각 그리드별 선택된 맛집
    onRestaurantSelect?: (restaurant: Restaurant) => void;
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    onMarkerClick?: (restaurant: Restaurant) => void; // 외부 패널 열기
    externalPanelOpen?: boolean; // 외부에서 패널 열림 상태 제어
    isPanelCollapsed?: boolean; // 패널 접기 상태 (접혀있으면 오프셋 없음)
    isPanelOpen?: boolean; // 외부에서 전달받는 패널 열림 상태 (Centering 용)
    onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;
}

/**
 * 카테고리별 아이콘 매핑
 * 컴포넌트 외부에서 정의하여 불필요한 재생성을 방지합니다.
 */
// 카테고리별 이미지 경로 매핑
const CATEGORY_IMAGE_MAP: Record<string, string> = {
    '고기': '/images/maker-images/meat_bbq.png',
    '치킨': '/images/maker-images/chicken.png',
    '한식': '/images/maker-images/korean.png',
    '중식': '/images/maker-images/chinese.png',
    '일식': '/images/maker-images/cutlet_sashimi.png', // 일식, 돈까스/회 공유
    '양식': '/images/maker-images/western.png',
    '분식': '/images/maker-images/snack_bar.png',
    '카페·디저트': '/images/maker-images/cafe_dessert.png',
    '아시안': '/images/maker-images/asian.png',
    '패스트푸드': '/images/maker-images/fastfood.png',
    '족발·보쌈': '/images/maker-images/pork_feet.png',
    '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
    '피자': '/images/maker-images/pizza.png',
    '찜·탕': '/images/maker-images/stew.png',
    '야식': '/images/maker-images/late_night.png',
    '도시락': '/images/maker-images/lunch_box.png'
};

/**
 * 카테고리 아이콘 반환 함수
 * 
 * @param category 카테고리 문자열 또는 배열
 * @returns 매핑된 이모지 아이콘
 */
/**
 * 카테고리 이미지 경로 반환 함수
 * 
 * @param category 카테고리 문자열 또는 배열
 * @returns 매핑된 이미지 경로 (없을 경우 기본값 없음, 호출처에서 처리)
 */
const getCategoryIsImage = (category: string | string[] | null | undefined): string => {
    if (!category) return '/images/maker-images/korean.png'; // 기본값 (임시)
    const categoryStr = Array.isArray(category) ? category[0] : category;
    return CATEGORY_IMAGE_MAP[categoryStr] || '/images/maker-images/korean.png';
};

/**
 * [OPTIMIZATION] LRU 캐시 구현
 * 메모리 누수 방지를 위한 크기 제한
 */
class LRUCache<K, V> {
    private maxSize: number;
    private cache: Map<K, V>;

    constructor(maxSize: number = 500) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // LRU: 접근한 항목을 맨 뒤로 이동
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        // 이미 존재하면 삭제 후 재추가 (LRU 순서 유지)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        this.cache.set(key, value);

        // 크기 초과 시 가장 오래된 항목 제거
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    get size(): number {
        return this.cache.size;
    }

    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }
}

/**
 * [OPTIMIZATION] HTML 마커 콘텐츠 캐시 (LRU 기반)
 * 각 레스토랑의 선택/비선택 상태별로 HTML을 캐싱하여 재사용
 */
const markerContentCache = new LRUCache<string, string>(500);

/**
 * [OPTIMIZATION] 마커 콘텐츠 생성 함수 - 캐싱 + 스타일 외부화 버전
 * 
 * @param restaurant 레스토랑 정보
 * @param isSelected 선택 여부
 * @returns HTML 문자열 (캐시된 콘텐츠 또는 새로 생성)
 */
const createMarkerContentFn = (restaurant: Restaurant, isSelected: boolean): string => {
    // 캐시 키: "restaurantId-categoryIcon_selected" 또는 "restaurantId-categoryIcon_normal"
    const imagePath = getCategoryIsImage(restaurant.categories || restaurant.category);
    const cacheKey = `${restaurant.id}-${imagePath}_${isSelected ? 'sel' : 'nor'}`;

    // 캐시에서 조회
    if (markerContentCache.has(cacheKey)) {
        return markerContentCache.get(cacheKey)!;
    }

    // 캐시 미스: 새로 생성
    // 이미지 마커: 선택 시 42px, 기본 32px (사이즈 축소)
    const size = isSelected ? 42 : 32;

    // 그림자 효과: 선택 시 더 강하게
    const dropShadow = isSelected
        ? 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 0 2px rgba(255, 255, 255, 0.9))'
        : 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3)) drop-shadow(0 0 0 1px rgba(255, 255, 255, 0.8))';

    const transform = isSelected ? 'scale(1.15) translateY(-5px)' : 'scale(1)';
    // [최적화] 스타일 외부화: animation은 CSS 클래스명만 참조
    const animationClass = isSelected ? 'marker-bounce' : '';
    const zIndex = isSelected ? '100' : '1';

    const content = `
        <div 
            class="${animationClass}"
            style="
                width: ${size}px;
                height: ${size}px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                transform: ${transform};
                filter: ${dropShadow};
                position: relative;
                z-index: ${zIndex};
                user-select: none;
                -webkit-tap-highlight-color: transparent;
            "
            role="button"
            aria-label="${restaurant.name}"
            title="${restaurant.name}"
        >
            <img 
                src="${imagePath}" 
                alt="${restaurant.name}"
                style="
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                "
                draggable="false"
            />
        </div>
    `;

    // 캐시에 저장 (LRU 방지: 최대 1000개로 제한)
    if (markerContentCache.size > 1000) {
        // 가장 오래된 항목 삭제
        const firstKey = markerContentCache.keys().next().value;
        if (firstKey) {
            markerContentCache.delete(firstKey);
        }
    }
    markerContentCache.set(cacheKey, content);

    return content;
};

/**
 * 지도 로딩 상태 표시 컴포넌트
 */
const MapLoadingIndicator = memo(({ isLoaded, style, className }: { isLoaded: boolean, style?: React.CSSProperties, className?: string }) => (
    <div
        style={style}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 ${className || ''}`}
    >
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
        <span className="text-sm font-medium">
            {!isLoaded ? '지도 로딩 중...' : '맛집 검색 중...'}
        </span>
    </div>
));
MapLoadingIndicator.displayName = 'MapLoadingIndicator';

// 맛집 개수 배지 컴포넌트
const RestaurantCountBadge = memo(({ count, style, className }: { count: number, style?: React.CSSProperties, className?: string }) => (
    <div
        style={{ ...style, animation: 'fadeInOut 3s ease-in-out forwards' }}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300 ${className || ''}`}
    >
        <span className="text-sm font-medium">
            🔥 {count}개의 맛집 발견
        </span>
    </div>
));
RestaurantCountBadge.displayName = 'RestaurantCountBadge';

// 동시 접속자 토스트 컴포넌트
const OnlineUsersBadge = memo(({ count, style, className }: { count: number, style?: React.CSSProperties, className?: string }) => (
    <div
        style={{ ...style, animation: 'fadeInOut 4s ease-in-out forwards' }}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300 ${className || ''}`}
    >
        <span className="text-sm font-medium">
            🔥 {count}명이 함께 보는 중
        </span>
    </div>
));
OnlineUsersBadge.displayName = 'OnlineUsersBadge';


// 빈 상태 UI 컴포넌트
const EmptyStateIndicator = memo(() => (
    <div className="bg-card/95 backdrop-blur border border-border rounded-lg px-5 py-3 shadow-lg z-10 flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">
            이 지역에 등록된 맛집이 없습니다
        </span>
    </div>
));
EmptyStateIndicator.displayName = 'EmptyStateIndicator';

/**
 * 디바운스 함수
 * @param func 실행할 함수
 * @param delay 지연 시간 (ms)
 * @returns 디바운스된 함수
 */
const debounce = <T extends (...args: any[]) => any>(func: T, delay: number): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func(...args);
            timeout = null;
        }, delay);
    };
};

/**
 * 가시영역 확장 계산 (필터링 성능 최적화를 위해 한 번만 수행)
 */
const getExtendedBounds = (map: any, padding: number = VIEWPORT_PADDING) => {
    if (!map) return null;
    const bounds = map.getBounds();
    if (!bounds || typeof bounds.getSW !== 'function') return null;

    const sw = bounds.getSW();
    const ne = bounds.getNE();
    const latDiff = ne.lat() - sw.lat();
    const lngDiff = ne.lng() - sw.lng();

    return {
        sw: new window.naver.maps.LatLng(sw.lat() - latDiff * padding, sw.lng() - lngDiff * padding),
        ne: new window.naver.maps.LatLng(ne.lat() + latDiff * padding, ne.lng() + lngDiff * padding)
    };
};

/**
 * 주어진 레스토랑이 현재 지도의 가시 영역 내에 있는지 확인합니다.
 */
const isRestaurantInViewport = (restaurant: Restaurant, extendedBounds: any): boolean => {
    if (!extendedBounds || !restaurant.lat || !restaurant.lng) return true;

    // 네이버 지도 LatLngBounds.hasLatLng 사용 (또는 단순 수치 비교로 최적화 가능)
    const latLng = new window.naver.maps.LatLng(restaurant.lat, restaurant.lng);
    const bounds = new window.naver.maps.LatLngBounds(extendedBounds.sw, extendedBounds.ne);
    return bounds.hasLatLng(latLng);
};

// [Zoom Control] 줌 레벨 <-> 슬라이더 값(0-100) 매핑
const MIN_ZOOM = 6;
const MAX_ZOOM = 18;
const mapZoomToSlider = (zoom: number) => Math.round(((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100);
const sliderToMapZoom = (val: number) => MIN_ZOOM + (val / 100) * (MAX_ZOOM - MIN_ZOOM);

const NaverMapView = memo(({
    mapFocusZoom,
    filters,
    selectedRegion,
    searchedRestaurant,
    selectedRestaurant,
    refreshTrigger,
    onAdminEditRestaurant,
    onRequestEditRestaurant,
    isGridMode = false,
    gridSelectedRestaurant,
    onRestaurantSelect,
    activePanel,
    onPanelClick,
    onMarkerClick,
    externalPanelOpen,
    isPanelCollapsed = false,
    isPanelOpen: propIsPanelOpen,
    onVisibleRestaurantsChange,
}: NaverMapViewProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markersMapRef = useRef<Map<string, any>>(new Map()); // 마커 Map (ID -> Marker)
    const restaurantsRef = useRef<Restaurant[]>([]); // 병합된 레스토랑 데이터 참조
    const previousSearchedRestaurantRef = useRef<Restaurant | null>(null); // 이전 searchedRestaurant 추적
    const detailPanelRef = useRef<HTMLDivElement>(null); // 상세 패널 참조
    const prevPanelOpenRef = useRef<boolean>(false); // 이전 패널 열림 상태 추적 (오프셋 델타 계산용)
    const prevSelectedRestaurantIdRef = useRef<string | null>(null); // 이전 선택된 레스토랑 ID 추적 (동일 마커 재클릭 감지용)
    const prevSidebarOpenRef = useRef<boolean>(true); // 이전 사이드바 열림 상태 추적
    const hasUserMovedMapRef = useRef<boolean>(false); // 사용자가 지도를 직접 움직였는지 추적
    const isInitialLoadFromUrlRef = useRef<boolean>(false); // URL 파라미터로 초기화되었는지 추적 (공유 URL 지원)

    // [Cluster] Supercluster 인덱스 및 클러스터 상태
    const clusterIndexRef = useRef<Supercluster<ClusterProperties> | null>(null);
    const [clusters, setClusters] = useState<Array<Supercluster.ClusterFeature<ClusterProperties> | Supercluster.PointFeature<ClusterProperties>>>([]);
    const [regionalClusters, setRegionalClusters] = useState<RegionalCluster[]>([]); // 17개 행정구역 클러스터
    const [seoulDistrictClusters, setSeoulDistrictClusters] = useState<SeoulDistrictCluster[]>([]); // 줄 9-10: 서울 자치구 25개 모두
    const [seoulDistrictClustersFiltered, setSeoulDistrictClustersFiltered] = useState<SeoulDistrictCluster[]>([]); // 줄 11-12: 마커 3개 이상만
    const [seoulIndividualIds, setSeoulIndividualIds] = useState<string[]>([]); // 줄 11-12: 마커 2개 이하
    const [isClusterMode, setIsClusterMode] = useState(false); // 클러스터 모드 활성화 여부
    const [isRegionalClusterMode, setIsRegionalClusterMode] = useState(false); // 행정구역 클러스터 모드
    const [isSeoulDistrictMode, setIsSeoulDistrictMode] = useState(false); // 서울 자치구 모드
    const clusterMarkersRef = useRef<Map<number | string, any>>(new Map()); // 클러스터 마커 Map

    // 사이드바 상태 가져오기
    const { isSidebarOpen } = useLayout();

    // 디바이스 타입 감지 (모바일/태블릿에서는 오프셋 제거)
    const { isMobileOrTablet } = useDeviceType();

    // [OPTIMIZATION] 디바이스 성능 티어 기반 지도 최적화 설정
    const mapOptimization = useMapOptimization();

    // [OPTIMIZATION] 패널 너비 state - ResizeObserver로 자동 업데이트
    const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);

    // 디바이스별 줌 레벨 조정 함수 (모바일/태블릿은 -2 줌으로 더 넓게, 전국은 기본값 유지)
    const getDeviceAdjustedZoom = useCallback((baseZoom: number, isNational: boolean = false) => {
        // 전국 뷰는 기본값 유지 (이미 적절한 줌 레벨)
        if (isNational) return baseZoom;
        // 모바일/태블릿에서는 화면이 작으므로 -2 줌을 적용하여 더 넓은 뷰 제공
        // 단, 최소 줌 레벨(6)보다 낮아지지 않도록 제한
        return isMobileOrTablet ? Math.max(baseZoom - 2, 6) : baseZoom;
    }, [isMobileOrTablet]);

    // 네이버 지도 API 로드 - LCP 최적화를 위해 lazyOnload 전략 사용
    const { isLoaded, loadError } = useNaverMaps({ autoLoad: true, strategy: 'lazyOnload' });
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [internalPanelOpen, setInternalPanelOpen] = useState(false);
    const [showRestaurantCount, setShowRestaurantCount] = useState(false);
    const [showOnlineUsers, setShowOnlineUsers] = useState(false);
    const [onlineUsersCount, setOnlineUsersCount] = useState(0);
    const [isMapInitialized, setIsMapInitialized] = useState(false);


    // [Fix] 라우트 변경 감지 - 다른 페이지 갔다가 돌아왔을 때 지도 재초기화
    const pathname = usePathname();
    const prevPathnameRef = useRef(pathname);

    useEffect(() => {
        // 라우트가 변경되었고, 현재 라우트가 홈('/')이면 지도 리셋
        if (prevPathnameRef.current !== pathname && pathname === '/') {
            // 지도 인스턴스 및 마커 정리
            if (mapInstanceRef.current) {
                markerPool.clear();
                clusterAnimationManager.clear();
                mapInstanceRef.current = null;
                setIsMapInitialized(false);
            }
        }
        prevPathnameRef.current = pathname;
    }, [pathname]);

    // 지역 변경 시 사용자 지도 이동 플래그 리셋 (지역 재선택 시에도 지도 이동 가능하도록)
    useEffect(() => {
        const handleResetUserMapMovement = () => {
            hasUserMovedMapRef.current = false;
        };

        window.addEventListener('resetUserMapMovement', handleResetUserMapMovement);
        return () => {
            window.removeEventListener('resetUserMapMovement', handleResetUserMapMovement);
        };
    }, []);

    // [OPTIMIZATION] ResizeObserver로 패널 너비 자동 감지
    useEffect(() => {
        const panelElement =
            document.querySelector('[data-panel-type="restaurant-detail"]') ||
            document.getElementById('restaurant-detail-panel') ||
            document.querySelector('.restaurant-detail-panel');

        if (!panelElement) {
            // 패널이 아직 로드되지 않았을 수 있으므로 경고 없이 종료
            return;
        }

        // RAF ID를 저장하여 cleanup 시 취소
        let rafId: number | null = null;

        // ResizeObserver 생성
        const observer = new ResizeObserver((entries) => {
            // 이전 RAF 취소
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }

            // RAF로 배치 처리 (리플로우 최소화)
            rafId = requestAnimationFrame(() => {
                for (const entry of entries) {
                    const newWidth = entry.contentRect.width;
                    setPanelWidth(newWidth);
                }
                rafId = null;
            });
        });

        // Observer 연결
        observer.observe(panelElement);

        // 초기값 설정 (RAF로)
        rafId = requestAnimationFrame(() => {
            const initialWidth = panelElement.getBoundingClientRect().width;
            setPanelWidth(initialWidth);
            rafId = null;
        });

        // 정리
        return () => {
            observer.disconnect();
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
        };
    }, []); // 1회만 실행

    // [OPTIMIZATION] 마커 및 클러스터 애니메이션 스타일 주입 + 클러스터 애니메이션 시작
    useEffect(() => {
        // 클러스터 CSS 주입
        injectClusterCSS();

        // 기존 마커 스타일이 없으면 추가 (cluster-marker.ts와 중복 방지)
        if (!document.getElementById('naver-map-marker-styles')) {
            const style = document.createElement('style');
            style.id = 'naver-map-marker-styles';
            style.textContent = `
                @keyframes marker-bounce {
                    0%, 100% { transform: scale(1.15) translateY(0); }
                    50% { transform: scale(1.15) translateY(-4px); }
                }
                .marker-bounce {
                    animation: marker-bounce 1s ease-in-out infinite;
                }
            `;
            document.head.appendChild(style);
        }

        // 클러스터 애니메이션 시작 (성능 티어에 따라 조건부 실행)
        if (ENABLE_CLUSTERING && mapOptimization.clusterAnimationEnabled) {
            clusterAnimationManager.start(mapOptimization.clusterAnimationInterval);
        }

        // 정리: 컴포넌트 언마운트 시
        return () => {
            markerContentCache.clear();

            // 기존 마커 스타일 제거
            const styleEl = document.getElementById('naver-map-marker-styles');
            if (styleEl) {
                styleEl.remove();
            }

            // 클러스터 CSS 및 애니메이션 정리
            removeClusterCSS();
            clusterAnimationManager.clear();

            // 마커 풀 정리
            markerPool.clear();
        };
    }, []);

    // ... (중략) ...

    // [OPTIMIZATION] 외부에 정의된 함수 참조 사용 - useMemo 오버헤드 제거
    const createMarkerContent = createMarkerContentFn;


    // [커스텀 토스트] 지도 상단 중앙 알림 상태
    const [mapToast, setMapToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null>(null);

    // 커스텀 토스트 표시 함수
    const showMapToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setMapToast({ message, type, isVisible: true });

        // 3초 후 자동 숨김
        setTimeout(() => {
            setMapToast(prev => prev ? { ...prev, isVisible: false } : null);
        }, 3000);
    };

    // UI 오버레이 위치 계산 (지도 중심 보정)
    // 오른쪽 패널이 열려있을 때, 오버레이들을 "남은 지도 영역"의 중앙에 배치하기 위함

    // [중요] 오프셋 계산 로직 개선 (2024-Fix)
    const isInternalMode = !onMarkerClick;
    const isShrinkingLayout = isInternalMode && internalPanelOpen && !isGridMode;
    const isExternalPanelOpen = externalPanelOpen === false;

    // 유효 패널 너비 (오프셋 계산용)
    // 모바일/태블릿에서는 바텀시트가 오버레이되므로 오프셋이 필요 없음
    let effectivePanelOffset = 0;

    if (isMobileOrTablet) {
        effectivePanelOffset = 0; // 모바일/태블릿: 바텀시트 오버레이 방식, 오프셋 없음
    } else if (isShrinkingLayout) {
        effectivePanelOffset = 0; // 컨테이너가 줄어들었으므로 0
    } else if (!isPanelCollapsed && (propIsPanelOpen || isExternalPanelOpen)) {
        effectivePanelOffset = PANEL_WIDTH; // 데스크탑: 오버레이 되었으므로 패널 너비만큼
    }

    const centerOffsetStyle = { left: `calc(50% - ${effectivePanelOffset / 2}px)` };

    // 외부에서 패널 닫기 요청 시 닫기 (externalPanelOpen이 false면 닫기)
    useEffect(() => {
        if (externalPanelOpen === false) {
            setInternalPanelOpen(false);
        }
    }, [externalPanelOpen]);

    // ESC 키로 패널 닫기 (접근성 향상)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && internalPanelOpen && !isGridMode) {
                setInternalPanelOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [internalPanelOpen, isGridMode]);

    // [Helper] 지도 중심 좌표 계산 (오프셋 및 줌 스케일링 적용)
    const getAdjustedCenter = (
        lat: number,
        lng: number,
        targetZoom: number,
        offsetX: number,
        offsetY: number = 0 // [모바일/태블릿] Y축 오프셋 (하단 네비게이션 대응)
    ) => {
        const map = mapInstanceRef.current;
        if (!map || !window.naver) return new window.naver.maps.LatLng(lat, lng);

        try {
            const currentZoom = map.getZoom();
            const projection = map.getProjection();
            const centerLatLng = new window.naver.maps.LatLng(lat, lng);

            // 1. 현재 줌 레벨에서의 오프셋에 해당하는 좌표 Delta 계산
            const centerPoint = projection.fromCoordToOffset(centerLatLng);
            const offsetPoint = new window.naver.maps.Point(
                centerPoint.x + offsetX,
                centerPoint.y + offsetY // Y축 오프셋 추가
            );
            const offsetCenterLatLng = projection.fromOffsetToCoord(offsetPoint);

            const dLat = offsetCenterLatLng.lat() - centerLatLng.lat();
            const dLng = offsetCenterLatLng.lng() - centerLatLng.lng();

            // 2. 줌 레벨 차이에 따른 스케일 팩터 적용
            // 줌이 커지면(확대), 동일한 픽셀 오프셋은 더 작은 좌표 차이를 의미함
            const scale = Math.pow(2, currentZoom - targetZoom);

            const finalLat = centerLatLng.lat() + dLat * scale;
            const finalLng = centerLatLng.lng() + dLng * scale;

            return new window.naver.maps.LatLng(finalLat, finalLng);
        } catch (e) {
            console.error("좌표 계산 실패:", e);
            return new window.naver.maps.LatLng(lat, lng);
        }
    };

    // [Helper] 실시간 뷰포트 오프셋 계산 (ResizeObserver 기반)
    // 패널의 실제 너비를 state로 관리하여 정확한 오프셋 반환
    const getViewportOffset = useCallback((): number => {
        // 모바일/태블릿은 항상 0 (바텀시트가 오버레이)
        if (isMobileOrTablet) return 0;

        // 내부 모드에서 패널이 shrink 모드면 0
        const isIntMode = !onMarkerClick;
        const isShrink = isIntMode && internalPanelOpen && !isGridMode;
        if (isShrink) return 0;

        // 패널이 닫혀있으면 0
        if (isPanelCollapsed) return 0;
        if (!(propIsPanelOpen ?? false) && externalPanelOpen !== false) return 0;

        // [OPTIMIZATION] ResizeObserver로 관리되는 state 반환 (DOM 측정 없음)
        return panelWidth;
    }, [isMobileOrTablet, onMarkerClick, internalPanelOpen, isGridMode, isPanelCollapsed, propIsPanelOpen, externalPanelOpen, panelWidth]);

    // [Helper] 패널 오프셋을 고려한 morph (클러스터 클릭 시 사용)
    // 우측 패널이 열려있을 때 클러스터 중심이 "보이는 영역"의 중앙에 위치하도록 조정
    const morphWithPanelOffset = useCallback((
        targetLat: number,
        targetLng: number,
        targetZoom: number
    ) => {
        const map = mapInstanceRef.current;
        if (!map || !window.naver) return;

        // 패널 오프셋의 절반을 적용하여 보이는 영역 중앙에 배치
        // getAdjustedCenter는 offsetX=0일 때 원본 좌표 반환
        const adjustedCenter = getAdjustedCenter(
            targetLat,
            targetLng,
            targetZoom,
            getViewportOffset() / 2
        );
        map.morph(adjustedCenter, targetZoom);
    }, [getViewportOffset]);

    // [통합] 지도 중심 및 줌 조정 로직
    useEffect(() => {
        if (!mapInstanceRef.current || isGridMode) return;

        // [Fix] URL 파라미터로 초기화된 경우 첫 번째 실행에서 줌 오버라이드 방지
        if (isInitialLoadFromUrlRef.current) {
            isInitialLoadFromUrlRef.current = false; // 플래그 해제 (다음 실행부터는 정상 동작)
            return;
        }

        const map = mapInstanceRef.current;
        const { naver } = window;

        // 1. selection 변경 여부 확인 (Ref와 비교)
        const currentSelectedId = selectedRestaurant?.id || null;
        // 병합된 레스토랑인 경우 이름이나 카테고리도 변경될 수 있지만 ID가 핵심
        // selectedRegion 변경도 확인해야 함

        // 이전 선택 상태와 비교 (간단히 ID나 Region 문자열로 비교)
        // prevSelectedRestaurantIdRef는 marker click 등 다른 곳에서도 쓰일 수 있으니 주의.
        // 여기서는 이 Effect 전용으로 판단 로직을 수행.

        let isSelectionChanged = false;

        // A. 레스토랑 선택 변경 확인
        if (currentSelectedId !== prevSelectedRestaurantIdRef.current) {
            isSelectionChanged = true;
            prevSelectedRestaurantIdRef.current = currentSelectedId;
        }

        // B. 지역 선택 변경 확인 (Ref가 없어서 Effect 내 로컬 변수로는 안됨, 
        // 하지만 selectedRegion 값이 바뀌면 Effect가 실행되므로, 이전에 저장해둔 Ref가 필요함)
        // 여기서는 간단히: "사용자 이동 플래그"를 리셋해야 하는 상황인지 판단.
        // selectedRestaurant이나 selectedRegion이 "명시적으로" 바뀌었을 때만 리셋.
        // 하지만 useEffect는 dependency가 바뀌면 무조건 실행됨.
        // 따라서 "무엇이 바뀌었는지"를 추적해야 함.

        // [Refactor] 명시적인 Dirty Check 대신 의존성 변경 확인
        // selectedRestaurant 또는 selectedRegion이 실제로 변경되었는지 확인합니다.

        // 여기서는 로직 단순화를 위해:
        // 만약 사용자가 이동했다면(hasUserMovedMapRef.current), 
        // 1. "새로운 맛집 선택"이 일어났다면 -> 강제 이동 (사용자 이동 무시)
        // 2. "단순 패널/사이드바 토글"이라면 -> 현재 위치 유지하되 오프셋만 적용

        // Ref에 저장된 값(이전 렌더링 값)과 현재 Props 값을 비교하여 변경 여부 판단
        // 만약 (selectedRestaurant?.id !== prevSelectedRestaurantIdRef.current) -> 선택 변경임.

        // 결론: "선택 변경"일 때만 hasUserMovedMapRef.current = false 처리.

        // **중요**: 위에서 이미 prevSelectedRestaurantIdRef.current를 업데이트 했음 (isSelectionChanged).
        // 지역 변경 체크를 위해 prevSelectRegionRef를 추가하는 대신,
        // 여기서는 "이동해야 하는지" 여부만 결정하면 됨.

        // hasUserMovedMapRef.current = false; // [Delete] 기존의 무조건 리셋 삭제

        if (isSelectionChanged) {
            hasUserMovedMapRef.current = false;
        }

        // 지역 변경 감지 (임시로 변수 사용해 비교 불가, Ref 필요)
        // 하지만 selectedRegion은 보통 null -> 값 -> 값 변경이 드뭄.
        // 일단 selectedRestaurant 위주로 처리.

        // 2. 목표 좌표 및 오프셋 결정
        let targetLat: number;
        let targetLng: number;
        // [UX 개선] 기본 줌 레벨 설정 로직 변경
        let targetZoom: number;
        let isRestaurantSelected = false;

        const currentMapZoom = map.getZoom();

        const urlParams = new URLSearchParams(window.location.search);
        const urlLat = parseFloat(urlParams.get('lat') || '');
        const urlLng = parseFloat(urlParams.get('lng') || '');
        const urlZoom = parseFloat(urlParams.get('z') || '');

        if (selectedRestaurant?.lat && selectedRestaurant?.lng) {
            targetLat = selectedRestaurant.lat;
            targetLng = selectedRestaurant.lng;
            isRestaurantSelected = true;

            if (!isNaN(urlLat) && !isNaN(urlLng) && !isNaN(urlZoom)) {
                // URL에 좌표가 있으면 현재 상태 유지 (이동하지 않음)
                return;
            }

            // [New] 줌 레벨 강제 (북마크 등에서 넘어온 경우)
            if (mapFocusZoom) {
                targetZoom = mapFocusZoom;
            } else {
                targetZoom = currentMapZoom; // 기본적으로는 현재 줌 유지
            }
        } else {
            if (!isNaN(urlLat) && !isNaN(urlLng) && !isNaN(urlZoom)) {
                // URL에 좌표가 있으면 현재 상태 유지 (이동하지 않음)
                return;
            }

            const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
            const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
            targetLat = regionConfig.center[0];
            targetLng = regionConfig.center[1];
            // 디바이스별 줌 레벨 조정 (모바일/태블릿은 -2, 전국은 기본값 유지)
            const isNational = regionKey === "전국";
            targetZoom = getDeviceAdjustedZoom(regionConfig.zoom, isNational);
        }

        // [최적화] 실시간 뷰포트 오프셋 계산
        // DOM 요소의 실제 너비를 측정하여 정확한 중앙 배치
        const effectiveOffset = getViewportOffset();

        // [Note] 패널 상태에 따른 지도 중심 오프셋 계산
        // 우측 패널이 열리면 지도의 "시각적 중심"이 왼쪽으로 이동해야 합니다.
        // 즉, 지도 중심(Center) 좌표를 패널 너비의 절반만큼 오른쪽으로 이동시켜야
        // 타겟(맛집)이 왼쪽 "보이는 영역"의 중앙에 위치하게 됩니다.
        // targetOffsetX = effectiveOffset / 2 (양수 = 오른쪽 이동)
        // 모바일/태블릿에서는 항상 0

        const targetOffsetX = effectiveOffset / 2;

        // [모바일/태블릿] Y축 오프셋 계산 (하단 네비게이션 대응)
        // 하단 네비게이션이 지도 영역을 가리므로, 마커가 "보이는 영역"의 중앙에 위치하도록
        // 지도 중심을 위로 이동시켜야 합니다. (양수 = 위로 이동)
        let targetOffsetY = 0;
        if (isMobileOrTablet) {
            // CSS 변수에서 하단 네비게이션 높이 읽기
            const navHeight = parseFloat(
                getComputedStyle(document.documentElement)
                    .getPropertyValue('--mobile-bottom-nav-height')
            ) || 60; // 기본값 60px

            // 하단 네비게이션 높이의 절반만큼 위로 이동
            // 음수로 설정하여 지도 중심이 위로 이동 (화면 하단의 네비게이션을 피함)
            targetOffsetY = -navHeight / 2;
        }

        // **핵심 로직 변경**
        const currentZoom = map.getZoom();

        // [Case 1] 사용자가 직접 이동했고, 선택 변경이 없는 경우 (User Moved + Layout Change only)
        // -> 현재 보고 있는 시각적 중심(Visual Center)을 유지해야 함.
        // 하지만 "패널이 열리고 닫힘"에 따라 "보이는 영역"이 달라지므로,
        // "현재의 Visual Center"가 "새로운 Layout의 Visual Center"가 되도록 지도 Center를 조정해야 함.
        // 즉, "지리적 위치"를 고정하고 오프셋만 반영.
        if (hasUserMovedMapRef.current && !isSelectionChanged) {
            // 현재 지도의 중심 (이건 Panel 오프셋이 반영된 상태일 수도 있고 아닐 수도 있음)
            // 여기서 중요한 건 "사용자가 보고 있던 그 위치(Lat, Lng)"를 유지하는 것.
            // 사용자가 보고 있던 위치(Visual Center)는 어디인가?
            // 만약 이전에 패널이 열려있었다면, Map Center는 Visual Center보다 오른쪽에 있었을 것임.
            // 만약 패널이 닫혔다면, Map Center == Visual Center 였을 것임.

            // 복잡하게 계산하기보다, "현재 지도의 중심(map.getCenter())"을 기준으로
            // 오프셋 '변화량' 만큼만 이동해주면 됨.
            // 이전 오프셋: prevEffectiveOffset (계산 필요 or Ref 저장 필요 - currentStateRef 에 있음)
            // 현재 오프셋: effectiveOffset

            // 하지만 map.getCenter()는 이미 "틀어진" 상태일 수 있음.
            // 단순하게: "현재 map.getCenter()에 해당하는 지리적 위치"를 
            // "새로운 오프셋 기준"으로 다시 잡아주면 됨?
            // 아니면 map.panBy()를 사용하는 게 나을까?

            // 오프셋 차이
            // const offsetDiff = effectiveOffset - prevOffset;
            // 만약 패널이 열리면 (0 -> 400), offsetDiff = +400.
            // 지도는 왼쪽으로 더 가야 하나 오른쪽으로 더 가야 하나?
            // 패널이 열리면 보이는 영역이 왼쪽으로 쏠림 -> 보고 있던 지점을 왼쪽으로 옮겨야 함? 
            // 아니, 보이는 영역의 중심이 왼쪽으로 이동함.
            // 따라서 지도를 "오른쪽"으로 밀어야 컨텐츠가 왼쪽 창에 보임.
            // 즉 offsetDiff 만큼 Center를 이동시켜야 함. (Pixel 단위)

            // 근데 이걸 정확히 계산하려면 projection 필요.
            // 다행히 getAdjustedCenter가 있음.

            // 1. 현재 중심 가져오기
            const currentMapCenter = map.getCenter();

            // 2. 현재 중심을 기준으로 "새로운 오프셋" 적용
            // 주의: 여기서 "현재 중심"은 이미 이전 오프셋이 적용된 결과물일 수 있음.
            // 하지만 사용자가 'drag'를 했다면 그 상태가 '기준'이 됨.
            // 즉, 사용자가 멈춘 그 화면(Visual View)을 기준으로,
            // 패널이 열리면 -> 컨텐츠가 가려지지 않게 옆으로 비켜줘야 함.
            // 패널이 닫히면 -> 넓어진 화면의 중앙으로 오게 해야 함.

            // 이를 위해선 "이전 오프셋"과 "현재 오프셋"의 차이(Delta)를 구해야 함.
            // currentStateRef.current.effectivePanelOffset 은 "렌더링 직전" 값이 아니라 "지난번 Effect 실행 시" 값임.
            // 따라서 이걸 "이전 값"으로 쓸 수 있음.

            const prevOffset = currentStateRef.current.effectivePanelOffset;
            const deltaOffset = effectiveOffset - prevOffset;

            if (deltaOffset !== 0) {
                // 델타 오프셋의 절반만큼 이동해야 "보이는 중심"이 유지됨?
                // targetOffsetX = effectiveOffset / 2 이므로.
                // deltaX = deltaOffset / 2.

                const deltaX = deltaOffset / 2;

                // 현재 중심(currentMapCenter)을 기준으로 deltaX 만큼 이동한 좌표를 구함
                // getAdjustedCenter(lat, lng, zoom, offsetX) 함수는 
                // "원래좌표"를 "오프셋만큼" 이동시킨 좌표를 반환함.
                // 여기서는 "현재좌표"를 "델타만큼" 이동시켜야 함.

                const newCenter = getAdjustedCenter(currentMapCenter.lat(), currentMapCenter.lng(), currentZoom, deltaX);

                // 부드럽게 이동
                map.panTo(newCenter, { duration: 300, easing: 'easeOutCubic' });
            }
            return;
        }

        // [Case 2] 사용자가 이동하지 않았거나, 새로운 선택이 일어난 경우
        // -> 기존 로직대로 타겟 위치로 이동 및 오프셋 적용

        const latDiff = Math.abs(targetLat - map.getCenter().lat());
        const lngDiff = Math.abs(targetLng - map.getCenter().lng());
        const distanceKm = Math.sqrt(Math.pow(latDiff * 111, 2) + Math.pow(lngDiff * 88, 2));
        const zoomDiff = Math.abs(currentZoom - targetZoom);

        const shouldInstantLoad = zoomDiff >= ZOOM_DIFF_THRESHOLD || distanceKm >= DISTANCE_KM_THRESHOLD;

        // 리사이즈 먼저 트리거
        naver.maps.Event.trigger(map, 'resize');

        const moveMap = () => {
            // [Helper 사용] 조정된 중심 좌표 계산 (X축, Y축 오프셋 모두 적용)
            const newCenterLatLng = getAdjustedCenter(targetLat, targetLng, targetZoom, targetOffsetX, targetOffsetY);

            if (shouldInstantLoad) {
                map.setZoom(targetZoom);
                map.setCenter(newCenterLatLng);
            } else {
                // 애니메이션 제거: 즉시 이동 (마커 가운데 정렬 유지)
                map.setZoom(targetZoom);
                map.setCenter(newCenterLatLng);
            }
        };

        moveMap();

        // [FIX] 트랜지션 완료 후 resize만 트리거 (moveMap 중복 호출 제거 - ResizeObserver가 처리함)
        const transitionTimer = setTimeout(() => {
            naver.maps.Event.trigger(map, 'resize');
        }, 320);

        // 사용자 상호작용 감지 리스너 추가
        // Naver Maps API 이벤트뿐만 아니라 DOM 이벤트도 감지하여 더 정확하게 처리 (휠 줌, 더블 클릭 등)
        const handleUserInteraction = () => {
            hasUserMovedMapRef.current = true;
        };

        const mapElement = mapRef.current;
        if (mapElement) {
            // 캡처링 단계에서 이벤트 감지 (지도 내부 로직보다 먼저 실행)
            mapElement.addEventListener('wheel', handleUserInteraction, { capture: true, passive: true });
            mapElement.addEventListener('mousedown', handleUserInteraction, { capture: true, passive: true });
            mapElement.addEventListener('touchstart', handleUserInteraction, { capture: true, passive: true });
        }

        const dragListener = naver.maps.Event.addListener(map, 'dragstart', handleUserInteraction);
        const pinchListener = naver.maps.Event.addListener(map, 'pinchstart', handleUserInteraction);

        return () => {
            clearTimeout(transitionTimer);
            naver.maps.Event.removeListener(dragListener);
            naver.maps.Event.removeListener(pinchListener);

            if (mapElement) {
                mapElement.removeEventListener('wheel', handleUserInteraction, { capture: true, passive: true } as any);
                mapElement.removeEventListener('mousedown', handleUserInteraction, { capture: true, passive: true } as any);
                mapElement.removeEventListener('touchstart', handleUserInteraction, { capture: true, passive: true } as any);
            }
        };

    }, [
        selectedRestaurant,
        selectedRegion,
        externalPanelOpen,
        isPanelCollapsed,
        isMapInitialized,
        propIsPanelOpen,
        internalPanelOpen, // 패널 열림/닫힘 시 중심 재조정
        isGridMode,
        onMarkerClick,
        isSidebarOpen // 사이드바 토글 시에도 중심 재조정 로직 실행
    ]);

    // 리사이즈 시 참조할 최신 상태 Ref 업데이트
    const currentStateRef = useRef({
        isSidebarOpen,
        externalPanelOpen,
        isPanelCollapsed,
        isGridMode,
        effectivePanelOffset: 0 // 초기값
    });

    useEffect(() => {
        currentStateRef.current = {
            isSidebarOpen,
            externalPanelOpen,
            isPanelCollapsed,
            isGridMode,
            effectivePanelOffset // 계산된 오프셋 저장
        };
    }, [isSidebarOpen, externalPanelOpen, isPanelCollapsed, isGridMode, effectivePanelOffset]);

    // [개선] ResizeObserver를 사용하여 컨테이너 크기 변경 감지 및 부드러운 중심 유지
    useEffect(() => {
        if (!mapRef.current || !mapInstanceRef.current || !isMapInitialized) return;

        const map = mapInstanceRef.current;
        const { naver } = window;

        const handleResize = () => {
            if (currentStateRef.current.isGridMode) {
                naver.maps.Event.trigger(map, 'resize');
                return;
            }

            // 1. 지도 리사이즈 트리거
            naver.maps.Event.trigger(map, 'resize');

            // 사용자가 지도를 직접 움직였다면 중심 재조정 하지 않음
            if (hasUserMovedMapRef.current) {
                return;
            }

            // 2. 목표 좌표 결정
            let targetLat: number;
            let targetLng: number;

            if (selectedRestaurant?.lat && selectedRestaurant?.lng) {
                targetLat = selectedRestaurant.lat;
                targetLng = selectedRestaurant.lng;
            } else {
                // [Fix] URL 파라미터가 있으면 현재 상태 유지 (공유 URL 시나리오)
                const urlParams = new URLSearchParams(window.location.search);
                const urlLat = parseFloat(urlParams.get('lat') || '');
                const urlLng = parseFloat(urlParams.get('lng') || '');
                const urlZoom = parseFloat(urlParams.get('z') || '');

                if (!isNaN(urlLat) && !isNaN(urlLng) && !isNaN(urlZoom)) {
                    return; // URL 좌표 있으면 이동하지 않음
                }

                const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
                const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
                targetLat = regionConfig.center[0];
                targetLng = regionConfig.center[1];
            }

            // 3. 현재 상태 기반 오프셋 계산 (실시간)
            // 주의: sidebarWidth는 CSS 애니메이션 중에는 정확하지 않을 수 있음 (컴포넌트 state 기준이므로)
            // 하지만 우리가 원하는 것은 "최종 상태"가 아니라 "현재 보이는 컨테이너의 중심"에 맞추는 것.
            // 네이버 지도의 'resize' 이벤트는 컨테이너 크기에 맞춰 지도 뷰포트를 업데이트함.
            // 문제는, 단순히 resize만 하면 중심(LatLng)은 유지되지만, 
            // 우리가 원하는 '오프셋이 적용된 중심'은 컨테이너 크기가 변함에 따라 계속 변해야 함.

            // 패널 상태
            const { externalPanelOpen, isPanelCollapsed } = currentStateRef.current;
            const isExternalPanelOpen = externalPanelOpen === false;

            // 여기서는 Ref에 'effectivePanelOffset'을 저장해서 가져오는 방식으로 변경.
            const { effectivePanelOffset } = currentStateRef.current;
            const rightPanelWidth = effectivePanelOffset;

            // 사이드바 너비 - 여기서는 논리적 너비(state)를 사용하지만, 
            // 실제 중심점 계산은 "남은 공간"의 중앙이어야 함.
            // map.getSize()를 사용하면 현재 지도 컨테이너의 픽셀 크기를 알 수 있음.
            const mapSize = map.getSize();
            const mapWidth = mapSize.width; // 현재 지도 너비 (사이드바 제외한 나머지)

            // 우리가 원하는 마커의 위치:
            // 지도 왼쪽 끝에서 (mapWidth - rightPanelWidth) / 2 지점
            // 즉, "지도 전체 너비에서 우측 패널 뺀 나머지 영역"의 중앙.

            // 네이버 지도 중심(Center)은 mapWidth / 2 지점임.
            // 따라서 오프셋 = (mapWidth / 2) - ((mapWidth - rightPanelWidth) / 2)
            //             = (mapWidth - (mapWidth - rightPanelWidth)) / 2
            //             = rightPanelWidth / 2

            // 결론: 사이드바 너비는 이미 지도 컨테이너 크기에 반영되어 있으므로 계산식에서 빠져야 함!
            // 이전 로직의 targetOffsetX = (rightPanelWidth - sidebarWidth) / 2 는 
            // 뷰포트 전체(window) 기준이 아니라면 틀렸을 수도 있음. 
            // NaverMapView는 flex-1이므로, 부모(MainLayout)에서 마진(margin-left)으로 사이드바 공간을 뺌.
            // 즉 mapRef.current의 width는 이미 (Window - Sidebar)임.
            // 따라서 지도 컨테이너 내부에서의 중심 오프셋은 **rightPanelWidth / 2** 만 있으면 됨.

            const targetOffsetX = rightPanelWidth / 2;

            // [모바일/태블릿] Y축 오프셋 계산 (ResizeObserver에서도 동일하게 적용)
            let targetOffsetY = 0;
            if (isMobileOrTablet) {
                const navHeight = parseFloat(
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--mobile-bottom-nav-height')
                ) || 60;
                targetOffsetY = -navHeight / 2;
            }

            // [Helper 사용] 현재 줌 레벨 유지
            const currentZoom = map.getZoom();
            const newCenterLatLng = getAdjustedCenter(targetLat, targetLng, currentZoom, targetOffsetX, targetOffsetY);

            // 애니메이션 없이 즉시 이동 (부드러움 유지)
            map.setCenter(newCenterLatLng);
        };

        // [FIX] 디바운스 추가: CSS 트랜지션(300ms) 완료 후에만 중심 재조정
        let resizeDebounceTimer: NodeJS.Timeout | null = null;

        const resizeObserver = new ResizeObserver(() => {
            // 기존 타이머가 있으면 취소
            if (resizeDebounceTimer) {
                clearTimeout(resizeDebounceTimer);
            }

            // 즉시 resize 이벤트 트리거 (지도 타일 로딩을 위해)
            naver.maps.Event.trigger(map, 'resize');

            // 중심 재조정은 트랜지션 완료 후에만 수행 (320ms 후)
            resizeDebounceTimer = setTimeout(() => {
                requestAnimationFrame(handleResize);
            }, 320);
        });

        resizeObserver.observe(mapRef.current);

        return () => {
            resizeObserver.disconnect();
            if (resizeDebounceTimer) {
                clearTimeout(resizeDebounceTimer);
            }
        };
    }, [isMapInitialized, selectedRestaurant, selectedRegion]);

    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동
    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동 (디바운스 적용)
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        let resizeTimer: NodeJS.Timeout;

        const handleWindowResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const map = mapInstanceRef.current;
                if (map) {
                    naver.maps.Event.trigger(map, 'resize');
                    // 리사이즈 후 중심 재조정 로직이 필요하다면 통합 useEffect가 prop이나 state 변경에 반응할 것임
                    // 하지만 state 변경 없이 창 크기만 변했을 때는 여기서 처리가 필요할 수도 있음.
                    // 현재는 'resize' 트리거만으로도 네이버 지도가 어느정도 중심을 유지함.
                }
            }, 100); // 100ms 디바운스
        };

        window.addEventListener('resize', handleWindowResize, { passive: true });
        return () => {
            window.removeEventListener('resize', handleWindowResize, { passive: true } as any);
            clearTimeout(resizeTimer);
        };
    }, []);

    // useRestaurants 옵션 메모이제이션
    const restaurantQueryOptions = useMemo(() => ({
        category: filters.categories.length > 0 ? filters.categories : undefined,
        region: selectedRegion || undefined,
        minReviews: filters.minReviews,
        enabled: isLoaded,
    }), [filters.categories, filters.minReviews, selectedRegion, isLoaded]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants(restaurantQueryOptions);

    // 지역 변경 시 로딩 중에도 이전 마커를 유지하기 위한 상태
    const [previousRestaurants, setPreviousRestaurants] = useState<Restaurant[]>([]);

    // restaurants가 변경될 때 이전 데이터를 저장하고, 개수 표시를 3초간 활성화
    useEffect(() => {
        if (restaurants.length > 0 && !isLoadingRestaurants) {
            setPreviousRestaurants(restaurants);

            // 맛집 개수가 있을 때만 배지 표시 및 타이머 설정
            setShowRestaurantCount(true);
            const timer = setTimeout(() => {
                setShowRestaurantCount(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [restaurants, isLoadingRestaurants]);

    // 동시 접속자 추적을 위한 ref (useEffect 의존성 문제 방지)
    const onlineUsersCountRef = useRef(onlineUsersCount);
    const showRestaurantCountRef = useRef(showRestaurantCount);
    const hasShownInitialToastRef = useRef(false);
    const initialTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => { onlineUsersCountRef.current = onlineUsersCount; }, [onlineUsersCount]);
    useEffect(() => { showRestaurantCountRef.current = showRestaurantCount; }, [showRestaurantCount]);

    // 동시 접속자 추적 (Supabase Presence) 및 주기적 토스트 표시
    useEffect(() => {
        if (!isLoaded) return;

        // [중요] Strict Mode에서 재마운트 시 ref 초기화
        hasShownInitialToastRef.current = false;

        // 토스트 표시 함수
        const showOnlineToast = () => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            setShowOnlineUsers(true);
            hideTimerRef.current = setTimeout(() => setShowOnlineUsers(false), 4000);
        };

        // Supabase Presence 채널 구독
        const channel = supabase.channel('map-online-users')
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const uniqueUserIds = new Set<string>();
                Object.entries(state).forEach(([presenceKey, presences]) => {
                    (presences as any[]).forEach((presence: any) => {
                        uniqueUserIds.add(presence.user_id || presence.presence_ref || presenceKey);
                    });
                });
                const count = uniqueUserIds.size;
                setOnlineUsersCount(count);
                onlineUsersCountRef.current = count;

                // 첫 번째 sync 후 5초 뒤에 토스트 표시
                if (!hasShownInitialToastRef.current) {
                    hasShownInitialToastRef.current = true;
                    if (initialTimerRef.current) clearTimeout(initialTimerRef.current);
                    initialTimerRef.current = setTimeout(showOnlineToast, 5000);
                }
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: `map-user-${Math.random().toString(36).slice(2)}`,
                        online_at: new Date().toISOString(),
                    });
                }
            });

        // 90초마다 동시 접속자 토스트 표시
        const interval = setInterval(showOnlineToast, 90000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(interval);
            if (initialTimerRef.current) clearTimeout(initialTimerRef.current);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, [isLoaded]); // isLoaded만 의존성으로

    // 표시할 마커 데이터 (로딩 중에는 이전 데이터를 사용) - 메모이제이션
    const displayRestaurants = useMemo(() => {
        return isLoadingRestaurants && previousRestaurants.length > 0 ? previousRestaurants : restaurants;
    }, [isLoadingRestaurants, previousRestaurants, restaurants]);

    const visibleRestaurantsForSwipe = useMemo(() => {
        const restaurantsForSwipe = [...displayRestaurants];

        if (searchedRestaurant) {
            const alreadyExists = restaurantsForSwipe.some((restaurant) => restaurant.id === searchedRestaurant.id);
            if (!alreadyExists) {
                restaurantsForSwipe.push(searchedRestaurant);
            }
        }

        const uniqueRestaurants = new Map<string, Restaurant>();
        restaurantsForSwipe.forEach((restaurant) => {
            uniqueRestaurants.set(restaurant.id, restaurant);
        });

        return [...uniqueRestaurants.values()];
    }, [displayRestaurants, searchedRestaurant]);

    useEffect(() => {
        if (onVisibleRestaurantsChange) {
            onVisibleRestaurantsChange(visibleRestaurantsForSwipe);
        }
    }, [visibleRestaurantsForSwipe, onVisibleRestaurantsChange]);

    // [Cluster] 클러스터 인덱스 생성 및 업데이트
    useEffect(() => {


        if (!ENABLE_CLUSTERING || displayRestaurants.length === 0) {
            if (clusterIndexRef.current) {

                setClusters([]);
                clusterIndexRef.current = null;
            }
            return;
        }

        // [Fix] 지도가 초기화되지 않았으면 대기 (isMapInitialized 의존성으로 재실행됨)
        if (!isMapInitialized || !mapInstanceRef.current) {
            return;
        }

        // GeoJSON 변환
        const geoJsonPoints = restaurantsToGeoJSON(displayRestaurants);

        // 클러스터 인덱스 생성 (지역별 동적 maxZoom, 성능 티어별 반경)
        // 현재 줌 레벨을 가져와서 동적 반경 계산
        const currentZoom = mapInstanceRef.current.getZoom();
        const clusterRadius = mapOptimization.getClusterRadius(currentZoom);

        const index = createClusterIndex(selectedRegion, {
            radius: clusterRadius,
            minPoints: mapOptimization.clusterMinPoints,
        });

        // 데이터 로드
        index.load(geoJsonPoints);
        clusterIndexRef.current = index;

        // 초기 클러스터 계산
        const map = mapInstanceRef.current;
        // 줌 레벨 2단위로 묶기 (7,8 → 8, 9,10 → 10, 11,12 → 12)
        const zoom = Math.floor(map.getZoom() / 2) * 2;

        // bounds 가져오기
        let bbox: [number, number, number, number];
        const mapBounds = map.getBounds();

        if (mapBounds && typeof mapBounds.getWest === 'function') {
            bbox = [
                mapBounds.getWest(),
                mapBounds.getSouth(),
                mapBounds.getEast(),
                mapBounds.getNorth(),
            ];
        } else {
            // bounds가 아직 초기화되지 않은 경우 - 전체 한국 영역 사용
            bbox = [124, 33, 132, 43]; // 한국 전체 영역 (서-남-동-북)
        }

        const newClusters = getClusters(index, bbox, zoom);
        setClusters(newClusters);

        // 17개 행정구역 클러스터도 계산
        const newRegionalClusters = getRegionalClusters(displayRestaurants);
        setRegionalClusters(newRegionalClusters);

        // 서울 25개 자치구 클러스터 계산 (두 가지 모드)
        // 줌 9-10: 모든 구를 클러스터로 (minClusterSize=1)
        const seoulResultAll = getSeoulDistrictClusters(displayRestaurants, 1);
        setSeoulDistrictClusters(seoulResultAll.clusters);

        // 줌 11-12: 마커 3개 이상만 클러스터, 2개 이하는 개별 마커 (minClusterSize=3)
        const seoulResultFiltered = getSeoulDistrictClusters(displayRestaurants, 3);
        setSeoulDistrictClustersFiltered(seoulResultFiltered.clusters);
        setSeoulIndividualIds(seoulResultFiltered.individualRestaurantIds);
    }, [displayRestaurants.length, selectedRegion, isMapInitialized]);

    // [Cluster] 지도 이동/줌 시 클러스터 업데이트
    useEffect(() => {
        // [Fix] 지도가 초기화되지 않았으면 대기
        if (!isMapInitialized || !mapInstanceRef.current || !ENABLE_CLUSTERING || !clusterIndexRef.current) return;

        const { naver } = window;

        const updateClusters = () => {
            if (!clusterIndexRef.current || !mapInstanceRef.current) return;

            const map = mapInstanceRef.current;
            // 줌 레벨 2단위로 묶기 (7,8 → 8, 9,10 → 10, 11,12 → 12)
            const zoom = Math.floor(map.getZoom() / 2) * 2;



            let bbox: [number, number, number, number];

            // 먼저 getBounds() 시도
            const updateBounds = map.getBounds();

            if (updateBounds && typeof updateBounds.getWest === 'function') {
                // getBounds() 성공
                bbox = [
                    updateBounds.getWest(),
                    updateBounds.getSouth(),
                    updateBounds.getEast(),
                    updateBounds.getNorth(),
                ];
            } else {
                // getBounds() 실패 - center와 zoom으로 계산
                const center = map.getCenter();
                if (!center) {
                    console.error('[지도 이동/줌] center도 가져올 수 없음');
                    return;
                }

                // zoom 레벨에 따른 대략적인 거리 계산 (미터)
                const metersPerPixelAtZoom = 156543.03392 * Math.cos(center.lat() * Math.PI / 180) / Math.pow(2, zoom);
                const mapWidthPixels = 1000; // 대략적인 지도 너비
                const mapHeightPixels = 800;  // 대략적인 지도 높이

                const metersWidth = metersPerPixelAtZoom * mapWidthPixels;
                const metersHeight = metersPerPixelAtZoom * mapHeightPixels;

                // 위도 1도 ≈ 111km, 경도 1도 ≈ 111km * cos(lat)
                const latDelta = (metersHeight / 2) / 111000;
                const lngDelta = (metersWidth / 2) / (111000 * Math.cos(center.lat() * Math.PI / 180));

                bbox = [
                    center.lng() - lngDelta, // west
                    center.lat() - latDelta, // south
                    center.lng() + lngDelta, // east
                    center.lat() + latDelta, // north
                ];

            }

            const newClusters = getClusters(clusterIndexRef.current, bbox, zoom);
            setClusters(newClusters);
        };

        const map = mapInstanceRef.current;
        // idle 이벤트: 모든 지도 애니메이션 완료 후 실행 (성능 티어별 디바운스)
        const debouncedUpdateClusters = debounce(updateClusters, mapOptimization.idleDebounceMs);
        const idleListener = naver.maps.Event.addListener(map, 'idle', debouncedUpdateClusters);

        return () => {
            naver.maps.Event.removeListener(idleListener);
        };
    }, [displayRestaurants, isMapInitialized]);



    // [Render] 줌 레벨에 따라 클러스터 또는 개별 마커 렌더링
    useEffect(() => {
        // [Init] 지도가 초기화되지 않았으면 대기
        if (!isMapInitialized || !mapInstanceRef.current || !window.naver) return;
        const { naver } = window;
        const map = mapInstanceRef.current;
        const currentZoom = Math.floor(map.getZoom());

        // [OPTIMIZATION] 가시영역 확장 계산 (한 번만 수행)
        const extendedBounds = getExtendedBounds(map);

        // [PERFORMANCE] 렌더링 시작 시간 측정
        perfMonitor.startMeasure('RenderMarkers');

        // 전국 뷰일 때만 클러스터링 적용 (특정 지역 선택 시 개별 마커)
        const effectiveMaxZoom = getClusterMaxZoom(selectedRegion);
        const shouldCluster = ENABLE_CLUSTERING && !selectedRegion && currentZoom <= effectiveMaxZoom;

        // [Logic] 줌 8 이하에서는 17개 행정구역 중앙 클러스터링 사용
        // [Fix] 사용자가 기능 동작을 원하므로 다시 활성화
        let shouldUseRegionalCluster = shouldCluster && currentZoom <= 8;

        // [Logic] 서울 자치구 클러스터링 (줌 9-12에서 활성화)
        // 줌 9-10: 모든 자치구 25개를 클러스터로 표시 (seoulDistrictClusters 사용)
        // 줌 11-12: 마커 3개 이상만 클러스터, 2개 이하는 개별 마커 (seoulDistrictClustersFiltered 사용)
        const shouldUseSeoulDistrictFull = !shouldUseRegionalCluster && (currentZoom >= 9 && currentZoom <= 10);
        const shouldUseSeoulDistrictFiltered = !shouldUseRegionalCluster && (currentZoom >= 11 && currentZoom <= 12);
        const shouldUseSeoulDistrictCluster = shouldUseSeoulDistrictFull || shouldUseSeoulDistrictFiltered;

        // 모드 설정

        if (shouldUseRegionalCluster) {
            setIsRegionalClusterMode(true);
            setIsSeoulDistrictMode(false);
            setIsClusterMode(true);
        } else if (shouldUseSeoulDistrictCluster) {
            // [Fix] 서울 자치구 모드: Supercluster 비활성화로 충돌 방지
            setIsRegionalClusterMode(false);
            setIsSeoulDistrictMode(true);
            setIsClusterMode(false);
        } else {
            // 일반 Supercluster 모드 또는 개별 마커 모드
            setIsRegionalClusterMode(false);
            setIsSeoulDistrictMode(false);
            setIsClusterMode(shouldCluster);
        }

        // 헬퍼: 클러스터 마커 렌더링 (중복 로직 제거)
        const renderClusterHelper = (
            markerId: string,
            position: { lat: number, lng: number },
            count: number,
            categories: string[],
            uniqueKey: string | number,
            onClick: () => void
        ) => {
            let hash: number;
            if (typeof uniqueKey === 'string') {
                hash = Math.abs(uniqueKey.split('').reduce((a, b) => (a * 31 + b.charCodeAt(0)) | 0, 0));
            } else {
                hash = uniqueKey;
            }

            clusterAnimationManager.register(hash);
            const currentIndex = clusterAnimationManager.getCurrentIndex(hash, categories.length);

            const fakeFeature = {
                properties: { point_count: count },
                geometry: { coordinates: [position.lng, position.lat] }
            } as any;
            const html = createClusterMarkerHTML(fakeFeature, categories, currentIndex);

            markerPool.acquire(
                markerId,
                new naver.maps.LatLng(position.lat, position.lng),
                { content: html, anchor: new naver.maps.Point(24, 24) },
                map,
                onClick
            );
        };

        if (shouldUseRegionalCluster) {
            // ===== 17개 행정구역 중앙 클러스터 모드 =====
            if (regionalClusters.length === 0) {
                return;
            }
            const activeIds = new Set<string>();

            regionalClusters.forEach((cluster) => {
                const markerId = `regional-${cluster.region}`;
                activeIds.add(markerId);

                renderClusterHelper(
                    markerId,
                    cluster.center,
                    cluster.count,
                    cluster.categories,
                    cluster.region,
                    () => {
                        // [Fix] 서울 자치구처럼 단계별 줌인 (현재 줌 +2) + 패널 오프셋 적용
                        const currentZoom = map.getZoom();
                        const targetZoom = Math.min(currentZoom + 2, 9);
                        morphWithPanelOffset(cluster.center.lat, cluster.center.lng, targetZoom);
                    }
                );
            });

            // 사용하지 않는 마커 반환
            markerPool.releaseExcept(activeIds);

        } else {
            // ===== 복합 모드: 서울 자치구 (선택적) + Supercluster/개별 마커 =====
            const activeIds = new Set<string>();

            // 1. 서울 자치구 클러스터 (우선 순위 레이어)
            // 줌 9-10: 모든 자치구 25개 클러스터 (seoulDistrictClusters)
            // 줌 11-12: 마커 3개 이상인 구만 클러스터 (seoulDistrictClustersFiltered)
            const seoulClustersToRender = shouldUseSeoulDistrictFull
                ? seoulDistrictClusters
                : (shouldUseSeoulDistrictFiltered ? seoulDistrictClustersFiltered : []);

            if (seoulClustersToRender.length > 0) {
                seoulClustersToRender.forEach((cluster) => {
                    const markerId = `seoul-dist-${cluster.region}`;
                    activeIds.add(markerId);

                    renderClusterHelper(
                        markerId,
                        cluster.center,
                        cluster.count,
                        cluster.categories,
                        cluster.region,
                        () => {
                            // [Fix] 단계별 줌인: 9→11→13 + 패널 오프셋 적용
                            const currentZoom = map.getZoom();
                            let targetZoom = 13;
                            if (currentZoom <= 10) {
                                targetZoom = 11;
                            } else if (currentZoom <= 12) {
                                targetZoom = 13;
                            }
                            morphWithPanelOffset(cluster.center.lat, cluster.center.lng, targetZoom);
                        }
                    );
                });
            }

            // 1-2. 서울 자치구 개별 마커 (줌 11-12에서만, 마커 2개 이하인 구)
            if (shouldUseSeoulDistrictFiltered && seoulIndividualIds.length > 0) {
                const seoulIndividualSet = new Set(seoulIndividualIds);
                displayRestaurants.forEach((restaurant) => {
                    if (!seoulIndividualSet.has(restaurant.id)) return;
                    if (!restaurant.lat || !restaurant.lng) return;

                    activeIds.add(restaurant.id);
                    const isSelected = selectedRestaurant?.id === restaurant.id;
                    const category = (Array.isArray(restaurant.categories) ? restaurant.categories[0] : restaurant.category || '기타') as string;
                    const html = createIndividualMarkerHTML(category, isSelected);

                    markerPool.acquire(
                        restaurant.id,
                        new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                        { content: html, anchor: new naver.maps.Point(isSelected ? 18 : 14, isSelected ? 18 : 14) },
                        map,
                        () => {
                            hasUserMovedMapRef.current = false;
                            if (onMarkerClick) onMarkerClick(restaurant);
                            else {
                                if (onRestaurantSelect) onRestaurantSelect(restaurant);
                                setInternalPanelOpen(true);
                            }
                        }
                    );
                });
            }


            // 2. 표준 로직 (Supercluster 또는 개별 마커)
            // [Fix] 서울 자치구 모드에서도 서울 외 지역은 Supercluster로 표시
            if (shouldCluster || shouldUseSeoulDistrictCluster) {
                if (clusters.length > 0) {
                    clusters.forEach((feature) => {
                        const [lng, lat] = feature.geometry.coordinates;

                        // [CRITICAL Logic] Seoul District Mode가 켜져있고, 이 마커/클러스터가 서울 안에 있다면 건너뜀
                        // (이미 Seoul District Cluster로 표현되었으므로 중복 렌더링 방지)
                        if (shouldUseSeoulDistrictCluster) {
                            // 1. 주소가 있는 경우 (개별 마커) - 주소 기반 확실한 체크
                            if (feature.properties.address) {
                                // 주소에 '서울'이 포함되어 있으면 숨김 (이미 District Cluster로 표시됨)
                                // 반대로 '경기', '인천' 등이면 무조건 표시 (isPointInSeoul가 true라도)
                                if (feature.properties.address.includes('서울')) {
                                    return;
                                }
                            }
                            // 2. 주소가 없는 경우 (클러스터) 또는 주소로 판단 불가 - 좌표 기반 체크
                            else if (isPointInSeoul(lat, lng)) {
                                return;
                            }
                        }

                        if (isCluster(feature)) {
                            const clusterId = feature.properties.cluster_id!;
                            const markerId = `cluster-${clusterId}`;
                            activeIds.add(markerId);

                            clusterAnimationManager.register(clusterId);

                            let categories: string[];
                            try {
                                categories = getClusterCategories(clusterIndexRef.current!, clusterId);
                            } catch (e) { categories = []; }

                            renderClusterHelper(
                                markerId,
                                { lat, lng },
                                feature.properties.point_count || 0,
                                categories,
                                clusterId,
                                () => {
                                    // [Fix] Supercluster 줌인 + 패널 오프셋 적용
                                    const expansionZoom = clusterIndexRef.current!.getClusterExpansionZoom(clusterId);
                                    const currentZoom = map.getZoom();
                                    let targetZoom = expansionZoom;
                                    if (targetZoom <= currentZoom) targetZoom = currentZoom + 2;
                                    targetZoom = Math.max(targetZoom, 9);
                                    morphWithPanelOffset(lat, lng, targetZoom);
                                }
                            );
                        } else {
                            // 클러스터 모드 내의 개별 마커
                            const restaurantId = feature.properties.restaurantId;
                            activeIds.add(restaurantId);
                            const category = feature.properties.category;
                            const isSelected = selectedRestaurant?.id === restaurantId;
                            const html = createIndividualMarkerHTML(category, isSelected);

                            markerPool.acquire(
                                restaurantId,
                                new naver.maps.LatLng(lat, lng),
                                { content: html, anchor: new naver.maps.Point(isSelected ? 18 : 14, isSelected ? 18 : 14) },
                                map,
                                () => {
                                    // ... existing click logic ...
                                    const restaurant = displayRestaurants.find(r => r.id === restaurantId);
                                    if (restaurant) {
                                        hasUserMovedMapRef.current = false;
                                        if (onMarkerClick) onMarkerClick(restaurant);
                                        else {
                                            if (onRestaurantSelect) onRestaurantSelect(restaurant);
                                            setInternalPanelOpen(true);
                                        }
                                    }
                                }
                            );
                        }
                    });
                }
            } else {
                // 개별 마커 모드 (클러스터링 없음)
                // 참고: 서울 자치구 모드가 활성화된 경우, 서울 내의 개별 마커를 숨겨야 할까요?
                // 아마도 네, 클러스터링을 강제하기 위해서입니다.

                const restaurantsToShow = [...displayRestaurants];
                // ... (search logic) ...
                if (searchedRestaurant && !displayRestaurants.some(r => r.id === searchedRestaurant.id)) {
                    restaurantsToShow.push(searchedRestaurant);
                }

                const visibleRestaurants = VIEWPORT_FILTER_ENABLED
                    ? restaurantsToShow.filter(r => r.id === selectedRestaurant?.id || isRestaurantInViewport(r, extendedBounds))
                    : restaurantsToShow;

                visibleRestaurants.forEach(restaurant => {
                    if (!restaurant.lat || !restaurant.lng) return;

                    // [Logic] Seoul District Mode가 켜져있다면, 서울 내부의 개별 마커는 숨김 (District Cluster가 대신함)
                    if (shouldUseSeoulDistrictCluster) {
                        // 1. 주소 확인 (개별 마커는 주소 정보가 확실하므로 우선 사용)
                        const address = restaurant.road_address || restaurant.jibun_address || '';
                        if (address) {
                            if (address.includes('서울')) {
                                return;
                            }
                        }
                        // 2. 주소가 없는 경우 좌표 체크
                        else if (isPointInSeoul(restaurant.lat, restaurant.lng)) {
                            return;
                        }
                    }

                    activeIds.add(restaurant.id);
                    const isSelected = selectedRestaurant?.id === restaurant.id;
                    const category = (Array.isArray(restaurant.categories) ? restaurant.categories[0] : restaurant.category || '기타') as string;
                    const html = createIndividualMarkerHTML(category, isSelected);

                    markerPool.acquire(
                        restaurant.id,
                        new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                        { content: html, anchor: new naver.maps.Point(isSelected ? 18 : 14, isSelected ? 18 : 14) },
                        map,
                        () => {
                            hasUserMovedMapRef.current = false;
                            if (onMarkerClick) onMarkerClick(restaurant);
                            else {
                                if (onRestaurantSelect) onRestaurantSelect(restaurant);
                                setInternalPanelOpen(true);
                            }
                        }
                    );
                });
                restaurantsRef.current = restaurantsToShow;
            }

            // Cleanup
            markerPool.releaseExcept(activeIds);

            // [PERFORMANCE] 렌더링 종료 시간 측정 및 로그 (개발 모드)
            perfMonitor.endMeasure('RenderMarkers');
            if (process.env.NODE_ENV === 'development' && activeIds.size > 50) {
                perfMonitor.report();
            }
        }

    }, [clusters, regionalClusters, seoulDistrictClusters, seoulDistrictClustersFiltered, seoulIndividualIds, displayRestaurants.length, selectedRegion, selectedRestaurant?.id, searchedRestaurant?.id, isClusterMode, isRegionalClusterMode, isSeoulDistrictMode, isMapInitialized]);

    // [Animation] 카테고리 이모지 순환 업데이트
    useEffect(() => {
        if (!isClusterMode && !isRegionalClusterMode && !isSeoulDistrictMode) return;

        // 애니메이션 업데이트 시 클러스터 마커 HTML 갱신
        const cleanup = clusterAnimationManager.addListener(() => {
            if (isRegionalClusterMode) {
                // ... (기존 코드)
                regionalClusters.forEach((cluster) => {
                    const markerId = `regional-${cluster.region}`;
                    const marker = markerPool.get(markerId);

                    if (marker) {
                        const categories = cluster.categories;
                        const regionHash = Math.abs(cluster.region.split('').reduce((a, b) => (a * 31 + b.charCodeAt(0)) | 0, 0));
                        const currentIndex = clusterAnimationManager.getCurrentIndex(regionHash, categories.length);

                        const fakeFeature = {
                            properties: { point_count: cluster.count },
                            geometry: { coordinates: [cluster.center.lng, cluster.center.lat] }
                        } as any;
                        const html = createClusterMarkerHTML(fakeFeature, categories, currentIndex); // 이제 여기서 배지도 포함됨

                        marker.setIcon({
                            content: html,
                            anchor: new window.naver.maps.Point(24, 24),
                        });
                    }
                });
            }
            // 복합 모드: 서울 자치구 모드가 활성화된 경우, 해당 애니메이션 로직 실행
            if (isSeoulDistrictMode) {
                // Seoul District 모드 - 25개 자치구 클러스터 업데이트
                seoulDistrictClusters.forEach((cluster) => {
                    const markerId = `seoul-dist-${cluster.region}`;
                    const marker = markerPool.get(markerId);

                    if (marker) {
                        // ... same logic ...
                        const categories = cluster.categories;
                        const regionHash = Math.abs(cluster.region.split('').reduce((a, b) => (a * 31 + b.charCodeAt(0)) | 0, 0));
                        const currentIndex = clusterAnimationManager.getCurrentIndex(regionHash, categories.length);

                        const fakeFeature = {
                            properties: { point_count: cluster.count },
                            geometry: { coordinates: [cluster.center.lng, cluster.center.lat] }
                        } as any;
                        const html = createClusterMarkerHTML(fakeFeature, categories, currentIndex);
                        marker.setIcon({ content: html, anchor: new window.naver.maps.Point(24, 24) });
                    }
                });
            }

            // 복합 모드: 클러스터 모드가 활성화된 경우, 표준 애니메이션 로직도 실행
            if (isClusterMode) {
                // 기존 Supercluster 클러스터 모드
                clusters.forEach((feature) => {
                    if (isCluster(feature)) {
                        const clusterId = feature.properties.cluster_id!;
                        const markerId = `cluster-${clusterId}`;
                        const marker = markerPool.get(markerId);

                        if (marker && clusterIndexRef.current) {
                            let categories: string[] = [];
                            try {
                                categories = getClusterCategories(clusterIndexRef.current, clusterId);
                            } catch (e) {
                                // ignore
                            }

                            const currentIndex = clusterAnimationManager.getCurrentIndex(clusterId, categories.length);
                            const html = createClusterMarkerHTML(feature, categories, currentIndex);

                            marker.setIcon({
                                content: html,
                                anchor: new window.naver.maps.Point(24, 24),
                            });
                        }
                    }
                });
            }
        });

        return cleanup;
    }, [isClusterMode, isRegionalClusterMode, isSeoulDistrictMode, clusters, regionalClusters, seoulDistrictClusters]);

    // [OPTIMIZATION] 선택 상태 변경에 따른 마커 스타일 업데이트 (O(N) → O(1) 최적화)
    // 이전 선택 마커 ID 추적
    const prevSelectedMarkerIdRef = useRef<string | null>(null);

    useEffect(() => {
        const currentSelected = isGridMode ? gridSelectedRestaurant : selectedRestaurant;
        const currentSelectedId = currentSelected?.id || null;
        const prevSelectedId = prevSelectedMarkerIdRef.current;

        // 동일한 마커 재선택 시 스킵
        if (currentSelectedId === prevSelectedId) {
            return;
        }

        // [CRITICAL OPTIMIZATION] 전체 순회(O(N)) 대신 2개 마커만 업데이트(O(1))
        const { naver } = window;

        // 1. 이전 선택 마커 비활성화
        if (prevSelectedId && prevSelectedId !== currentSelectedId) {
            const prevMarker = markerPool.get(prevSelectedId);
            if (prevMarker) {
                // 카테고리 계산
                const restaurant = displayRestaurants.find(r => r.id === prevSelectedId);
                if (restaurant) {
                    const category = (Array.isArray(restaurant.categories)
                        ? restaurant.categories[0]
                        : restaurant.category || '기타') as string;
                    const content = createIndividualMarkerHTML(category, false);

                    markerPool.update(prevSelectedId, {
                        icon: {
                            content,
                            anchor: new naver.maps.Point(14, 14)
                        },
                        zIndex: 1
                    });
                }
            }
        }

        // 2. 현재 선택 마커 활성화
        if (currentSelectedId) {
            const currentMarker = markerPool.get(currentSelectedId);
            if (currentMarker) {
                const restaurant = displayRestaurants.find(r => r.id === currentSelectedId);
                if (restaurant) {
                    const category = (Array.isArray(restaurant.categories)
                        ? restaurant.categories[0]
                        : restaurant.category || '기타') as string;
                    const content = createIndividualMarkerHTML(category, true);

                    markerPool.update(currentSelectedId, {
                        icon: {
                            content,
                            anchor: new naver.maps.Point(18, 18)
                        },
                        zIndex: 100
                    });
                }
            }
        }

        // ref 업데이트
        prevSelectedMarkerIdRef.current = currentSelectedId;
        prevSelectedRestaurantIdRef.current = currentSelectedId;

    }, [selectedRestaurant, gridSelectedRestaurant, isGridMode, displayRestaurants]);


    // selectedRestaurant이 기존 데이터와 다른 경우 기존 데이터로 교체
    useEffect(() => {
        if (selectedRestaurant && displayRestaurants.length > 0) {
            let existingRestaurant = null;

            // 병합된 데이터의 경우
            if (selectedRestaurant.mergedRestaurants && selectedRestaurant.mergedRestaurants.length > 0) {
                const mergedIds = selectedRestaurant.mergedRestaurants.map(r => r.id);
                existingRestaurant = displayRestaurants.find(r =>
                    mergedIds.includes(r.id) ||
                    (r.mergedRestaurants && r.mergedRestaurants.some((mr: { id: string }) => mergedIds.includes(mr.id))) ||
                    (r.name === selectedRestaurant.name &&
                        Math.abs((r.lat || 0) - (selectedRestaurant.lat || 0)) < 0.0001 &&
                        Math.abs((r.lng || 0) - (selectedRestaurant.lng || 0)) < 0.0001)
                );
            } else {
                // 일반 데이터의 경우 - 지도의 병합된 데이터에서도 찾기
                existingRestaurant = displayRestaurants.find(r =>
                    r.id === selectedRestaurant.id ||
                    (r.mergedRestaurants && r.mergedRestaurants.some((mr: { id: string }) => mr.id === selectedRestaurant.id)) ||
                    (r.name === selectedRestaurant.name &&
                        Math.abs((r.lat || 0) - (selectedRestaurant.lat || 0)) < 0.0001 &&
                        Math.abs((r.lng || 0) - (selectedRestaurant.lng || 0)) < 0.0001)
                );
            }

            if (existingRestaurant && existingRestaurant.id !== selectedRestaurant.id) {
                if (onRestaurantSelect) {
                    onRestaurantSelect(existingRestaurant);
                }
            }
        }
    }, [selectedRestaurant, onRestaurantSelect]); // restaurants를 dependency에서 제거하여 무한 루프 방지



    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current) return;

        // [Fix] 기존 지도 인스턴스가 유효한지 검증 (soft navigation 시 zombie 인스턴스 방지)
        const isMapInstanceValid = () => {
            if (!mapInstanceRef.current) return false;

            try {
                // 1. 지도 API 메서드가 정상 동작하는지 확인
                const center = mapInstanceRef.current.getCenter?.();
                if (!center) return false;

                // 2. 지도 컨테이너가 현재 mapRef와 연결되어 있는지 확인
                // 네이버 지도는 컨테이너 내부에 naver-map-* 클래스의 요소들을 생성함
                const mapElement = mapRef.current;
                if (!mapElement) return false;

                // 지도 컨테이너 내부에 실제 지도가 렌더링되었는지 확인
                const hasMapContent = mapElement.querySelector('[class*="naver"]') !== null ||
                    mapElement.children.length > 0;

                if (!hasMapContent) return false;

                // 3. 컨테이너의 크기가 유효한지 확인
                const rect = mapElement.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return false;

                return true;
            } catch {
                return false;
            }
        };

        // 기존 인스턴스가 유효하면 재초기화 불필요
        if (isMapInstanceValid()) return;

        // 유효하지 않은 기존 인스턴스 정리
        if (mapInstanceRef.current) {
            markerPool.clear();
            clusterAnimationManager.clear();
            mapInstanceRef.current = null;
            setIsMapInitialized(false);
        }

        try {
            const { naver } = window;

            // [URL 라우팅] 초기 로드 시 URL에서 상태 복원 - 지도 생성 전에 파싱
            const params = new URLSearchParams(window.location.search);
            // 신규 형식: z (줌), 구 형식: c (하위 호환)
            const zParam = params.get('z');
            const cParam = params.get('c');
            const urlLat = parseFloat(params.get('lat') || '');
            const urlLng = parseFloat(params.get('lng') || '');

            // 줌 레벨 파싱 (신규 형식 우선, 구 형식 하위 호환)
            let urlZoom: number | undefined;
            if (zParam) {
                urlZoom = parseFloat(zParam);
            } else if (cParam) {
                urlZoom = parseFloat(cParam.split(',')[0]); // 구 형식 하위 호환
            }

            // 선택된 지역에 따라 지도 중심과 줌 레벨 설정
            const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
            const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
            // 디바이스별 줌 레벨 조정 (전국은 기본값 유지)
            const isNational = regionKey === "전국";
            const defaultZoom = getDeviceAdjustedZoom(regionConfig.zoom, isNational);

            // [Fix] URL에 줌/좌표가 있으면 그 값을 우선 사용 (공유 URL 지원)
            const hasValidUrlState = urlZoom && !isNaN(urlZoom) && !isNaN(urlLat) && !isNaN(urlLng);
            const initialZoom = hasValidUrlState ? urlZoom! : defaultZoom;

            const initialCenter = hasValidUrlState
                ? new naver.maps.LatLng(urlLat, urlLng)
                : new naver.maps.LatLng(regionConfig.center[0], regionConfig.center[1]);

            const map = new naver.maps.Map(mapRef.current, {
                center: initialCenter,
                zoom: initialZoom,
                minZoom: 6,
                maxZoom: 18,
                zoomControl: false,
                zoomControlOptions: {
                    position: naver.maps.Position.TOP_RIGHT,
                },
                mapTypeControl: false,
                mapTypeControlOptions: {
                    position: naver.maps.Position.TOP_LEFT,
                },
                scaleControl: false,
                // 성능 최적화 및 UX 개선 옵션
                background: '#f5f5f5', // [UX] 흰색보다 약간 회색으로 변경 (눈에 덜 띔)
                tileSpare: 3, // [PERF] 타일 미리 로딩 감소 (메모리/네트워크 절약)
                tileTransition: true, // [UX] 타일 깜빡임 방지를 위해 페이드 효과 활성화
                // [Fix] 줌/팬 동작 명시적 활성화
                scrollWheel: false, // [Modified] 커스텀 스크롤 핸들러 사용 (0.5 단위 제어)
                pinchZoom: true,
                draggable: true,
                keyboardShortcuts: true,
            });

            mapInstanceRef.current = map;
            setIsMapInitialized(true);

            // [Fix] URL 파라미터로 초기화된 경우 플래그 설정 (centering effect에서 줌 오버라이드 방지)
            if (hasValidUrlState) {
                isInitialLoadFromUrlRef.current = true;
            }

            // [Fix] 지도 초기화 후 idle 이벤트 강제 트리거 - 클러스터 초기화 보장
            setTimeout(() => {
                if (map) {
                    naver.maps.Event.trigger(map, 'idle');
                }
            }, 100);

            // [URL 라우팅] 지도 이동 시 URL 동기화 비활성화
            // 사용자가 직접 공유 버튼을 클릭할 때만 URL이 생성되도록 변경
            // idle 이벤트에서 URL 동기화하면 공유 URL 접속 시 원치 않는 URL 변경이 발생함
            // naver.maps.Event.addListener(map, 'idle', () => { ... });

        } catch (error) {
            console.error("네이버 지도 초기화 오류:", error);
            showMapToast("지도를 초기화하는 중 오류가 발생했습니다.", 'error');
        }
    }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // [New] 커스텀 스크롤 휠 핸들러 (0.5 단위 줌 -> 1단위 슬라이더 줌) - 별도 Effect로 분리
    useEffect(() => {
        if (!isMapInitialized || !mapRef.current || !mapInstanceRef.current) return;

        const mapElement = mapRef.current;
        const map = mapInstanceRef.current;

        // 연속 스크롤 시 목표 줌 레벨 추적 변수 (Effect 클로저 내 유지)
        let targetZoomLevel = map.getZoom();
        let lastWheelTime = 0;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();

            const now = Date.now();
            const timeDiff = now - lastWheelTime;
            lastWheelTime = now;

            const currentMapZoom = map.getZoom();

            // 1. 기준 줌 설정 (연속성 보장)
            let baseZoom;
            // 400ms 이내이고, 오차가 크지 않으면 이전 목표값 유지
            if (timeDiff < 400 && Math.abs(targetZoomLevel - currentMapZoom) < 1.5) {
                baseZoom = targetZoomLevel;
            } else {
                baseZoom = currentMapZoom;
            }

            // 2. 새로운 목표 계산 (정수 1단위)
            // deltaY > 0 : 줌 아웃(값 감소), deltaY < 0 : 줌 인(값 증가)
            const zoomChange = e.deltaY > 0 ? -1 : 1;
            const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(baseZoom) + zoomChange));

            // 3. 적용 (변경이 있을 때만)
            if (nextZoom !== targetZoomLevel) {
                targetZoomLevel = nextZoom;

                // [UX] 즉각적인 슬라이더 UI 갱신 (애니메이션 대기 없음)
                // 줌 변경 시 부드럽게 이동 (깜빡임 방지)
                map.setZoom(nextZoom, true);
            }
        };

        // passive: false여야 preventDefault()가 동작함
        mapElement.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            mapElement.removeEventListener('wheel', handleWheel);
        };
    }, [isMapInitialized]);

    // [성능 최적화] 지도 이동/줌 이벤트 리스너 - 가시영역 변경 시 마커 업데이트
    useEffect(() => {
        if (!mapInstanceRef.current || !VIEWPORT_FILTER_ENABLED) return;

        const map = mapInstanceRef.current;
        const { naver } = window;

        // 강제로 마커 업데이트를 트리거하는 함수
        const triggerMarkerUpdate = () => {
            // displayRestaurants dependency를 통해 마커 동기화 useEffect가 재실행되도록 유도
            // 실제로는 dependency가 변경되지 않으므로, 직접 업데이트 로직을 실행
            const restaurantsToShow = [...displayRestaurants];

            if (searchedRestaurant) {
                let alreadyExists = false;
                if (searchedRestaurant.mergedRestaurants && searchedRestaurant.mergedRestaurants.length > 0) {
                    const mergedIds = searchedRestaurant.mergedRestaurants.map(r => r.id);
                    alreadyExists = displayRestaurants.some(r => mergedIds.includes(r.id));
                } else {
                    alreadyExists = displayRestaurants.some(r => r.id === searchedRestaurant.id);
                }
                if (!alreadyExists) {
                    restaurantsToShow.push(searchedRestaurant);
                }
            }

            const perfStart = PERFORMANCE_LOG_ENABLED ? performance.now() : 0;

            const extendedBounds = getExtendedBounds(map);
            const visibleRestaurants = restaurantsToShow.filter(r => {
                if (r.id === selectedRestaurant?.id || r.id === searchedRestaurant?.id) {
                    return true;
                }
                return isRestaurantInViewport(r, extendedBounds);
            });



            const visibleIds = new Set(visibleRestaurants.map(r => r.id));

            // 가시영역 밖의 마커 숨기기
            markersMapRef.current.forEach((marker, id) => {
                if (!visibleIds.has(id)) {
                    marker.setMap(null);
                }
            });

            // 가시영역 내의 마커 표시
            visibleRestaurants.forEach(restaurant => {
                if (!restaurant.lat || !restaurant.lng) return;
                const existingMarker = markersMapRef.current.get(restaurant.id);
                if (existingMarker && existingMarker.getMap() !== map) {
                    existingMarker.setMap(map);
                }
            });


        };

        // 디바운스된 업데이트 함수 (성능 티어에 따라 동적 시간)
        const debouncedUpdate = debounce(triggerMarkerUpdate, mapOptimization.mapUpdateDebounceMs);

        // 이벤트 리스너 등록
        // 이벤트 리스너 등록
        // [Fix] dragend/zoom_changed 대신 idle 이벤트만 사용하여
        // 지도가 완전히 멈춘 후에만 무거운 마커 업데이트 수행 (줌/팬 중 끊김 방지)
        const idleListener = naver.maps.Event.addListener(map, 'idle', debouncedUpdate);

        return () => {
            naver.maps.Event.removeListener(idleListener);
        };
    }, [displayRestaurants, searchedRestaurant, selectedRestaurant, isMapInitialized]);

    // [삭제됨] 네이버 로고 숨김 로직은 약관 위반 소지가 있어 제거하였습니다.
    // useEffect(() => { ... logo hiding logic ... }, [isLoaded]);

    // [삭제됨] 지역 변경 시 지도 중심 이동 로직은 위쪽의 통합 useEffect로 병합됨
    // useEffect(() => { ... }, [selectedRegion]);

    // 검색된 맛집 선택 시 지도 중심 이동 및 선택 상태 설정
    useEffect(() => {
        if (!searchedRestaurant || !mapInstanceRef.current) return;

        // 검색된 맛집이 병합된 데이터라면 기존 restaurants에서 같은 데이터를 찾아서 교체
        let actualSearchedRestaurant = searchedRestaurant;

        // 1. 검색 결과가 병합된 데이터인 경우
        if (searchedRestaurant.mergedRestaurants && searchedRestaurant.mergedRestaurants.length > 0) {
            const mergedIds = searchedRestaurant.mergedRestaurants.map(r => r.id);
            const existingRestaurant = restaurants.find(r =>
                mergedIds.includes(r.id) ||
                (r.mergedRestaurants && r.mergedRestaurants.some((mr: { id: string }) => mergedIds.includes(mr.id))) ||
                (r.name === searchedRestaurant.name &&
                    Math.abs((r.lat || 0) - (searchedRestaurant.lat || 0)) < 0.0001 &&
                    Math.abs((r.lng || 0) - (searchedRestaurant.lng || 0)) < 0.0001)
            );
            if (existingRestaurant) {
                actualSearchedRestaurant = existingRestaurant;
                // 부모 컴포넌트의 selectedRestaurant도 업데이트
                if (onRestaurantSelect) {
                    onRestaurantSelect(existingRestaurant);
                }
            }
        } else {
            // 2. 검색 결과가 개별 레코드인 경우 - 지도의 병합된 데이터에서 찾기
            const existingRestaurant = restaurants.find(r =>
                r.id === searchedRestaurant.id ||
                (r.mergedRestaurants && r.mergedRestaurants.some((mr: { id: string }) => mr.id === searchedRestaurant.id)) ||
                (r.name === searchedRestaurant.name &&
                    Math.abs((r.lat || 0) - (searchedRestaurant.lat || 0)) < 0.0001 &&
                    Math.abs((r.lng || 0) - (searchedRestaurant.lng || 0)) < 0.0001)
            );
            if (existingRestaurant) {
                actualSearchedRestaurant = existingRestaurant;
                // 부모 컴포넌트의 selectedRestaurant도 업데이트
                if (onRestaurantSelect) {
                    onRestaurantSelect(existingRestaurant);
                }
            }
        }

        // 패널 열기 (검색 시에만)
        setInternalPanelOpen(true);
        // 현재 searchedRestaurant 저장
        previousSearchedRestaurantRef.current = searchedRestaurant;

        // [검색 시 줌 레벨 15로 즉시 이동]
        const map = mapInstanceRef.current;
        const targetLat = actualSearchedRestaurant.lat;
        const targetLng = actualSearchedRestaurant.lng;
        if (map && targetLat && targetLng && window.naver) {
            const targetZoom = 15;
            map.setZoom(targetZoom);
            map.setCenter(new window.naver.maps.LatLng(targetLat, targetLng));
        }
    }, [searchedRestaurant]); // eslint-disable-line react-hooks/exhaustive-deps


    // 로딩 에러 처리
    if (loadError) {
        return (
            <div className="flex items-center justify-center h-full bg-muted">
                <div className="text-center space-y-4">
                    <div className="text-6xl">❌</div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold text-destructive">
                            지도 로딩 실패
                        </h2>
                        <p className="text-muted-foreground">
                            네이버 지도 API를 불러오는데 실패했습니다.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {loadError.message}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // 로딩 중
    if (!isLoaded) {
        return <MapSkeleton />;
    }

    // 그리드 모드에서는 기존 레이아웃 유지
    if (isGridMode) {
        return (
            <div className="relative h-full">
                {/* 지도 컨테이너 - 모바일 터치 성능 최적화 */}
                <div
                    ref={mapRef}
                    className="w-full h-full"
                />

                {/* 로딩 상태 표시 */}
                {
                    (isLoadingRestaurants || !isLoaded) && (
                        <MapLoadingIndicator
                            isLoaded={isLoaded}
                            style={centerOffsetStyle}
                            className="absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out"
                        />
                    )
                }

                {/* 레스토랑 개수 표시 (3초 후 fade-out) */}
                {
                    !isLoadingRestaurants && isLoaded && restaurants.length > 0 && showRestaurantCount && (
                        <RestaurantCountBadge
                            count={restaurants.length}
                            style={centerOffsetStyle}
                            className="absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out"
                        />
                    )
                }

                {/* 동시 접속자 표시 (주기적으로 표시) */}
                {
                    showOnlineUsers && !showRestaurantCount && (
                        <OnlineUsersBadge
                            count={onlineUsersCount}
                            style={centerOffsetStyle}
                            className="absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out"
                        />
                    )
                }

                {/* 빈 상태 UI - 맛집이 없을 때 표시 */}
                {
                    !isLoadingRestaurants && isLoaded && restaurants.length === 0 && (
                        <div style={centerOffsetStyle} className="absolute top-4 -translate-x-1/2 z-10 transition-[left] duration-300 ease-in-out">
                            <EmptyStateIndicator />
                        </div>
                    )
                }

                {/* [커스텀 토스트] 메시지 표시 */}
                {
                    mapToast && mapToast.isVisible && (
                        <div
                            style={centerOffsetStyle}
                            className="absolute top-4 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-20 flex items-center gap-2 animate-in fade-in zoom-in duration-300 transition-[left] ease-in-out"
                        >
                            <span className="text-sm font-medium">
                                {mapToast.message}
                            </span>
                        </div>
                    )
                }
            </div >
        );
    }

    // [DEBUG] Render tracking
    if (process.env.NODE_ENV === 'development') {
        // console.log('[Performance] NaverMapView rendered', {
        //     zoom: mapInstanceRef.current?.getZoom(),
        //     restaurantsCount: displayRestaurants.length
        // });
    }

    // 단일 지도 모드에서는 Flexbox 레이아웃 적용 (고정 너비 패널)
    return (
        <div className="h-full flex relative overflow-hidden">
            {/* 지도 영역 */}
            <div
                className="flex-1 h-full relative z-0"
                onClick={() => {
                    // 지도 클릭 시 패널 닫기/모드 변경 등의 동작이 필요하다면 여기서 처리
                    // 단, 드래그 시에는 발생하지 않아야 함.
                    // onPanelClick?.('map');
                }}
            >
                {/* 지도 컨테이너 - 모바일 터치 성능 최적화 */}
                <div
                    ref={mapRef}
                    data-testid="map-container"
                    className="w-full h-full"
                />

                {/* 로딩 상태 표시 */}
                {(isLoadingRestaurants || !isLoaded) && (
                    <MapLoadingIndicator
                        isLoaded={isLoaded}
                        style={centerOffsetStyle}
                        className="absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out"
                    />
                )}

                {/* 레스토랑 개수 표시 (3초 후 fade-out) */}
                {!isLoadingRestaurants && isLoaded && restaurants.length > 0 && showRestaurantCount && (
                    <RestaurantCountBadge
                        count={restaurants.length}
                        style={centerOffsetStyle}
                        className="absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out"
                    />
                )}

                {/* 동시 접속자 표시 (주기적으로 표시) */}
                {showOnlineUsers && !showRestaurantCount && (
                    <OnlineUsersBadge
                        count={onlineUsersCount}
                        style={centerOffsetStyle}
                        className="absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out"
                    />
                )}

                {/* 빈 상태 UI - 맛집이 없을 때 표시 */}
                {!isLoadingRestaurants && isLoaded && restaurants.length === 0 && (
                    <div style={centerOffsetStyle} className="absolute top-4 -translate-x-1/2 z-10 transition-[left] duration-300 ease-in-out">
                        <EmptyStateIndicator />
                    </div>
                )}

                {/* [커스텀 토스트] 메시지 표시 */}
                {mapToast && mapToast.isVisible && (
                    <div
                        style={centerOffsetStyle}
                        className="absolute top-4 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-20 flex items-center gap-2 animate-in fade-in zoom-in duration-300 transition-[left] ease-in-out"
                    >
                        <span className="text-sm font-medium">
                            {mapToast.message}
                        </span>
                    </div>
                )}



            </div>

            {/* 레스토랑 상세 패널 - 외부 onMarkerClick이 없을 때만 렌더링 (외부 패널 관리가 아닌 경우에만) */}
            {selectedRestaurant && !onMarkerClick && (
                <div
                    className={`h-full relative shadow-xl bg-background transition-[width] duration-300 ${internalPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
                    style={{ overflow: 'visible', transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)' }}
                    onClick={(e) => {
                        // 이벤트 버블링 방지 (지도 클릭으로 전파되지 않도록)
                        e.stopPropagation();
                        onPanelClick?.('detail');
                    }}
                >
                    <div ref={detailPanelRef} className="h-full w-[min(400px,calc(100vw-1rem))] bg-background border-l border-border">
                        <RestaurantDetailPanel
                            restaurant={selectedRestaurant}
                            onClose={() => setInternalPanelOpen(false)}
                            onWriteReview={() => {
                                setIsReviewModalOpen(true);
                            }}
                            onEditRestaurant={onAdminEditRestaurant ? () => {
                                onAdminEditRestaurant(selectedRestaurant!);
                            } : undefined}
                            onRequestEditRestaurant={onRequestEditRestaurant ? () => {
                                onRequestEditRestaurant(selectedRestaurant!);
                            } : undefined}
                            onToggleCollapse={() => setInternalPanelOpen(!internalPanelOpen)}
                            isPanelOpen={internalPanelOpen}
                        />
                    </div>
                </div>
            )}


            {/* 리뷰 작성 모달 */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                onSuccess={() => {
                    refetch();
                    showMapToast("리뷰가 성공적으로 등록되었습니다!", 'success');
                }}
            />
        </div>
    );
});

NaverMapView.displayName = 'NaverMapView';

export default NaverMapView;
