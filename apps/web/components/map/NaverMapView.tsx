'use client';

import { useEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";

import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import type { FilterState } from "@/components/filters/filter-state";
import type { Restaurant, Region } from "@/types/restaurant";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { NaverMapLoadErrorState } from "@/components/map/map-view-status-panels";
import { NaverMapSurface } from "@/components/map/naver-map-surface";
import {
    NaverMapDetailPanelShell,
    NaverMapReviewModal,
} from "@/components/map/naver-map-sidepanels";
import { useLayout } from "@/contexts/LayoutContext";
import { useDeviceType } from "@/hooks/useDeviceType";
import type Supercluster from 'supercluster';
import {
    createClusterIndex,
    restaurantsToGeoJSON,
    getClusters,
    getClusterCategories,
    isCluster,
    getClusterMaxZoom,
    getRegionalClusters,
    type ClusterProperties,
    type RegionalCluster,
    type SeoulDistrictCluster,
    getSeoulDistrictClusters,
} from "@/lib/clustering";
import { markerPool } from "@/lib/marker-pool";
import {
    createClusterMarkerHTML,
    createIndividualMarkerHTML,
    clusterAnimationManager,
    injectClusterCSS,
    removeClusterCSS
} from "@/lib/cluster-marker";
import { getNaverIndividualMarkerVisual } from "@/lib/naver-map-marker-visuals";
import {
    buildClusterMarkerContent,
    buildClusterMarkerFeature,
    buildNaverClusterAnimationIconPlan,
    buildNaverClusterMarkerRenderPlan,
    getClusterVisualKey,
} from "@/lib/naver-map-cluster-visuals";
import { perfMonitor } from "@/lib/performance-monitor";
import { useMapOptimization } from "@/hooks/useMapOptimization";
import { supabase } from "@/integrations/supabase/client";
import { calculateHoverAnchoredCenter } from "@/lib/map-hover-anchor";
import { useBannerAnnouncements } from "@/hooks/use-announcements";
import {
    buildMarkerRenderSignature,
    shouldSkipMarkerUpdate,
    type MarkerRenderSignature,
} from "@/lib/map-render-guard";
import {
    buildRestaurantLookup,
    findMatchingRestaurantInList,
} from "@/lib/map-restaurant-lookup";
import {
    buildPostSearchSwipeCandidates,
    buildRestaurantsForSwipe,
    getActiveSearchedRestaurant,
} from "@/lib/mobile-home-search-selection";
import { buildNaverRestaurantsQueryOptions } from "@/lib/map-query-helpers";
import {
    getExtendedBounds,
    getPrimaryCategory,
    isPointInSeoul,
    isRestaurantInViewport,
} from "@/lib/naver-map-view-helpers";
import {
    buildNaverMapOptions,
    getDeviceAdjustedZoom as getAdjustedZoomForDevice,
    isNaverMapInstanceReusable,
    parseNaverMapUrlState,
    resolveNaverInitialMapView,
    resolveNaverPostInitPlan,
    resolveNaverStaleMapCleanupPlan,
    scheduleNaverInitialIdleTrigger,
} from "@/lib/naver-map-init-helpers";
import {
    buildRenderTargetIdsForSignature,
    deriveClusterRenderPlan,
    getVisibleRestaurantsForRender,
    shouldReportNaverMarkerRenderPerformance,
} from "@/lib/naver-map-render-plan";
import { debounce, LruCache } from "@/lib/map-runtime-helpers";
import {
    resolveRestaurantDetailPanelElement,
    shouldResetNaverMapOnPathChange,
} from "@/lib/naver-map-ui-helpers";
import {
    getRegionalClusterTargetZoom,
    getSeoulDistrictTargetZoom,
    getSuperclusterTargetZoom,
    shouldHideInSeoulDistrictMode,
} from "@/lib/naver-map-cluster-helpers";
import { getNaverOverlayPositioning } from "@/lib/naver-map-overlay-position-helpers";
import {
    buildNaverMapDetailPanelFocusCaptureHandler,
    buildNaverMapDetailPanelMouseDownCaptureHandler,
    buildNaverMapInternalPanelCloseHandler,
    buildNaverMapInternalPanelToggleHandler,
    buildNaverMarkerRestaurantSelectionHandler,
    buildNaverMapRestaurantAction,
    buildNaverMapReviewCloseHandler,
    buildNaverMapReviewOpenHandler,
    buildNaverMapReviewSuccessHandler,
    getNaverMapReviewRestaurant,
    shouldCloseNaverInternalPanelForExternalState,
    shouldCloseNaverInternalPanelOnEscape,
} from "@/lib/naver-map-sidepanel-helpers";
import { buildNaverMapToastTrigger } from "@/lib/naver-map-toast-helpers";
import { getNaverPanelStateFlags } from "@/lib/naver-map-panel-state-helpers";
import { getNaverViewportOffset } from "@/lib/naver-map-viewport-helpers";
import { calculateNaverMobileVerticalOffset } from "@/lib/naver-map-mobile-offset-helpers";
import { calculateNaverAdjustedCenter } from "@/lib/naver-map-center-helpers";
import { buildResetUserMapMovementHandler } from "@/lib/naver-map-user-movement-helpers";
import { resolveNaverTargetOffsets } from "@/lib/naver-map-target-offset-helpers";
import { resolveNaverMapTarget } from "@/lib/naver-map-target-helpers";
import {
    resolveNaverCenteringTransitionResizePlan,
    resolveNaverLayoutShiftDelta,
    shouldPreserveNaverVisualCenterOnLayoutShift,
} from "@/lib/naver-map-layout-shift-helpers";
import {
    resolveNaverSearchSelectionPlan,
    resolveNaverSelectedRestaurantCanonicalSyncPlan,
    resolveNaverSelectedMarkerStyleUpdatePlan,
    resolveNaverSelectionChange,
} from "@/lib/naver-map-selection-helpers";
import { buildNaverPanelWidthObserver } from "@/lib/naver-map-panel-width-helpers";
import {
    buildNaverMapInteractionHandlers,
    NAVER_INTERACTION_LISTENER_OPTIONS,
} from "@/lib/naver-map-interaction-helpers";
import { buildNaverResizeObserverHandler } from "@/lib/naver-map-resize-observer-helpers";
import { focusNaverMapOnRestaurant } from "@/lib/naver-map-focus-helpers";
import { resolveNaverResizeOffsets } from "@/lib/naver-map-resize-offset-helpers";
import { buildNaverWindowResizeHandler } from "@/lib/naver-map-window-resize-helpers";
import {
    buildNaverCurrentStateSnapshot,
    getNaverCurrentPanelOffset,
} from "@/lib/naver-map-current-state-helpers";
import { resolveNaverResizePlan } from "@/lib/naver-map-resize-plan-helpers";
import {
    buildNaverWheelAnchorAdjustmentPlan,
    buildNaverWheelInput,
    buildNaverWheelProjectionAdapter,
    buildNaverWheelViewportPlan,
    clearNaverPendingAnchorAdjustListener,
    flushQueuedNaverWheelInput,
    resolveNaverWheelCleanupState,
    resolveNaverWheelZoomPlan,
    resolveNaverWheelInputDispatch,
    resolveNaverWheelPostAdjustPlan,
    type NaverWheelInput,
} from "@/lib/naver-map-wheel-helpers";

interface NaverLatLngLike {
    lat: () => number;
    lng: () => number;
}

interface NaverProjectionLike {
    fromCoordToOffset: (coord: unknown) => { x: number; y: number };
    fromOffsetToCoord: (offset: unknown) => NaverLatLngLike;
}

interface NaverMapLike {
    getBounds: () => {
        getSW: () => NaverLatLngLike;
        getNE: () => NaverLatLngLike;
        getWest: () => number;
        getSouth: () => number;
        getEast: () => number;
        getNorth: () => number;
    } | null;
    getCenter: () => NaverLatLngLike;
    getProjection: () => NaverProjectionLike;
    getZoom: () => number;
    morph: (target: unknown, zoom?: number, options?: unknown) => void;
    panBy: (x: number, y: number) => void;
    panTo: (target: unknown, options?: unknown) => void;
    setCenter: (target: unknown) => void;
    setZoom: (zoom: number, effect?: boolean) => void;
}

// 상수 정의
const PANEL_WIDTH = 400; // 상세 패널 너비 (px)
const ZOOM_DIFF_THRESHOLD = 4; // 즉시 로드할 줌 차이 임계값
const DISTANCE_KM_THRESHOLD = 50; // 즉시 로드할 거리 임계값 (km)
const MOBILE_MARKER_CENTER_FINE_TUNE_PX = -6; // 선택 마커 translateY(-5px) 시각 보정
const ONLINE_USERS_TOAST_INTERVAL_MS = 60000;
const ANNOUNCEMENT_TOAST_INTERVAL_MS = 70000;

// [성능 최적화] 가시영역 필터링 및 이벤트 처리 상수
const VIEWPORT_FILTER_ENABLED = true; // 가시영역 필터링 활성화
const VIEWPORT_PADDING = 0.05; // 가시영역 여백 (5% 확장)

// 클러스터링 상수 (네이버 지도 스타일)
const ENABLE_CLUSTERING = true; // 클러스터링 전체 활성화
// [OPTIMIZATION] 클러스터 반경, 최소 포인트, 애니메이션은 useMapOptimization 훅에서 동적으로 결정

// [Zoom Control] 지도 최소/최대 줌 레벨
const MIN_ZOOM = 6;
const MAX_ZOOM = 18;

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
    mobileSheetHeightPercent?: number; // 모바일 바텀시트 높이(%) - 마커 Y축 중앙 보정
    onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;
    onSearchSelectionRelease?: () => void;
}

