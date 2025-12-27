'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { FilterState } from "@/components/filters/FilterPanel";
import { Restaurant, Region } from "@/types/restaurant";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { toast } from "sonner";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { useLayout } from "@/contexts/LayoutContext";
import { useDeviceType } from "@/hooks/useDeviceType";

// 상수 정의
const PANEL_WIDTH = 400; // 상세 패널 너비 (px)
const ZOOM_DIFF_THRESHOLD = 4; // 즉시 로드할 줌 차이 임계값
const DISTANCE_KM_THRESHOLD = 50; // 즉시 로드할 거리 임계값 (km)

// [성능 최적화] 가시영역 필터링 및 이벤트 처리 상수
const VIEWPORT_FILTER_ENABLED = true; // 가시영역 필터링 활성화
const VIEWPORT_PADDING = 0.05; // 가시영역 여백 (5% 확장)
const MAP_UPDATE_DEBOUNCE_MS = 300; // 지도 업데이트 디바운스 시간 (ms)
const PERFORMANCE_LOG_ENABLED = false; // 성능 로깅 활성화 (개발용)

interface NaverMapViewProps {
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
}

/**
 * 카테고리별 아이콘 매핑
 * 컴포넌트 외부에서 정의하여 불필요한 재생성을 방지합니다.
 */
const CATEGORY_ICON_MAP: Record<string, string> = {
    '고기': '🥩',
    '치킨': '🍗',
    '한식': '🍚',
    '중식': '🥢',
    '일식': '🍣',
    '양식': '🍝',
    '분식': '🥟',
    '카페·디저트': '☕',
    '아시안': '🍜',
    '패스트푸드': '🍔',
    '족발·보쌈': '🍖',
    '돈까스·회': '🍱',
    '피자': '🍕',
    '찜·탕': '🥘',
    '야식': '🌙',
    '도시락': '🍱'
};

/**
 * 카테고리 아이콘 반환 함수
 * 
 * @param category 카테고리 문자열 또는 배열
 * @returns 매핑된 이모지 아이콘
 */
const getCategoryIcon = (category: string | string[] | null | undefined): string => {
    if (!category) return '⭐';
    const categoryStr = Array.isArray(category) ? category[0] : category;
    return CATEGORY_ICON_MAP[categoryStr] || '⭐';
};

/**
 * [OPTIMIZATION] 마커 컨텐츠 생성 함수 - 컴포넌트 외부에 정의하여 재생성 방지
 * 
 * @param restaurant 레스토랑 정보
 * @param isSelected 선택 여부
 * @returns HTML 문자열
 */