/**
 * [OPTIMIZATION] HTML 마커 콘텐츠 캐시 (LRU 기반)
 * 각 레스토랑의 선택/비선택 상태별로 HTML을 캐싱하여 재사용
 */
const markerContentCache = new LruCache<string, string>(500);

const NaverMapView = memo(({
    mapFocusZoom,
    filters,
    selectedRegion,
    searchedRestaurant,
    selectedRestaurant,
    refreshTrigger: _refreshTrigger,
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
    mobileSheetHeightPercent = 0,
    onVisibleRestaurantsChange,
    onSearchSelectionRelease,
}: NaverMapViewProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<NaverMapLike | null>(null);
    const markerRenderSignatureRef = useRef<MarkerRenderSignature | null>(null);
    const previousSearchedRestaurantRef = useRef<Restaurant | null>(null); // 이전 searchedRestaurant 추적
    const releasedSearchSelectionIdRef = useRef<string | null>(null);
    const detailPanelRef = useRef<HTMLDivElement>(null); // 상세 패널 참조
    const prevSelectedRestaurantIdRef = useRef<string | null>(null); // 이전 선택된 레스토랑 ID 추적 (동일 마커 재클릭 감지용)
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
        return getAdjustedZoomForDevice(baseZoom, isMobileOrTablet, isNational);
    }, [isMobileOrTablet]);

    // 네이버 지도 API 로드 - LCP 최적화를 위해 lazyOnload 전략 사용
    const { isLoaded, loadError } = useNaverMaps({ autoLoad: true, strategy: 'lazyOnload' });
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [internalPanelOpen, setInternalPanelOpen] = useState(false);
    const [showRestaurantCount, setShowRestaurantCount] = useState(false);
    const [showOnlineUsers, setShowOnlineUsers] = useState(false);
    const [onlineUsersCount, setOnlineUsersCount] = useState(0);
    const [showAnnouncementToast, setShowAnnouncementToast] = useState(false);
    const [announcementToastTitle, setAnnouncementToastTitle] = useState('');
    const [announcementToastId, setAnnouncementToastId] = useState<string | null>(null);
    const announcementToastIndexRef = useRef(0);
    const announcementToastHideTimerRef = useRef<NodeJS.Timeout | null>(null);
    const announcementToastInitialTimerRef = useRef<NodeJS.Timeout | null>(null);
    const { data: bannerAnnouncements = [] } = useBannerAnnouncements();
    const [isMapInitialized, setIsMapInitialized] = useState(false);

    const activeSearchedRestaurant = useMemo(() => getActiveSearchedRestaurant({
        searchedRestaurant,
        selectedRestaurant,
    }), [searchedRestaurant, selectedRestaurant]);

    const releaseSearchSelectionOnUserInteraction = useCallback(() => {
        if (!activeSearchedRestaurant || !onSearchSelectionRelease) {
            return;
        }

        if (releasedSearchSelectionIdRef.current === activeSearchedRestaurant.id) {
            return;
        }

        releasedSearchSelectionIdRef.current = activeSearchedRestaurant.id;
        onSearchSelectionRelease();
    }, [activeSearchedRestaurant, onSearchSelectionRelease]);

    const handleDetailPanelMouseDownCapture = useMemo(
        () => buildNaverMapDetailPanelMouseDownCaptureHandler(onPanelClick),
        [onPanelClick]
    );

    const handleDetailPanelFocusCapture = useMemo(
        () => buildNaverMapDetailPanelFocusCaptureHandler(onPanelClick),
        [onPanelClick]
    );


    // [Fix] 라우트 변경 감지 - 다른 페이지 갔다가 돌아왔을 때 지도 재초기화
    const pathname = usePathname();
    const prevPathnameRef = useRef(pathname);

    useEffect(() => {
        if (shouldResetNaverMapOnPathChange(prevPathnameRef.current, pathname)) {
            // 지도 인스턴스 및 마커 정리
            if (mapInstanceRef.current) {
                markerPool.clear();
                clusterAnimationManager.clear();
                mapInstanceRef.current = null;
                markerRenderSignatureRef.current = null;
                setIsMapInitialized(false);
            }
        }
        prevPathnameRef.current = pathname;
    }, [pathname]);

    // 지역 변경 시 사용자 지도 이동 플래그 리셋 (지역 재선택 시에도 지도 이동 가능하도록)
    useEffect(() => {
        const handleResetUserMapMovement = buildResetUserMapMovementHandler(hasUserMovedMapRef);

        window.addEventListener('resetUserMapMovement', handleResetUserMapMovement);
        return () => {
            window.removeEventListener('resetUserMapMovement', handleResetUserMapMovement);
        };
    }, []);

    // [OPTIMIZATION] ResizeObserver로 패널 너비 자동 감지
    useEffect(() => {
        const panelElement = resolveRestaurantDetailPanelElement(document);

        if (!panelElement) {
            // 패널이 아직 로드되지 않았을 수 있으므로 경고 없이 종료
            return;
        }

        const { cancelPending, observerCallback } = buildNaverPanelWidthObserver({
            setPanelWidth,
        });
        let rafId: number | null = null;
        const observer = new ResizeObserver(observerCallback);

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
            cancelPending();
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
            markerRenderSignatureRef.current = null;
        };
    }, [mapOptimization.clusterAnimationEnabled, mapOptimization.clusterAnimationInterval]);

    // ... (중략) ...

    const handleMarkerRestaurantSelection = useMemo(
        () => buildNaverMarkerRestaurantSelectionHandler({
            hasUserMovedMapRef,
            onMarkerClick,
            onRestaurantSelect,
            setInternalPanelOpen,
        }),
        [onMarkerClick, onRestaurantSelect]
    );


    // [커스텀 토스트] 지도 상단 중앙 알림 상태
    const [mapToast, setMapToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null>(null);

    const showMapToast = useMemo(
        () => buildNaverMapToastTrigger(setMapToast),
        []
    );

    const handleCloseInternalPanel = useMemo(
        () => buildNaverMapInternalPanelCloseHandler(setInternalPanelOpen),
        []
    );

    const handleOpenReviewModal = useMemo(
        () => buildNaverMapReviewOpenHandler(setIsReviewModalOpen),
        []
    );

    const handleCloseReviewModal = useMemo(
        () => buildNaverMapReviewCloseHandler(setIsReviewModalOpen),
        []
    );

    const handleToggleInternalPanel = useMemo(
        () => buildNaverMapInternalPanelToggleHandler({ internalPanelOpen, setInternalPanelOpen }),
        [internalPanelOpen]
    );

    const handleEditSelectedRestaurant = useMemo(
        () => buildNaverMapRestaurantAction(onAdminEditRestaurant, selectedRestaurant),
        [onAdminEditRestaurant, selectedRestaurant]
    );

    const handleRequestEditSelectedRestaurant = useMemo(
        () => buildNaverMapRestaurantAction(onRequestEditRestaurant, selectedRestaurant),
        [onRequestEditRestaurant, selectedRestaurant]
    );

    // UI 오버레이 위치 계산 (지도 중심 보정)
    // 오른쪽 패널이 열려있을 때, 오버레이들을 "남은 지도 영역"의 중앙에 배치하기 위함

    // [중요] 오프셋 계산 로직 개선 (2024-Fix)
    const {
        isExternalPanelOpen,
        isShrinkingLayout,
    } = getNaverPanelStateFlags({
        externalPanelOpen,
        internalPanelOpen,
        isGridMode,
        onMarkerClick,
    });

    // 유효 패널 너비 (오프셋 계산용)
    const {
        effectivePanelOffset,
        centerOffsetStyle,
        floatingBadgePositionClass,
        floatingToastPositionClass,
    } = getNaverOverlayPositioning({
        isExternalPanelOpen,
        isGridMode,
        isMobileOrTablet,
        isPanelCollapsed,
        isPanelOpen: !!propIsPanelOpen,
        isShrinkingLayout,
        panelWidth: PANEL_WIDTH,
    });

    // 외부에서 패널 닫기 요청 시 닫기 (externalPanelOpen이 false면 닫기)
    useEffect(() => {
        if (shouldCloseNaverInternalPanelForExternalState(externalPanelOpen)) {
            setInternalPanelOpen(false);
        }
    }, [externalPanelOpen]);

    // ESC 키로 패널 닫기 (접근성 향상)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (shouldCloseNaverInternalPanelOnEscape({
                key: e.key,
                internalPanelOpen,
                isGridMode,
            })) {
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
            return calculateNaverAdjustedCenter({
                centerLat: lat,
                centerLng: lng,
                currentZoom,
                targetZoom,
                offsetX,
                offsetY,
                projection,
                createLatLng: (nextLat, nextLng) => new window.naver.maps.LatLng(nextLat, nextLng),
                createPoint: (x, y) => new window.naver.maps.Point(x, y),
            });
        } catch (e) {
            console.error("좌표 계산 실패:", e);
            return new window.naver.maps.LatLng(lat, lng);
        }
    };

    // [Helper] 실시간 뷰포트 오프셋 계산 (ResizeObserver 기반)
    // 패널의 실제 너비를 state로 관리하여 정확한 오프셋 반환
    const getViewportOffset = useCallback((): number => {
        return getNaverViewportOffset({
            externalPanelOpen,
            internalPanelOpen,
            isGridMode,
            isMobileOrTablet,
            isPanelCollapsed,
            onMarkerClick,
            panelWidth,
            propIsPanelOpen,
        });
    }, [isMobileOrTablet, onMarkerClick, internalPanelOpen, isGridMode, isPanelCollapsed, propIsPanelOpen, externalPanelOpen, panelWidth]);

    const getMobileVerticalOffset = useCallback(() => {
        if (!isMobileOrTablet) return 0;

        const navHeight = parseFloat(
            getComputedStyle(document.documentElement)
                .getPropertyValue('--mobile-bottom-nav-effective-height')
        ) || 60;

        const vh = window.visualViewport?.height ?? window.innerHeight;

        return calculateNaverMobileVerticalOffset({
            fineTunePx: MOBILE_MARKER_CENTER_FINE_TUNE_PX,
            navHeight,
            sheetHeightPercent: mobileSheetHeightPercent,
            viewportHeight: vh,
        });
    }, [isMobileOrTablet, mobileSheetHeightPercent]);

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

        const { isSelectionChanged, nextSelectedId } = resolveNaverSelectionChange({
            currentSelectedId,
            previousSelectedId: prevSelectedRestaurantIdRef.current,
        });
        prevSelectedRestaurantIdRef.current = nextSelectedId;

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
        const currentMapZoom = map.getZoom();

        const { urlLat, urlLng, urlZoom } = parseNaverMapUrlState(window.location.search);

        const target = resolveNaverMapTarget({
            currentMapZoom,
            getDeviceAdjustedZoom,
            mapFocusZoom,
            selectedRegion,
            selectedRestaurant,
            urlLat,
            urlLng,
            urlZoom: urlZoom ?? Number.NaN,
        });

        if (target.skip) {
            return;
        }
        const { targetLat, targetLng, targetZoom } = target;

        // [최적화] 실시간 뷰포트 오프셋 계산
        // DOM 요소의 실제 너비를 측정하여 정확한 중앙 배치
        const effectiveOffset = getViewportOffset();

        // [Note] 패널 상태에 따른 지도 중심 오프셋 계산
        // 우측 패널이 열리면 지도의 "시각적 중심"이 왼쪽으로 이동해야 합니다.
        // 즉, 지도 중심(Center) 좌표를 패널 너비의 절반만큼 오른쪽으로 이동시켜야
        // 타겟(맛집)이 왼쪽 "보이는 영역"의 중앙에 위치하게 됩니다.
        // targetOffsetX = effectiveOffset / 2 (양수 = 오른쪽 이동)
        // 모바일/태블릿에서는 항상 0

        const { targetOffsetX, targetOffsetY } = resolveNaverTargetOffsets({
            effectiveOffset,
            isMobileOrTablet,
            mobileVerticalOffset: getMobileVerticalOffset(),
        });

        // **핵심 로직 변경**
        const currentZoom = map.getZoom();

        // [Case 1] 사용자가 직접 이동했고, 선택 변경이 없는 경우 (User Moved + Layout Change only)
        // -> 현재 보고 있는 시각적 중심(Visual Center)을 유지해야 함.
        // 하지만 "패널이 열리고 닫힘"에 따라 "보이는 영역"이 달라지므로,
        // "현재의 Visual Center"가 "새로운 Layout의 Visual Center"가 되도록 지도 Center를 조정해야 함.
        // 즉, "지리적 위치"를 고정하고 오프셋만 반영.
        if (shouldPreserveNaverVisualCenterOnLayoutShift({
            hasUserMovedMap: hasUserMovedMapRef.current,
            isSelectionChanged,
        })) {
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

            const { deltaX, shouldPan } = resolveNaverLayoutShiftDelta({
                effectiveOffset,
                previousOffset: currentStateRef.current.effectivePanelOffset,
            });

            if (shouldPan) {

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

        // 리사이즈 먼저 트리거
        const transitionResizePlan = resolveNaverCenteringTransitionResizePlan();
        naver.maps.Event.trigger(map, transitionResizePlan.initialResizeEvent);

        const newCenterLatLng = getAdjustedCenter(targetLat, targetLng, targetZoom, targetOffsetX, targetOffsetY);
        map.setZoom(targetZoom);
        map.setCenter(newCenterLatLng);

        // [FIX] 트랜지션 완료 후 resize만 트리거 (moveMap 중복 호출 제거 - ResizeObserver가 처리함)
        const transitionTimer = setTimeout(() => {
            naver.maps.Event.trigger(map, transitionResizePlan.followupResizeEvent);
        }, transitionResizePlan.followupResizeDelayMs);

        // 사용자 상호작용 감지 리스너 추가
        // Naver Maps API 이벤트뿐만 아니라 DOM 이벤트도 감지하여 더 정확하게 처리 (휠 줌, 더블 클릭 등)
        const { handleSearchReleaseInteraction, handleUserInteraction } = buildNaverMapInteractionHandlers({
            hasUserMovedMapRef,
            releaseSearchSelectionOnUserInteraction,
        });

        const mapElement = mapRef.current;
        if (mapElement) {
            // 캡처링 단계에서 이벤트 감지 (지도 내부 로직보다 먼저 실행)
            mapElement.addEventListener('wheel', handleSearchReleaseInteraction, NAVER_INTERACTION_LISTENER_OPTIONS);
            mapElement.addEventListener('dblclick', handleSearchReleaseInteraction, NAVER_INTERACTION_LISTENER_OPTIONS);
            mapElement.addEventListener('mousedown', handleUserInteraction, NAVER_INTERACTION_LISTENER_OPTIONS);
            mapElement.addEventListener('touchstart', handleUserInteraction, NAVER_INTERACTION_LISTENER_OPTIONS);
        }

        const dragListener = naver.maps.Event.addListener(map, 'dragstart', handleSearchReleaseInteraction);
        const pinchListener = naver.maps.Event.addListener(map, 'pinchstart', handleSearchReleaseInteraction);

        return () => {
            clearTimeout(transitionTimer);
            naver.maps.Event.removeListener(dragListener);
            naver.maps.Event.removeListener(pinchListener);

            if (mapElement) {
                mapElement.removeEventListener('wheel', handleSearchReleaseInteraction, { capture: true });
                mapElement.removeEventListener('dblclick', handleSearchReleaseInteraction, { capture: true });
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
        isSidebarOpen, // 사이드바 토글 시에도 중심 재조정 로직 실행
        getDeviceAdjustedZoom,
        getMobileVerticalOffset,
        getViewportOffset,
        isMobileOrTablet,
        mapFocusZoom,
        mobileSheetHeightPercent,
        releaseSearchSelectionOnUserInteraction,
    ]);

    // 리사이즈 시 참조할 최신 상태 Ref 업데이트
    const currentStateRef = useRef(buildNaverCurrentStateSnapshot({
        isSidebarOpen,
        externalPanelOpen,
        isPanelCollapsed,
        isGridMode,
        effectivePanelOffset: 0,
    }));

    useEffect(() => {
        currentStateRef.current = buildNaverCurrentStateSnapshot({
            isSidebarOpen,
            externalPanelOpen,
            isPanelCollapsed,
            isGridMode,
            effectivePanelOffset,
        });
    }, [isSidebarOpen, externalPanelOpen, isPanelCollapsed, isGridMode, effectivePanelOffset]);

    // [개선] ResizeObserver를 사용하여 컨테이너 크기 변경 감지 및 부드러운 중심 유지
    useEffect(() => {
        if (!mapRef.current || !mapInstanceRef.current || !isMapInitialized) return;

        const map = mapInstanceRef.current;
        const { naver } = window;

        const handleResize = () => {
            // 1. 지도 리사이즈 트리거
            naver.maps.Event.trigger(map, 'resize');

            const { urlLat, urlLng, urlZoom } = parseNaverMapUrlState(window.location.search);
            const resizePlan = resolveNaverResizePlan({
                currentCenter: map.getCenter(),
                currentZoom: map.getZoom(),
                effectivePanelOffset: getNaverCurrentPanelOffset(currentStateRef.current),
                getAdjustedCenter,
                hasUserMoved: hasUserMovedMapRef.current,
                isGridMode: currentStateRef.current.isGridMode,
                isMobileOrTablet,
                mobileVerticalOffset: getMobileVerticalOffset(),
                selectedRegion,
                selectedRestaurant,
                urlLat,
                urlLng,
                urlZoom: urlZoom ?? Number.NaN,
            });

            if (resizePlan.skip) {
                return;
            }

            // 애니메이션 없이 즉시 이동 (부드러움 유지)
            map.setCenter(resizePlan.newCenterLatLng);
        };

        const { cancel, observerCallback } = buildNaverResizeObserverHandler({
            runAfterTransition: handleResize,
            triggerResize: () => {
                naver.maps.Event.trigger(map, 'resize');
            },
        });
        const resizeObserver = new ResizeObserver(observerCallback);

        resizeObserver.observe(mapRef.current);

        return () => {
            resizeObserver.disconnect();
            cancel();
        };
    }, [getMobileVerticalOffset, isMapInitialized, isMobileOrTablet, selectedRestaurant, selectedRegion]);

    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동
    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동 (디바운스 적용)
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const { cancel, handleWindowResize } = buildNaverWindowResizeHandler({
            getMap: () => mapInstanceRef.current,
            triggerResize: (map) => {
                naver.maps.Event.trigger(map, 'resize');
            },
        });

        window.addEventListener('resize', handleWindowResize, { passive: true });
        return () => {
            window.removeEventListener('resize', handleWindowResize);
            cancel();
        };
    }, []);

    // useRestaurants 옵션 메모이제이션
    const restaurantQueryOptions = useMemo(() => buildNaverRestaurantsQueryOptions({
        filters,
        isLoaded,
        selectedRegion,
    }), [filters, isLoaded, selectedRegion]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants(restaurantQueryOptions);

    const handleReviewSuccess = useMemo(
        () => buildNaverMapReviewSuccessHandler({ refetch, showMapToast }),
        [refetch, showMapToast]
    );

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
                    if (!Array.isArray(presences)) return;
                    presences.forEach((presence) => {
                        if (!presence || typeof presence !== 'object') {
                            uniqueUserIds.add(presenceKey);
                            return;
                        }
                        const typedPresence = presence as { user_id?: string; presence_ref?: string };
                        uniqueUserIds.add(typedPresence.user_id || typedPresence.presence_ref || presenceKey);
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

        // 60초마다 동시 접속자 토스트 표시
        const interval = setInterval(showOnlineToast, ONLINE_USERS_TOAST_INTERVAL_MS);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(interval);
            if (initialTimerRef.current) clearTimeout(initialTimerRef.current);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, [isLoaded]); // isLoaded만 의존성으로

    // 공지사항 배너 내용 주기 노출
    useEffect(() => {
        if (!isLoaded || bannerAnnouncements.length === 0) {
            setShowAnnouncementToast(false);
            setAnnouncementToastTitle('');
            if (announcementToastInitialTimerRef.current) clearTimeout(announcementToastInitialTimerRef.current);
            if (announcementToastHideTimerRef.current) clearTimeout(announcementToastHideTimerRef.current);
            return;
        }

        const showAnnouncementBadge = () => {
            const index = announcementToastIndexRef.current % bannerAnnouncements.length;
            const announcement = bannerAnnouncements[index];
            if (!announcement) return;

            setAnnouncementToastTitle(announcement.title);
            setAnnouncementToastId(announcement.id);
            setShowAnnouncementToast(true);

            announcementToastIndexRef.current = (announcementToastIndexRef.current + 1) % bannerAnnouncements.length;

            if (announcementToastHideTimerRef.current) clearTimeout(announcementToastHideTimerRef.current);
            announcementToastHideTimerRef.current = setTimeout(() => {
                setShowAnnouncementToast(false);
            }, 4200);
        };

        if (announcementToastInitialTimerRef.current) clearTimeout(announcementToastInitialTimerRef.current);
        announcementToastInitialTimerRef.current = setTimeout(showAnnouncementBadge, 9000);

        const interval = setInterval(showAnnouncementBadge, ANNOUNCEMENT_TOAST_INTERVAL_MS);

        return () => {
            clearInterval(interval);
            if (announcementToastInitialTimerRef.current) clearTimeout(announcementToastInitialTimerRef.current);
            if (announcementToastHideTimerRef.current) clearTimeout(announcementToastHideTimerRef.current);
        };
    }, [bannerAnnouncements, isLoaded]);

    const handleAnnouncementToastClick = useCallback(() => {
        if (!announcementToastId) return;
        const targetAnnouncement = bannerAnnouncements.find((announcement) => announcement.id === announcementToastId);
        if (!targetAnnouncement) return;

        window.dispatchEvent(new CustomEvent('openAnnouncementDetail', { detail: targetAnnouncement }));
    }, [announcementToastId, bannerAnnouncements]);

    // 표시할 마커 데이터 (로딩 중에는 이전 데이터를 사용) - 메모이제이션
    const displayRestaurants = useMemo(() => {
        return isLoadingRestaurants && previousRestaurants.length > 0 ? previousRestaurants : restaurants;
    }, [isLoadingRestaurants, previousRestaurants, restaurants]);

    const restaurantLookup = useMemo(() => buildRestaurantLookup(displayRestaurants), [displayRestaurants]);
    const { byId: restaurantById, idSet: displayRestaurantIds, mergedRestaurantIds, mergedRestaurantById } = restaurantLookup;
    const restaurantsForSwipe = useMemo(() => buildRestaurantsForSwipe({
        activeSearchedRestaurant,
        displayRestaurantIds,
        displayRestaurants,
    }), [activeSearchedRestaurant, displayRestaurants, displayRestaurantIds]);

    useEffect(() => {
        if (!activeSearchedRestaurant) {
            releasedSearchSelectionIdRef.current = null;
            return;
        }

        if (releasedSearchSelectionIdRef.current && releasedSearchSelectionIdRef.current !== activeSearchedRestaurant.id) {
            releasedSearchSelectionIdRef.current = null;
        }
    }, [activeSearchedRestaurant]);

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
    }, [displayRestaurants, selectedRegion, isMapInitialized, mapOptimization]);

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
    }, [displayRestaurants, isMapInitialized, mapOptimization.idleDebounceMs]);



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

        const effectiveMaxZoom = getClusterMaxZoom(selectedRegion);
        const {
            shouldCluster,
            shouldUseRegionalCluster,
            shouldUseSeoulDistrictCluster,
            nextIsRegionalClusterMode,
            nextIsSeoulDistrictMode,
            nextIsClusterMode,
            seoulClustersToRender,
            shouldUseSeoulDistrictFiltered,
        } = deriveClusterRenderPlan(
            currentZoom,
            Boolean(selectedRegion),
            effectiveMaxZoom,
            seoulDistrictClusters,
            seoulDistrictClustersFiltered,
        );

        // 모드 설정
        setIsRegionalClusterMode(nextIsRegionalClusterMode);
        setIsSeoulDistrictMode(nextIsSeoulDistrictMode);
        setIsClusterMode(nextIsClusterMode);

        const visibleRestaurants = getVisibleRestaurantsForRender(
            restaurantsForSwipe,
            selectedRestaurant?.id ?? null,
            extendedBounds,
            VIEWPORT_FILTER_ENABLED,
        );
        const swipeCandidates = buildPostSearchSwipeCandidates({
            visibleRestaurants,
            allRestaurants: restaurantsForSwipe,
            activeSearchedRestaurant,
        });

        onVisibleRestaurantsChange?.(swipeCandidates);

        const renderTargetIdsForSignature = buildRenderTargetIdsForSignature({
            activeSearchedRestaurant,
            clusters,
            displayRestaurantIds,
            displayRestaurants,
            mergedRestaurantById,
            nextIsClusterMode,
            nextIsRegionalClusterMode,
            nextIsSeoulDistrictMode,
            regionalClusters,
            restaurantById,
            seoulClustersToRender,
            seoulIndividualIds: shouldUseSeoulDistrictFiltered ? seoulIndividualIds : [],
        });

        const nextMarkerRenderSignature = buildMarkerRenderSignature({
            zoom: currentZoom,
            bounds: extendedBounds,
            displayRestaurantIds: renderTargetIdsForSignature,
            selectedRestaurantId: selectedRestaurant?.id || null,
            searchedRestaurantId: activeSearchedRestaurant?.id || null,
            isClusterMode: nextIsClusterMode,
            isRegionalClusterMode: nextIsRegionalClusterMode,
            isSeoulDistrictMode: nextIsSeoulDistrictMode,
        });

        const previousMarkerRenderSignature = markerRenderSignatureRef.current;
        if (previousMarkerRenderSignature && shouldSkipMarkerUpdate(previousMarkerRenderSignature, nextMarkerRenderSignature)) {
            perfMonitor.endMeasure('RenderMarkers');
            return;
        }

        markerRenderSignatureRef.current = nextMarkerRenderSignature;

        // 헬퍼: 클러스터 마커 렌더링 (중복 로직 제거)
        const renderClusterHelper = (
            markerId: string,
            position: { lat: number, lng: number },
            count: number,
            categories: string[],
            uniqueKey: string | number,
            onClick: () => void
        ) => {
            const hash = getClusterVisualKey(uniqueKey);

            clusterAnimationManager.register(hash);
            const currentIndex = clusterAnimationManager.getCurrentIndex(hash, categories.length);
            const renderPlan = buildNaverClusterMarkerRenderPlan({
                categories,
                count,
                currentIndex,
                position,
            });

            markerPool.acquire(
                markerId,
                new naver.maps.LatLng(renderPlan.position.lat, renderPlan.position.lng),
                { content: renderPlan.content, anchor: new naver.maps.Point(renderPlan.anchor.x, renderPlan.anchor.y) },
                map,
                onClick
            );
        };

        if (shouldUseRegionalCluster) {
            // ===== 17개 행정구역 중앙 클러스터 모드 =====
            if (regionalClusters.length === 0) {
                perfMonitor.endMeasure('RenderMarkers');
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
                            const currentZoom = map.getZoom();
                            const targetZoom = getRegionalClusterTargetZoom(currentZoom);
                            morphWithPanelOffset(cluster.center.lat, cluster.center.lng, targetZoom);
                        }
                    );
            });

            // 사용하지 않는 마커 반환
            markerPool.releaseExcept(activeIds);
            perfMonitor.endMeasure('RenderMarkers');
            if (shouldReportNaverMarkerRenderPerformance({
                activeMarkerCount: activeIds.size,
                isDevelopment: process.env.NODE_ENV === 'development',
            })) {
                perfMonitor.report();
            }

        } else {
            // ===== 복합 모드: 서울 자치구 (선택적) + Supercluster/개별 마커 =====
            const activeIds = new Set<string>();

            // 1. 서울 자치구 클러스터 (우선 순위 레이어)
            // 줌 9-10: 모든 자치구 25개 클러스터 (seoulDistrictClusters)
            // 줌 11-12: 마커 3개 이상인 구만 클러스터 (seoulDistrictClustersFiltered)
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
                            const currentZoom = map.getZoom();
                            const targetZoom = getSeoulDistrictTargetZoom(currentZoom);
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
                    const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);

                    markerPool.acquire(
                        restaurant.id,
                        new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                        { content: visual.content, anchor: new naver.maps.Point(visual.anchor.x, visual.anchor.y) },
                        map,
                        () => handleMarkerRestaurantSelection(restaurant)
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
                        if (shouldHideInSeoulDistrictMode({
                            address: feature.properties.address,
                            isPointInSeoul: isPointInSeoul(lat, lng),
                            shouldUseSeoulDistrictCluster,
                        })) {
                            return;
                        }

                        if (isCluster(feature)) {
                            const clusterId = feature.properties.cluster_id!;
                            const markerId = `cluster-${clusterId}`;
                            activeIds.add(markerId);

                            clusterAnimationManager.register(clusterId);

                            let categories: string[];
                            try {
                                categories = getClusterCategories(clusterIndexRef.current!, clusterId);
                            } catch { categories = []; }

                            renderClusterHelper(
                                markerId,
                                { lat, lng },
                                feature.properties.point_count || 0,
                                categories,
                                clusterId,
                                () => {
                                    const expansionZoom = clusterIndexRef.current!.getClusterExpansionZoom(clusterId);
                                    const currentZoom = map.getZoom();
                                    const targetZoom = getSuperclusterTargetZoom(currentZoom, expansionZoom);
                                    morphWithPanelOffset(lat, lng, targetZoom);
                                }
                            );
                        } else {
                            // 클러스터 모드 내의 개별 마커
                            const restaurantId = feature.properties.restaurantId;
                            activeIds.add(restaurantId);
                            const category = feature.properties.category;
                            const isSelected = selectedRestaurant?.id === restaurantId;
                            const visual = getNaverIndividualMarkerVisual({ categories: [], category }, isSelected);

                            markerPool.acquire(
                                restaurantId,
                                new naver.maps.LatLng(lat, lng),
                                { content: visual.content, anchor: new naver.maps.Point(visual.anchor.x, visual.anchor.y) },
                                map,
                                () => {
                                    // ... existing click logic ...
                                    const restaurant = restaurantById.get(restaurantId) ?? mergedRestaurantById.get(restaurantId);
                                    if (restaurant) {
                                        handleMarkerRestaurantSelection(restaurant);
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

                visibleRestaurants.forEach(restaurant => {
                    if (!restaurant.lat || !restaurant.lng) return;

                    // [Logic] Seoul District Mode가 켜져있다면, 서울 내부의 개별 마커는 숨김 (District Cluster가 대신함)
                    if (shouldHideInSeoulDistrictMode({
                        address: restaurant.road_address || restaurant.jibun_address || '',
                        isPointInSeoul: isPointInSeoul(restaurant.lat, restaurant.lng),
                        shouldUseSeoulDistrictCluster,
                    })) {
                        return;
                    }

                    activeIds.add(restaurant.id);
                    const isSelected = selectedRestaurant?.id === restaurant.id;
                    const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);

                    markerPool.acquire(
                        restaurant.id,
                        new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                        { content: visual.content, anchor: new naver.maps.Point(visual.anchor.x, visual.anchor.y) },
                        map,
                        () => handleMarkerRestaurantSelection(restaurant)
                    );
                });
            }

            // Cleanup
            markerPool.releaseExcept(activeIds);

            // [PERFORMANCE] 렌더링 종료 시간 측정 및 로그 (개발 모드)
            perfMonitor.endMeasure('RenderMarkers');
            if (shouldReportNaverMarkerRenderPerformance({
                activeMarkerCount: activeIds.size,
                isDevelopment: process.env.NODE_ENV === 'development',
            })) {
                perfMonitor.report();
            }
        }

    }, [clusters, regionalClusters, seoulDistrictClusters, seoulDistrictClustersFiltered, seoulIndividualIds, activeSearchedRestaurant, displayRestaurants, displayRestaurantIds, restaurantById, mergedRestaurantById, restaurantsForSwipe, selectedRegion, selectedRestaurant?.id, isClusterMode, isRegionalClusterMode, isSeoulDistrictMode, isMapInitialized, morphWithPanelOffset, onMarkerClick, onRestaurantSelect, onVisibleRestaurantsChange, handleMarkerRestaurantSelection]);

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
                        const iconPlan = buildNaverClusterAnimationIconPlan({
                            categories: cluster.categories,
                            count: cluster.count,
                            getCurrentIndex: (hash, categoryCount) =>
                                clusterAnimationManager.getCurrentIndex(hash, categoryCount),
                            position: cluster.center,
                            uniqueKey: cluster.region,
                        });

                        marker.setIcon({
                            content: iconPlan.content,
                            anchor: new window.naver.maps.Point(iconPlan.anchor.x, iconPlan.anchor.y),
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
                        const iconPlan = buildNaverClusterAnimationIconPlan({
                            categories: cluster.categories,
                            count: cluster.count,
                            getCurrentIndex: (hash, categoryCount) =>
                                clusterAnimationManager.getCurrentIndex(hash, categoryCount),
                            position: cluster.center,
                            uniqueKey: cluster.region,
                        });
                        marker.setIcon({
                            content: iconPlan.content,
                            anchor: new window.naver.maps.Point(iconPlan.anchor.x, iconPlan.anchor.y),
                        });
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
                            } catch {
                                // ignore
                            }

                            const [lng, lat] = feature.geometry.coordinates;
                            const iconPlan = buildNaverClusterAnimationIconPlan({
                                categories,
                                count: feature.properties.point_count || 0,
                                getCurrentIndex: (hash, categoryCount) =>
                                    clusterAnimationManager.getCurrentIndex(hash, categoryCount),
                                position: { lat, lng },
                                uniqueKey: clusterId,
                            });

                            marker.setIcon({
                                content: iconPlan.content,
                                anchor: new window.naver.maps.Point(iconPlan.anchor.x, iconPlan.anchor.y),
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
        const styleUpdatePlan = resolveNaverSelectedMarkerStyleUpdatePlan({
            currentSelectedId,
            previousSelectedId: prevSelectedId,
        });

        // 동일한 마커 재선택 시 스킵
        if (styleUpdatePlan.shouldSkip) {
            return;
        }

        // [CRITICAL OPTIMIZATION] 전체 순회(O(N)) 대신 2개 마커만 업데이트(O(1))
        const { naver } = window;

        styleUpdatePlan.updates.forEach(({ isSelected, restaurantId }) => {
            const marker = markerPool.get(restaurantId);
            if (marker) {
                const restaurant = restaurantById.get(restaurantId) ?? mergedRestaurantById.get(restaurantId);
                if (restaurant) {
                    const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);

                    markerPool.update(restaurantId, {
                        icon: {
                            content: visual.content,
                            anchor: new naver.maps.Point(visual.anchor.x, visual.anchor.y)
                        },
                        zIndex: visual.zIndex
                    });
                }
            }
        });

        // ref 업데이트
        prevSelectedMarkerIdRef.current = styleUpdatePlan.nextPreviousSelectedId;
        prevSelectedRestaurantIdRef.current = styleUpdatePlan.nextPreviousSelectedId;

    }, [selectedRestaurant, gridSelectedRestaurant, isGridMode, displayRestaurants, restaurantById, mergedRestaurantById]);


    // selectedRestaurant이 기존 데이터와 다른 경우 기존 데이터로 교체
    useEffect(() => {
        const syncPlan = resolveNaverSelectedRestaurantCanonicalSyncPlan({
            displayRestaurants,
            selectedRestaurant,
        });

        if (syncPlan.shouldSyncParentSelection && syncPlan.canonicalRestaurant && onRestaurantSelect) {
            onRestaurantSelect(syncPlan.canonicalRestaurant);
        }
    }, [selectedRestaurant, onRestaurantSelect, displayRestaurants]);



    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current) return;

        // 기존 인스턴스가 유효하면 재초기화 불필요
        if (isNaverMapInstanceReusable({
            mapElement: mapRef.current,
            mapInstance: mapInstanceRef.current,
        })) return;

        // 유효하지 않은 기존 인스턴스 정리
        const staleMapCleanupPlan = resolveNaverStaleMapCleanupPlan({
            mapInstance: mapInstanceRef.current,
        });
        if (staleMapCleanupPlan.shouldCleanup) {
            markerPool.clear();
            clusterAnimationManager.clear();
            mapInstanceRef.current = staleMapCleanupPlan.nextMapInstance;
            markerRenderSignatureRef.current = staleMapCleanupPlan.nextMarkerRenderSignature;
            setIsMapInitialized(staleMapCleanupPlan.nextIsMapInitialized);
        }

        try {
            const { naver } = window;

            const { hasValidUrlState, initialCenter, initialZoom } = resolveNaverInitialMapView({
                getDeviceAdjustedZoom,
                search: window.location.search,
                selectedRegion,
            });

            const map = new naver.maps.Map(mapRef.current, buildNaverMapOptions({
                center: new naver.maps.LatLng(initialCenter[0], initialCenter[1]),
                positionTopLeft: naver.maps.Position.TOP_LEFT,
                positionTopRight: naver.maps.Position.TOP_RIGHT,
                zoom: initialZoom,
            }));

            mapInstanceRef.current = map;
            setIsMapInitialized(true);
            const postInitPlan = resolveNaverPostInitPlan({
                hasValidUrlState,
                nodeEnv: process.env.NODE_ENV,
            });
            if (postInitPlan.shouldExposeDebugMap) {
                (window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown }).__TZUDONG_DEBUG_MAP__ = map;
            }

            // [Fix] URL 파라미터로 초기화된 경우 플래그 설정 (centering effect에서 줌 오버라이드 방지)
            if (postInitPlan.shouldMarkInitialLoadFromUrl) {
                isInitialLoadFromUrlRef.current = true;
            }

            // [Fix] 지도 초기화 후 idle 이벤트 강제 트리거 - 클러스터 초기화 보장
            scheduleNaverInitialIdleTrigger({
                map,
                triggerIdle: (targetMap) => {
                    naver.maps.Event.trigger(targetMap, 'idle');
                },
            });

            // [URL 라우팅] 지도 이동 시 URL 동기화 비활성화
            // 사용자가 직접 공유 버튼을 클릭할 때만 URL이 생성되도록 변경
            // idle 이벤트에서 URL 동기화하면 공유 URL 접속 시 원치 않는 URL 변경이 발생함
            // naver.maps.Event.addListener(map, 'idle', () => { ... });

        } catch (error) {
            console.error("네이버 지도 초기화 오류:", error);
            showMapToast("지도를 초기화하는 중 오류가 발생했습니다.", 'error');
        }
    }, [isLoaded, getDeviceAdjustedZoom, selectedRegion, showMapToast]);

    // [New] 커스텀 스크롤 휠 핸들러 (마우스 호버 위치 기준 줌 고정)
    useEffect(() => {
        if (!isMapInitialized || !mapRef.current || !mapInstanceRef.current) return;

        const mapElement = mapRef.current;
        const map = mapInstanceRef.current;

        // 연속 스크롤 시 목표 줌 레벨 추적 변수 (Effect 클로저 내 유지)
        let targetZoomLevel = map.getZoom();
        let lastWheelTime = 0;
        let pendingAnchorAdjustListener: unknown = null;
        let isAnchorAdjusting = false;

        let queuedWheelInput: NaverWheelInput | null = null;

        function runQueuedWheelInput() {
            const flushPlan = flushQueuedNaverWheelInput({
                isAnchorAdjusting,
                queuedWheelInput,
            });
            queuedWheelInput = flushPlan.nextQueuedWheelInput;

            if (!flushPlan.shouldHandleNextInput || !flushPlan.nextInput) return;

            handleWheelInput(flushPlan.nextInput);
        }

        function handleWheelInput(input: NaverWheelInput) {
            const now = Date.now();
            const timeDiff = now - lastWheelTime;
            lastWheelTime = now;

            const currentMapZoom = map.getZoom();
            const wheelPlan = resolveNaverWheelZoomPlan({
                currentMapZoom,
                deltaY: input.deltaY,
                maxZoom: MAX_ZOOM,
                minZoom: MIN_ZOOM,
                previousTargetZoom: targetZoomLevel,
                timeDiffMs: timeDiff,
            });

            if (wheelPlan.normalizedDirection === 0) {
                return;
            }
            const { nextZoom, shouldApply } = wheelPlan;

            // 3. 적용 (변경이 있을 때만)
            if (shouldApply) {
                targetZoomLevel = nextZoom;

                try {
                    const { naver } = window;
                    const projection = map.getProjection();

                    if (!naver || !projection) {
                        map.setZoom(nextZoom, true);
                        return;
                    }

                    const rect = mapElement.getBoundingClientRect();
                    const wheelViewportPlan = buildNaverWheelViewportPlan({
                        centerOffset: projection.fromCoordToOffset(map.getCenter()),
                        clientX: input.clientX,
                        clientY: input.clientY,
                        rectHeight: rect.height,
                        rectLeft: rect.left,
                        rectTop: rect.top,
                        rectWidth: rect.width,
                    });

                    // 컨테이너 바깥 휠 이벤트는 기본 중심 줌 처리
                    if (!wheelViewportPlan.isInsideViewport) {
                        map.setZoom(nextZoom, true);
                        return;
                    }

                    // 네이버 Projection offset은 "뷰포트 픽셀"이 아니라 "투영 좌표계 offset"이므로
                    // 마우스 뷰포트 좌표를 현재 center offset 기준으로 변환해 사용
                    const beforeCoord = projection.fromOffsetToCoord(
                        new naver.maps.Point(wheelViewportPlan.mouseOffset.x, wheelViewportPlan.mouseOffset.y)
                    );

                    // 보정 중일 때는 후속 휠 입력을 큐에 보관하고 idle 이후 순차 처리
                    isAnchorAdjusting = true;

                    // 줌 반영 후( idle ) 투영이 갱신된 시점에 중심 보정
                    pendingAnchorAdjustListener = naver.maps.Event.addListener(map, 'idle', () => {
                        pendingAnchorAdjustListener = clearNaverPendingAnchorAdjustListener({
                            pendingAnchorAdjustListener,
                            removeListener: (listener) => naver.maps.Event.removeListener(listener),
                        }).nextPendingAnchorAdjustListener;

                        try {
                            const updatedProjection = map.getProjection();
                            if (!updatedProjection) return;

                            const currentCenter = map.getCenter();
                            const anchorAdjustmentPlan = buildNaverWheelAnchorAdjustmentPlan({
                                anchorCoordBeforeZoom: { lat: beforeCoord.lat(), lng: beforeCoord.lng() },
                                centerOffsetAfterZoom: updatedProjection.fromCoordToOffset(currentCenter),
                                currentCenter: { lat: currentCenter.lat(), lng: currentCenter.lng() },
                                mousePoint: wheelViewportPlan.mousePoint,
                                viewportCenterPoint: wheelViewportPlan.viewportCenterPoint,
                            });
                            const adjustedCenter = calculateHoverAnchoredCenter({
                                projection: buildNaverWheelProjectionAdapter({
                                    createLatLng: (lat, lng) => new naver.maps.LatLng(lat, lng),
                                    createPoint: (x, y) => new naver.maps.Point(x, y),
                                    projection: updatedProjection,
                                }),
                                ...anchorAdjustmentPlan,
                            });

                            map.setCenter(new naver.maps.LatLng(adjustedCenter.lat, adjustedCenter.lng));
                        } finally {
                            const postAdjustPlan = resolveNaverWheelPostAdjustPlan({
                                currentZoom: map.getZoom(),
                                hasQueuedWheelInput: queuedWheelInput !== null,
                            });
                            isAnchorAdjusting = postAdjustPlan.nextIsAnchorAdjusting;
                            targetZoomLevel = postAdjustPlan.nextTargetZoomLevel;
                            if (postAdjustPlan.shouldScheduleQueuedInput) {
                                window.requestAnimationFrame(runQueuedWheelInput);
                            }
                        }
                    });

                    // 줌 적용 (보정은 idle 리스너에서 수행)
                    map.setZoom(nextZoom, false);
                } catch (error) {
                    console.error("휠 줌 포인터 고정 처리 실패:", error);
                    map.setZoom(nextZoom, true);
                    const postAdjustPlan = resolveNaverWheelPostAdjustPlan({
                        currentZoom: map.getZoom(),
                        hasQueuedWheelInput: queuedWheelInput !== null,
                    });
                    isAnchorAdjusting = postAdjustPlan.nextIsAnchorAdjusting;
                    targetZoomLevel = postAdjustPlan.nextTargetZoomLevel;
                    if (postAdjustPlan.shouldScheduleQueuedInput) {
                        window.requestAnimationFrame(runQueuedWheelInput);
                    }
                }
            }
        }

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();

            const input = buildNaverWheelInput({
                clientX: e.clientX,
                clientY: e.clientY,
                deltaY: e.deltaY,
            });
            const dispatchPlan = resolveNaverWheelInputDispatch({
                input,
                isAnchorAdjusting,
            });
            queuedWheelInput = dispatchPlan.nextQueuedWheelInput;
            if (!dispatchPlan.shouldHandleImmediately) {
                return;
            }

            handleWheelInput(input);
        };

        // passive: false여야 preventDefault()가 동작함
        mapElement.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            if (pendingAnchorAdjustListener && window.naver?.maps?.Event) {
                pendingAnchorAdjustListener = clearNaverPendingAnchorAdjustListener({
                    pendingAnchorAdjustListener,
                    removeListener: (listener) => window.naver!.maps.Event.removeListener(listener),
                }).nextPendingAnchorAdjustListener;
            }
            const cleanupState = resolveNaverWheelCleanupState();
            isAnchorAdjusting = cleanupState.nextIsAnchorAdjusting;
            queuedWheelInput = cleanupState.nextQueuedWheelInput;
            mapElement.removeEventListener('wheel', handleWheel);
        };
    }, [isMapInitialized]);

    // [삭제됨] 네이버 로고 숨김 로직은 약관 위반 소지가 있어 제거하였습니다.
    // useEffect(() => { ... logo hiding logic ... }, [isLoaded]);

    // [삭제됨] 지역 변경 시 지도 중심 이동 로직은 위쪽의 통합 useEffect로 병합됨
    // useEffect(() => { ... }, [selectedRegion]);

    // 검색된 맛집 선택 시 지도 중심 이동 및 선택 상태 설정
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const searchSelectionPlan = resolveNaverSearchSelectionPlan({
            activeSearchedRestaurant,
            previousHandledRestaurant: previousSearchedRestaurantRef.current,
            restaurants,
            selectedRestaurant,
        });

        if (searchSelectionPlan.shouldNotifyParentSelection && onRestaurantSelect && searchSelectionPlan.actualSearchedRestaurant) {
            onRestaurantSelect(searchSelectionPlan.actualSearchedRestaurant);
        }

        if (!searchSelectionPlan.shouldHandle || !searchSelectionPlan.focusTarget) {
            previousSearchedRestaurantRef.current = searchSelectionPlan.nextPreviousSearchedRestaurant;
            return;
        }

        // 패널 열기 (검색 시에만)
        setInternalPanelOpen(true);
        // 현재 searchedRestaurant 저장
        previousSearchedRestaurantRef.current = searchSelectionPlan.nextPreviousSearchedRestaurant;

        // [검색 시 줌 레벨 15로 즉시 이동]
        focusNaverMapOnRestaurant({
            createLatLng: (lat, lng) => new window.naver.maps.LatLng(lat, lng),
            lat: searchSelectionPlan.focusTarget.lat,
            lng: searchSelectionPlan.focusTarget.lng,
            map: mapInstanceRef.current,
            zoom: searchSelectionPlan.focusTarget.zoom,
        });
    }, [activeSearchedRestaurant, onRestaurantSelect, restaurants, selectedRestaurant]);


    // 로딩 에러 처리
    if (loadError) {
        return <NaverMapLoadErrorState message={loadError.message} />;
    }

    // 로딩 중
    if (!isLoaded) {
        return <MapSkeleton />;
    }

    // 그리드 모드에서는 기존 레이아웃 유지
    if (isGridMode) {
        return (
            <div className="relative h-full">
                <NaverMapSurface
                    announcementToastTitle={announcementToastTitle}
                    badgePositionClass={floatingBadgePositionClass}
                    centerOffsetStyle={centerOffsetStyle}
                    count={onlineUsersCount}
                    floatingToastPositionClass={floatingToastPositionClass}
                    isLoaded={isLoaded}
                    isLoadingRestaurants={isLoadingRestaurants}
                    mapRef={mapRef}
                    mapToast={mapToast}
                    onAnnouncementToastClick={handleAnnouncementToastClick}
                    restaurantsLength={restaurants.length}
                    showAnnouncementToast={showAnnouncementToast}
                    showOnlineUsers={showOnlineUsers}
                    showRestaurantCount={showRestaurantCount}
                />
            </div >
        );
    }

    // 단일 지도 모드에서는 Flexbox 레이아웃 적용 (고정 너비 패널)
    return (
        <div className="h-full flex relative overflow-hidden">
            {/* 지도 영역 */}
            <NaverMapSurface
                announcementToastTitle={announcementToastTitle}
                badgePositionClass={floatingBadgePositionClass}
                centerOffsetStyle={centerOffsetStyle}
                className="flex-1 h-full relative z-0"
                count={onlineUsersCount}
                dataTestId="map-container"
                floatingToastPositionClass={floatingToastPositionClass}
                isLoaded={isLoaded}
                isLoadingRestaurants={isLoadingRestaurants}
                mapRef={mapRef}
                mapToast={mapToast}
                onAnnouncementToastClick={handleAnnouncementToastClick}
                restaurantsLength={restaurants.length}
                showAnnouncementToast={showAnnouncementToast}
                showOnlineUsers={showOnlineUsers}
                showRestaurantCount={showRestaurantCount}
            />

            {/* 레스토랑 상세 패널 - 외부 onMarkerClick이 없을 때만 렌더링 (외부 패널 관리가 아닌 경우에만) */}
            {selectedRestaurant && !onMarkerClick && (
                <NaverMapDetailPanelShell
                    activePanel={activePanel}
                    detailPanelRef={detailPanelRef}
                    internalPanelOpen={internalPanelOpen}
                    onClose={handleCloseInternalPanel}
                    onEditRestaurant={handleEditSelectedRestaurant}
                    onFocusCapture={handleDetailPanelFocusCapture}
                    onMouseDownCapture={handleDetailPanelMouseDownCapture}
                    onRequestEditRestaurant={handleRequestEditSelectedRestaurant}
                    onToggleCollapse={handleToggleInternalPanel}
                    onWriteReview={handleOpenReviewModal}
                    restaurant={selectedRestaurant}
                />
            )}


            {/* 리뷰 작성 모달 */}
            <NaverMapReviewModal
                isOpen={isReviewModalOpen}
                onClose={handleCloseReviewModal}
                restaurant={getNaverMapReviewRestaurant(selectedRestaurant)}
                onSuccess={handleReviewSuccess}
            />
        </div>
    );
});

NaverMapView.displayName = 'NaverMapView';

export default NaverMapView;