const createMarkerContentFn = (restaurant: Restaurant, isSelected: boolean): string => {
    const icon = getCategoryIcon(restaurant.categories || restaurant.category);
    const markerSize = isSelected ? 32 : 24;

    return `
        <div 
            class="custom-marker ${isSelected ? 'selected-marker' : ''}" 
            role="button" 
            aria-label="${restaurant.name} 맛집 마커" 
            tabindex="0" 
            title="${restaurant.name}"
        >
            <div style="
                position: relative;
                font-size: ${markerSize}px;
                cursor: pointer;
                transition: all 0.3s ease;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
            " class="${isSelected ? 'animate-bounce' : ''} hover:scale-125">
                ${icon}
            </div>
        </div>
    `;
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
 * 주어진 레스토랑이 현재 지도의 가시 영역 내에 있는지 확인합니다.
 * @param restaurant 확인할 레스토랑 객체
 * @param map 현재 Naver Map 인스턴스
 * @param padding 가시 영역을 확장할 비율 (예: 0.05는 5% 확장)
 * @returns 가시 영역 내에 있으면 true, 아니면 false
 */
const isRestaurantInViewport = (restaurant: Restaurant, map: any, padding: number = VIEWPORT_PADDING): boolean => {
    if (!map || !restaurant.lat || !restaurant.lng) return false;

    const bounds = map.getBounds();
    if (!bounds) return false;

    const latLng = new window.naver.maps.LatLng(restaurant.lat, restaurant.lng);

    // 가시 영역을 확장하여 마커가 가장자리에 있을 때도 포함되도록 합니다.
    const southWest = bounds.getSW();
    const northEast = bounds.getNE();

    const latDiff = northEast.lat() - southWest.lat();
    const lngDiff = northEast.lng() - southWest.lng();

    const paddedSouthWest = new window.naver.maps.LatLng(
        southWest.lat() - latDiff * padding,
        southWest.lng() - lngDiff * padding
    );
    const paddedNorthEast = new window.naver.maps.LatLng(
        northEast.lat() + latDiff * padding,
        northEast.lng() + lngDiff * padding
    );

    const paddedBounds = new window.naver.maps.LatLngBounds(paddedSouthWest, paddedNorthEast);

    return paddedBounds.hasLatLng(latLng);
};

const NaverMapView = memo(({
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

    // 사이드바 상태 가져오기
    const { isSidebarOpen } = useLayout();

    // 디바이스 타입 감지 (모바일/태블릿에서는 오프셋 제거)
    const { isMobileOrTablet } = useDeviceType();

    // Naver Maps API 로드 - LCP 최적화를 위해 lazyOnload 전략 사용
    const { isLoaded, loadError } = useNaverMaps({ autoLoad: true, strategy: 'lazyOnload' });
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [internalPanelOpen, setInternalPanelOpen] = useState(false);
    const [showRestaurantCount, setShowRestaurantCount] = useState(false);
    const [isMapInitialized, setIsMapInitialized] = useState(false);

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
        offsetX: number
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
                centerPoint.y
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
            console.error("Coordinate calculation failed:", e);
            return new window.naver.maps.LatLng(lat, lng);
        }
    };

    // [통합] 지도 중심 및 줌 조정 로직
    useEffect(() => {
        if (!mapInstanceRef.current || isGridMode) return;

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
        let targetZoom = 16;
        let isRestaurantSelected = false;

        if (selectedRestaurant?.lat && selectedRestaurant?.lng) {
            targetLat = selectedRestaurant.lat;
            targetLng = selectedRestaurant.lng;
            isRestaurantSelected = true;
        } else {
            const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
            const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
            targetLat = regionConfig.center[0];
            targetLng = regionConfig.center[1];
            targetZoom = regionConfig.zoom;
        }

        // 패널 상태에 따른 유효 오프셋 계산
        const isInternalMode = !onMarkerClick;
        const isShrinkingLayout = isInternalMode && internalPanelOpen && !isGridMode;

        let effectiveOffset = 0;
        // 모바일/태블릿에서는 바텀시트가 오버레이되므로 오프셋 없음
        if (isMobileOrTablet) {
            effectiveOffset = 0;
        } else if (isShrinkingLayout) {
            effectiveOffset = 0;
        } else if (!isPanelCollapsed && ((propIsPanelOpen ?? false) || (externalPanelOpen === false))) {
            effectiveOffset = PANEL_WIDTH;
        }

        // [Note] 패널 상태에 따른 지도 중심 오프셋 계산
        // 우측 패널이 열리면 지도의 "시각적 중심"이 왼쪽으로 이동해야 합니다.
        // 즉, 지도 중심(Center) 좌표를 패널 너비의 절반만큼 오른쪽으로 이동시켜야
        // 타겟(맛집)이 왼쪽 "보이는 영역"의 중앙에 위치하게 됩니다.
        // targetOffsetX = effectiveOffset / 2 (양수 = 오른쪽 이동)
        // 모바일/태블릿에서는 항상 0

        const targetOffsetX = effectiveOffset / 2;

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
            // [Helper 사용] 조정된 중심 좌표 계산
            const newCenterLatLng = getAdjustedCenter(targetLat, targetLng, targetZoom, targetOffsetX);

            if (shouldInstantLoad) {
                map.setZoom(targetZoom);
                map.setCenter(newCenterLatLng);
            } else {
                if (currentZoom !== targetZoom) {
                    map.morph(newCenterLatLng, targetZoom, {
                        duration: 400,
                        easing: 'easeOutCubic'
                    });
                } else {
                    map.panTo(newCenterLatLng, {
                        duration: 300,
                        easing: 'easeOutCubic'
                    });
                }
            }
        };

        moveMap();

        // 트랜지션 완료 후 보정 (300ms 후)
        const transitionTimer = setTimeout(() => {
            naver.maps.Event.trigger(map, 'resize');
            moveMap();
        }, 320);

        // 사용자 상호작용 감지 리스너 추가
        // Naver Maps API 이벤트뿐만 아니라 DOM 이벤트도 감지하여 더 정확하게 처리 (휠 줌, 더블 클릭 등)
        const handleUserInteraction = () => {
            hasUserMovedMapRef.current = true;
        };

        const mapElement = mapRef.current;
        if (mapElement) {
            // 캡처링 단계에서 이벤트 감지 (지도 내부 로직보다 먼저 실행)
            mapElement.addEventListener('wheel', handleUserInteraction, { capture: true });
            mapElement.addEventListener('mousedown', handleUserInteraction, { capture: true });
            mapElement.addEventListener('touchstart', handleUserInteraction, { capture: true });
        }

        const dragListener = naver.maps.Event.addListener(map, 'dragstart', handleUserInteraction);
        const pinchListener = naver.maps.Event.addListener(map, 'pinchstart', handleUserInteraction);

        return () => {
            clearTimeout(transitionTimer);
            naver.maps.Event.removeListener(dragListener);
            naver.maps.Event.removeListener(pinchListener);

            if (mapElement) {
                mapElement.removeEventListener('wheel', handleUserInteraction, { capture: true });
                mapElement.removeEventListener('mousedown', handleUserInteraction, { capture: true });
                mapElement.removeEventListener('touchstart', handleUserInteraction, { capture: true });
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
            //              = (mapWidth - (mapWidth - rightPanelWidth)) / 2
            //              = rightPanelWidth / 2

            // 결론: 사이드바 너비는 이미 지도 컨테이너 크기에 반영되어 있으므로 계산식에서 빠져야 함!
            // 이전 로직의 targetOffsetX = (rightPanelWidth - sidebarWidth) / 2 는 
            // 뷰포트 전체(window) 기준이 아니라면 틀렸을 수도 있음. 
            // NaverMapView는 flex-1이므로, 부모(MainLayout)에서 마진(margin-left)으로 사이드바 공간을 뺌.
            // 즉 mapRef.current의 width는 이미 (Window - Sidebar)임.
            // 따라서 지도 컨테이너 내부에서의 중심 오프셋은 **rightPanelWidth / 2** 만 있으면 됨.

            const targetOffsetX = rightPanelWidth / 2;

            // [Helper 사용] 현재 줌 레벨 유지
            const currentZoom = map.getZoom();
            const newCenterLatLng = getAdjustedCenter(targetLat, targetLng, currentZoom, targetOffsetX);

            // 애니메이션 없이 즉시 이동 (부드러움 유지)
            map.setCenter(newCenterLatLng);
        };

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(handleResize);
        });

        resizeObserver.observe(mapRef.current);

        return () => {
            resizeObserver.disconnect();
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

        window.addEventListener('resize', handleWindowResize);
        return () => {
            window.removeEventListener('resize', handleWindowResize);
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

    // 표시할 마커 데이터 (로딩 중에는 이전 데이터를 사용) - 메모이제이션
    const displayRestaurants = useMemo(() => {
        return isLoadingRestaurants && previousRestaurants.length > 0 ? previousRestaurants : restaurants;
    }, [isLoadingRestaurants, previousRestaurants, restaurants]);

    // [최적화] 마커 데이터 동기화 (생성/삭제) with 가시영역 필터링
    useEffect(() => {
        if (!mapInstanceRef.current || !window.naver) return;
        const { naver } = window;
        const map = mapInstanceRef.current;

        const perfStart = PERFORMANCE_LOG_ENABLED ? performance.now() : 0;

        // 표시할 레스토랑 목록 준비 (검색어 포함)
        const restaurantsToShow = [...displayRestaurants];

        // 검색된 맛집 추가 로직 (기존과 동일)
        if (searchedRestaurant) {
            let alreadyExists = false;
            // (중복 체크 로직 생략 - 기존과 동일하다고 가정하거나 간단히 ID 체크)
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

        // [성능 최적화] 가시영역 필터링 적용
        const visibleRestaurants = VIEWPORT_FILTER_ENABLED
            ? restaurantsToShow.filter(r => {
                // 선택된 레스토랑이나 검색된 레스토랑은 항상 표시
                if (r.id === selectedRestaurant?.id || r.id === searchedRestaurant?.id) {
                    return true;
                }
                return isRestaurantInViewport(r, map);
            })
            : restaurantsToShow;

        if (PERFORMANCE_LOG_ENABLED) {
            console.log(`[Performance] Viewport filtering: ${restaurantsToShow.length} -> ${visibleRestaurants.length} markers`);
        }

        // 1. 가시영역 밖의 마커 숨기기 또는 삭제
        const visibleIds = new Set(visibleRestaurants.map(r => r.id));
        markersMapRef.current.forEach((marker, id) => {
            if (!visibleIds.has(id)) {
                // 가시영역 밖이면 지도에서 제거
                marker.setMap(null);
            }
        });

        // 2. 가시영역 내의 마커 생성 또는 재표시
        visibleRestaurants.forEach(restaurant => {
            if (!restaurant.lat || !restaurant.lng) return;

            const existingMarker = markersMapRef.current.get(restaurant.id);

            if (existingMarker) {
                // 기존 마커가 있으면 다시 지도에 표시
                if (existingMarker.getMap() !== map) {
                    existingMarker.setMap(map);
                }
            } else {
                // 새로운 마커 생성
                const isSelected = false; // 생성 시점엔 기본 상태
                const contentHtml = createMarkerContent(restaurant, isSelected);

                const marker = new naver.maps.Marker({
                    position: new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                    map: map,
                    icon: {
                        content: contentHtml,
                        anchor: new naver.maps.Point(12, 12), // 기본 Anchor (24px/2)
                    },
                    title: restaurant.name,
                });

                // [최적화] 마커 객체에 메타데이터 저장 (상태 관리용)
                (marker as any).__restaurant = restaurant;
                (marker as any).__isSelected = isSelected;

                // 클릭 리스너 등록
                naver.maps.Event.addListener(marker, "click", () => {
                    if (onMarkerClick) {
                        onMarkerClick(restaurant);
                    } else {
                        if (onRestaurantSelect) {
                            onRestaurantSelect(restaurant);
                        }
                        setInternalPanelOpen(true);
                    }
                });

                markersMapRef.current.set(restaurant.id, marker);
            }
        });

        // restaurantsRef 업데이트
        restaurantsRef.current = restaurantsToShow;

        if (PERFORMANCE_LOG_ENABLED) {
            const perfEnd = performance.now();
            console.log(`[Performance] Marker update took ${(perfEnd - perfStart).toFixed(2)}ms`);
        }

    }, [displayRestaurants, searchedRestaurant, selectedRestaurant, createMarkerContent, onMarkerClick, onRestaurantSelect]);

    // [최적화] 선택 상태 변경에 따른 마커 스타일 업데이트 (안전한 전체 순회 방식)
    useEffect(() => {
        const currentSelected = isGridMode ? gridSelectedRestaurant : selectedRestaurant;
        const currentSelectedId = currentSelected?.id;

        // 모든 마커를 순회하며 상태 동기화
        // 성능: 마커 수백 개 수준에서는 순회 비용이 매우 적음 (O(N))
        // 장점: 이전 상태 추적 불필요, 데이터 불일치 문제 해결
        markersMapRef.current.forEach((marker: any, id) => {
            const isTarget = id === currentSelectedId;

            // 상태가 변경된 경우에만 DOM/Icon 업데이트 (비용 절감)
            if (marker.__isSelected !== isTarget) {
                const restaurant = marker.__restaurant; // 마커에 저장된 데이터 사용

                if (restaurant) {
                    const content = createMarkerContent(restaurant, isTarget);

                    marker.setIcon({
                        content: content,
                        anchor: isTarget
                            ? new naver.maps.Point(16, 16) // 선택됨 (32px)
                            : new naver.maps.Point(12, 12) // 기본 (24px)
                    });

                    marker.setZIndex(isTarget ? 100 : 0);
                    marker.__isSelected = isTarget;
                }
            }
        });

        // ref 업데이트는 더 이상 필요 없지만 호환성을 위해 유지
        prevSelectedRestaurantIdRef.current = currentSelectedId || null;

    }, [selectedRestaurant, gridSelectedRestaurant, isGridMode, createMarkerContent]);


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
        if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;

        try {
            const { naver } = window;

            // 선택된 지역에 따라 지도 중심과 줌 레벨 설정
            const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
            const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
            const map = new naver.maps.Map(mapRef.current, {
                center: new naver.maps.LatLng(regionConfig.center[0], regionConfig.center[1]),
                zoom: regionConfig.zoom,
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
                background: '#ffffff',
                tileSpare: 5, // [UX] 화면 밖 타일 미리 로딩 (흰색 배경 방지), 기본값보다 높게 설정
                tileTransition: true, // [UX] 타일 로딩 시 페이드 효과
            });

            mapInstanceRef.current = map;
            setIsMapInitialized(true);
        } catch (error) {
            console.error("네이버 지도 초기화 오류:", error);
            showMapToast("지도를 초기화하는 중 오류가 발생했습니다.", 'error');
        }
    }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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

            const visibleRestaurants = restaurantsToShow.filter(r => {
                if (r.id === selectedRestaurant?.id || r.id === searchedRestaurant?.id) {
                    return true;
                }
                return isRestaurantInViewport(r, map);
            });

            if (PERFORMANCE_LOG_ENABLED) {
                console.log(`[Performance] After map move: ${restaurantsToShow.length} -> ${visibleRestaurants.length} markers`);
            }

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

            if (PERFORMANCE_LOG_ENABLED) {
                const perfEnd = performance.now();
                console.log(`[Performance] Map event update took ${(perfEnd - perfStart).toFixed(2)}ms`);
            }
        };

        // 디바운스된 업데이트 함수
        const debouncedUpdate = debounce(triggerMarkerUpdate, MAP_UPDATE_DEBOUNCE_MS);

        // 이벤트 리스너 등록
        const dragEndListener = naver.maps.Event.addListener(map, 'dragend', debouncedUpdate);
        const zoomChangedListener = naver.maps.Event.addListener(map, 'zoom_changed', debouncedUpdate);

        return () => {
            naver.maps.Event.removeListener(dragEndListener);
            naver.maps.Event.removeListener(zoomChangedListener);
        };
    }, [displayRestaurants, searchedRestaurant, selectedRestaurant]);

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
                    className="w-full h-full touch-pan-y touch-pan-x transform-gpu"
                    style={{
                        willChange: 'transform',
                        touchAction: 'pan-x pan-y',
                        WebkitOverflowScrolling: 'touch' as any
                    }}
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
        );
    }

    // 단일 지도 모드에서는 Flexbox 레이아웃 적용 (고정 너비 패널)
    return (
        <div className="h-full flex relative overflow-hidden">
            {/* 지도 영역 */}
            <div
                className="flex-1 h-full relative z-0"
                onClick={() => {
                    onPanelClick?.('map');
                }}
            >
                {/* 지도 컨테이너 - 모바일 터치 성능 최적화 */}
                <div
                    ref={mapRef}
                    className="w-full h-full touch-pan-y touch-pan-x transform-gpu"
                    style={{
                        willChange: 'transform',
                        touchAction: 'pan-x pan-y',
                        WebkitOverflowScrolling: 'touch' as any
                    }}
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
                    className={`h-full relative shadow-xl bg-background transition-all duration-300 ease-in-out ${internalPanelOpen ? 'w-[400px]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
                    style={{ overflow: 'visible' }}
                    onClick={(e) => {
                        // 이벤트 버블링 방지 (지도 클릭으로 전파되지 않도록)
                        e.stopPropagation();
                        onPanelClick?.('detail');
                    }}
                >
                    <div ref={detailPanelRef} className="h-full w-[400px] bg-background border-l border-border">
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
