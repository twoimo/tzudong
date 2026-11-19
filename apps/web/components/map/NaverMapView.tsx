'use client';
import { markInitialLoadMilestone } from '@/lib/performance/initial-load-milestones';
import { clearNaverDeviceLocationMarker, createNaverCancellableCallback, createNaverOneShotCallback, removeNaverMapListener } from '@/lib/naver-map-event-cleanup';

import { Suspense, lazy, useEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContextBase";
import { useQueryClient } from "@tanstack/react-query";
import { readHomeRouteMemory, writeHomeRouteMemory } from "@/hooks/use-home-route-memory";
import { usePathname } from "next/navigation";

import { buildHomeMapActivationPlan, isEmbeddedHomeRuntimeWindow } from "@/app/home-map-runtime-activation";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useHomeMapResults } from '@/hooks/use-home-map-results';
import type { FilterState } from "@/components/filters/filter-state";
import type { Restaurant, Region } from "@/types/restaurant";
import type { Announcement } from "@/types/announcement";
import type { Tables } from "@/integrations/supabase/types";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { NaverMapLoadErrorState } from "@/components/map/map-view-status-panels";
import { NaverMapSurface } from "@/components/map/naver-map-surface";
import {
    EMPTY_CONTEXTUAL_RESTAURANTS,
    hasVisibleMarkerReviewBubbles,
    scheduleVisibleMarkerReviewBubbleClamp,
    useNaverMapClusterRender,
    type NaverClusterExpansion,
    type NaverMapLike,
} from "@/components/map/use-naver-map-cluster-render";
import {
    NaverMapOverlayStack,
    resolveNaverMapOverlayKind,
    resolveNaverMapTimedOverlayDropPlan,
} from "@/components/map/naver-map-overlay-stack";
import { isPublicRestrictedMode } from "@/lib/site-config";
import {
    NaverMapDetailPanelShell,
    NaverMapReviewModal,
} from "@/components/map/naver-map-sidepanels";
import { useLayout } from "@/contexts/LayoutContext";
import { useDeviceType } from "@/hooks/useDeviceType";
import { fetchSupabaseRows, postgrestIn, supabaseRestRpcClient } from "@/lib/supabase-rest-client";
import {
    ANONYMOUS_PUBLIC_REVIEWER_NICKNAME,
    readPublicProfileSummariesLookup,
    resolvePublicReviewerDisplay,
} from "@/lib/public-profile-read";
import {
    buildDeviceLocationMarkerHtml,
    resolveDeviceLocationMapRenderPlan,
    type DeviceMapLocation,
} from "@/lib/device-location-map";
import {
    HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM,
    type HomeMapContextualRestaurantsPayload,
} from "@/lib/home-map-contextual-restaurants";
import { markerPool } from "@/lib/marker-pool";
import { primeCategoryMarkerImages } from "@/lib/category-marker-image-primer";
import { clusterAnimationManager } from "@/lib/cluster-marker";
import { syncPopularityMarkerInteraction, syncPopularityMarkerZoom } from "@/lib/evidence-engineering/popularity-marker";
import { getNaverIndividualMarkerVisual } from "@/lib/naver-map-marker-visuals";
import './marker-icons.css';
import { useMapOptimization } from "@/hooks/useMapOptimization";
import { calculateHoverAnchoredCenter } from "@/lib/map-hover-anchor";
import type { MarkerRenderSignature } from "@/lib/map-render-guard";
import {
    getActiveSearchedRestaurant,
    resolveReleasedSearchSelectionResetPlan,
    resolveSearchSelectionReleasePlan,
} from "@/lib/mobile-home-search-selection";
import {
    resolveNaverRestaurantEmptyStateMessage,
} from "@/lib/map-query-helpers";
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
    resolveRestaurantDetailPanelElement,
    shouldResetNaverMapOnPathChange,
} from "@/lib/naver-map-ui-helpers";
import {
    resolveNaverIslandClusterViewportByRegion,
    resolveNaverIslandFitBoundsOptions,
} from "@/lib/naver-map-cluster-helpers";
import { getNaverOverlayPositioning } from "@/lib/naver-map-overlay-position-helpers";
import {
    buildNaverMapDetailPanelFocusCaptureHandler,
    buildNaverMapDetailPanelMouseDownCaptureHandler,
    buildNaverMapInternalPanelCloseHandler,
    buildNaverMapInternalPanelToggleHandler,
    buildNaverMarkerRestaurantSelectionHandler,
    applyNaverImmediateMarkerCenter,
    buildNaverMapRestaurantAction,
    buildNaverMapReviewCloseHandler,
    buildNaverMapReviewOpenHandler,
    buildNaverMapReviewSuccessHandler,
    getNaverMapReviewRestaurant,
    resolveNaverMarkerClickImmediateCenterPlan,
    shouldSkipNaverDeferredCenterAfterImmediateMarkerClick,
    shouldCloseNaverInternalPanelForExternalState,
    shouldCloseNaverInternalPanelOnEscape,
} from "@/lib/naver-map-sidepanel-helpers";
import {
    buildNaverMapToastTrigger,
} from "@/lib/naver-map-toast-helpers";
import { NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS } from "@/lib/naver-map-overlay-timings";
import { getNaverPanelStateFlags } from "@/lib/naver-map-panel-state-helpers";
import { getNaverViewportOffset } from "@/lib/naver-map-viewport-helpers";
import { resolveNaverMobileVerticalOffset, resolveNaverOccludingNavHeight } from "@/lib/naver-map-mobile-offset-helpers";
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
    buildNaverMapInteractionListenerPlan,
    NAVER_INTERACTION_LISTENER_OPTIONS,
    NAVER_INTERACTION_REMOVE_OPTIONS,
} from "@/lib/naver-map-interaction-helpers";
import {
    buildNaverResizeObserverCleanup,
    buildNaverResizeObserverHandler,
} from "@/lib/naver-map-resize-observer-helpers";
import { focusNaverMapOnRestaurant } from "@/lib/naver-map-focus-helpers";
import { reuseMarkerAnchor } from "@/lib/naver-map-overlap-helpers";
import {
    buildNaverWindowResizeCleanup,
    buildNaverWindowResizeHandler,
} from "@/lib/naver-map-window-resize-helpers";
import {
    buildNaverCurrentStateSnapshot,
    buildNaverInitialCurrentStateSnapshot,
    getNaverCurrentPanelOffset,
    resolveNaverRestaurantCountUpdatePlan,
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
    hasNaverWheelProjectionUpdated,
    resolveNaverWheelPostAdjustPlan,
    type NaverWheelInput,
} from "@/lib/naver-map-wheel-helpers";
import {
    wrapNaverMarkerContentWithReviewBubble,
    buildVisibleMarkerReviewBubbleMapSignature,
    resolveVisibleMarkerReviewBubblePhotoUrl,
    truncateVisibleMarkerReviewBubbleText,
    type VisibleMarkerReviewBubble,
    type VisibleMarkerReviewBubbleTarget,
} from "@/lib/visible-marker-review-bubbles";

const NaverMapAnnouncementRuntime = lazy(() => import("@/components/map/NaverMapAnnouncementRuntime"));
const NaverMapPresenceRuntime = lazy(() => import("@/components/map/NaverMapPresenceRuntime"));
const HydratedDetailRestaurant = lazy(() => import("@/components/home/HydratedDetailRestaurant"));

// 상수 정의
const PANEL_WIDTH = 400; // 상세 패널 너비 (px)
const ZOOM_DIFF_THRESHOLD = 4; // 즉시 로드할 줌 차이 임계값
const DISTANCE_KM_THRESHOLD = 50; // 즉시 로드할 거리 임계값 (km)
const MOBILE_MARKER_CENTER_FINE_TUNE_PX = -6; // 선택 마커 translateY(-5px) 시각 보정

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
    reservesDesktopLeftPanelSpace?: boolean; // 외부 좌측 패널이 지도 위에 겹치지 않고 레이아웃 공간을 선점하는지
    mobileSheetHeightPercent?: number; // 모바일 바텀시트 높이(%) - 마커 Y축 중앙 보정
    onVisibleRestaurantsChange?: (restaurants: Restaurant[]) => void;
    onContextualRestaurantsChange?: (payload: HomeMapContextualRestaurantsPayload) => void;
    onSearchSelectionRelease?: () => void;
    onMapBlankClick?: () => void;
    onMapInteraction?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    showUserSubmittedMarkers?: boolean;
}
const hasValidNaverDeviceLocation = (
  location: DeviceMapLocation | null,
  zoom: number,
): location is DeviceMapLocation =>
  location !== null &&
  Number.isFinite(location.lat) &&
  Number.isFinite(location.lng) &&
  location.lat >= -90 &&
  location.lat <= 90 &&
  location.lng >= -180 &&
  location.lng <= 180 &&
  Number.isFinite(zoom);

type VisibleMarkerReviewRow = Pick<
    Tables<'reviews'>,
    'id' | 'restaurant_id' | 'user_id' | 'content' | 'food_photos' | 'created_at' | 'is_pinned'
>;

const VISIBLE_MARKER_REVIEW_SELECT = 'id,restaurant_id,user_id,content,food_photos,created_at,is_pinned';

const RESTAURANT_COUNT_TOAST_SETTLE_DELAY_MS = 1200;

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
    reservesDesktopLeftPanelSpace = false,
    mobileSheetHeightPercent = 0,
    onVisibleRestaurantsChange,
    onContextualRestaurantsChange,
    onSearchSelectionRelease,
    onMapBlankClick,
    onMapInteraction,
    deviceLocation = null,
    showUserSubmittedMarkers = true,
}: NaverMapViewProps) => {
    useEffect(() => primeCategoryMarkerImages(document), []);
    const { user: mapViewer, isLoading: isMapViewerLoading } = useAuth();
    const routeQueryClient = useQueryClient();
    const mapReturnOwner = mapViewer?.id ?? "anonymous";
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<NaverMapLike | null>(null);
    const initialIdleWorkRef = useRef<{ map: NaverMapLike; cancel: () => void } | null>(null);
    const markerRenderSignatureRef = useRef<MarkerRenderSignature | null>(null);
    const previousSearchedRestaurantRef = useRef<Restaurant | null>(null); // 이전 searchedRestaurant 추적
    const releasedSearchSelectionIdRef = useRef<string | null>(null);
    const detailPanelRef = useRef<HTMLDivElement>(null); // 상세 패널 참조
    // Centering owns its selection history; marker styling has a separate ref.
    const prevSelectedRestaurantIdRef = useRef<string | null>(null);
    const hasUserMovedMapRef = useRef<boolean>(false); // 사용자가 지도를 직접 움직였는지 추적
    const lastImmediateMarkerCenterRef = useRef<{
        restaurantId: string;
        targetLat: number;
        targetLng: number;
        targetZoom: number;
        targetOffsetX: number;
        targetOffsetY: number;
        centeredAt: number;
    } | null>(null);
    const [isMapRuntimeActive, setIsMapRuntimeActive] = useState(false);
    const deviceLocationMarkerRef = useRef<{
        setMap: (map: unknown | null) => void;
        setPosition: (position: unknown) => void;
        setIcon: (icon: unknown) => void;
    } | null>(null);
    const lastFocusedDeviceLocationRequestRef = useRef<number | null>(null);
    const clearDeviceLocationMarker = useCallback(() => {
        deviceLocationMarkerRef.current = clearNaverDeviceLocationMarker(deviceLocationMarkerRef.current, () => {
            mapRef.current?.querySelectorAll('[data-tzudong-device-location-marker="true"]').forEach(node => node.remove());
        });
        return deviceLocationMarkerRef.current === null;
    }, []);
    const isInitialLoadFromUrlRef = useRef<boolean>(false); // URL 파라미터로 초기화되었는지 추적 (공유 URL 지원)

    const [visibleMarkerReviewBubbleTargets, setVisibleMarkerReviewBubbleTargets] =
        useState<VisibleMarkerReviewBubbleTarget[]>([]);
    const [visibleMarkerReviewBubbles, setVisibleMarkerReviewBubbles] =
        useState<Record<string, VisibleMarkerReviewBubble>>({});

    // 사이드바 상태 가져오기
    const { isSidebarOpen } = useLayout();

    // 디바이스 타입 감지 (모바일/태블릿에서는 오프셋 제거)
    // Next.js 클라이언트 사이드 수화(Hydration) 동안 desktop 기본값 오인 방지를 위해 window 너비와 동기화
    const { isMobileOrTablet: rawIsMobileOrTablet } = useDeviceType();
    const isMobileOrTablet = typeof window !== 'undefined' ? window.innerWidth <= 1279 : rawIsMobileOrTablet;

    // [OPTIMIZATION] 디바이스 성능 티어 기반 지도 최적화 설정
    const mapOptimization = useMapOptimization();

    // [OPTIMIZATION] 패널 너비 state - ResizeObserver로 자동 업데이트
    const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);

    // 디바이스별 줌 레벨 조정 함수 (모바일/태블릿은 -2 줌으로 더 넓게, 전국은 기본값 유지)
    const getDeviceAdjustedZoom = useCallback((baseZoom: number, isNational: boolean = false) => {
        return getAdjustedZoomForDevice(baseZoom, isMobileOrTablet, isNational);
    }, [isMobileOrTablet]);

    // 네이버 지도 API 로드 - / 첫 진입에서 지도 SDK를 즉시 비동기로 붙이고 부가 런타임만 점진 활성화
    const { isLoaded, loadError, load } = useNaverMaps({ autoLoad: false, strategy: 'afterInteractive' });

    useEffect(() => {
        if (isMapRuntimeActive) return;

        const activationPlan = buildHomeMapActivationPlan({
            search: window.location.search,
            hash: window.location.hash,
            isEmbeddedHomeRuntime: isEmbeddedHomeRuntimeWindow(),
        });

        if (activationPlan.activateImmediately) {
            setIsMapRuntimeActive(true);
        }
    }, [isMapRuntimeActive]);

    useEffect(() => {
        if (!isMapRuntimeActive || isLoaded || loadError) return;
        load();
    }, [isLoaded, isMapRuntimeActive, load, loadError]);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [internalPanelOpen, setInternalPanelOpen] = useState(false);
    const [showRestaurantCount, setShowRestaurantCount] = useState(false);
    const [restaurantCountToastCount, setRestaurantCountToastCount] = useState(0);
    const hasShownRestaurantCountRef = useRef(false);
    const [showOnlineUsers, setShowOnlineUsers] = useState(false);
    const [onlineUsersCount, setOnlineUsersCount] = useState(0);
    const [showAnnouncementToast, setShowAnnouncementToast] = useState(false);
    const [shouldRunNoncriticalMapEffects, setShouldRunNoncriticalMapEffects] = useState(false);
    const [announcementToastTitle, setAnnouncementToastTitle] = useState('');
    const [announcementToastPayload, setAnnouncementToastPayload] = useState<Announcement | null>(null);
    const [isMapInitialized, setIsMapInitialized] = useState(false);
    const [mapInitError, setMapInitError] = useState<string | null>(null);

    // 모바일 초기 로드 시 검색창(MobileControlOverlay) 및 카테고리 슬라이더가
    // 클라이언트 사이드에서 마운트 및 수화가 완료되고 실제 DOM에 성공적으로 안착했을 때만 비임계 지도 효과들을 활성화합니다.
    useEffect(() => {
        if (!isMobileOrTablet) {
            setShouldRunNoncriticalMapEffects(true);
            return;
        }

        const attemptActivation = () => {
            if (typeof document === 'undefined') return;

            const searchButton = document.getElementById('tzudong-mobile-search-button');
            const categorySlider = document.getElementById('tzudong-mobile-category-slider');

            if (searchButton && categorySlider) {
                setShouldRunNoncriticalMapEffects(true);
                window.removeEventListener('tzudong_mobile_overlay_ready', handleReady);
            }
        };

        const handleReady = () => {
            attemptActivation();
        };

        window.addEventListener('tzudong_mobile_overlay_ready', handleReady);
        attemptActivation();

        const fallbackTimeoutId = window.setTimeout(() => {
            setShouldRunNoncriticalMapEffects(true);
            window.removeEventListener('tzudong_mobile_overlay_ready', handleReady);
        }, 3000);

        return () => {
            window.removeEventListener('tzudong_mobile_overlay_ready', handleReady);
            clearTimeout(fallbackTimeoutId);
        };
    }, [isMobileOrTablet]);

    const activeSearchedRestaurant = useMemo(() => getActiveSearchedRestaurant({
        searchedRestaurant,
        selectedRestaurant,
    }), [searchedRestaurant, selectedRestaurant]);
    useEffect(() => {
        if (visibleMarkerReviewBubbleTargets.length === 0) {
            setVisibleMarkerReviewBubbles((previous) =>
                Object.keys(previous).length === 0 ? previous : {}
            );
            return;
        }

        const relatedRestaurantIdToTargetId = new Map<string, string>();
        visibleMarkerReviewBubbleTargets.forEach((target) => {
            target.relatedRestaurantIds.forEach((restaurantId) => {
                relatedRestaurantIdToTargetId.set(restaurantId, target.restaurantId);
            });
        });
        const relatedRestaurantIds = [...relatedRestaurantIdToTargetId.keys()];

        if (relatedRestaurantIds.length === 0) {
            setVisibleMarkerReviewBubbles((previous) =>
                Object.keys(previous).length === 0 ? previous : {}
            );
            return;
        }

        let isCancelled = false;

        const fetchVisibleMarkerReviewBubbles = async () => {
            const reviewLimit = Math.max(
                visibleMarkerReviewBubbleTargets.length * 4,
                visibleMarkerReviewBubbleTargets.length,
            );
            const reviewsData = await fetchSupabaseRows<VisibleMarkerReviewRow>('reviews', [
                ['select', VISIBLE_MARKER_REVIEW_SELECT],
                ['restaurant_id', postgrestIn(relatedRestaurantIds)],
                ['is_verified', 'eq.true'],
                ['order', 'is_pinned.desc,created_at.desc'],
                ['limit', reviewLimit],
            ]).catch((error) => {
                console.warn('NaverMapView: review bubble fetch skipped');
                return [] as VisibleMarkerReviewRow[];
            });

            if (isCancelled) return;

            if (!reviewsData.length) {
                setVisibleMarkerReviewBubbles((previous) =>
                    Object.keys(previous).length === 0 ? previous : {}
                );
                return;
            }

            const typedReviews = reviewsData;
            const userIds = [
                ...new Set(
                    typedReviews
                        .map((review) => review.user_id)
                        .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
                ),
            ];
            const profilesLookup = userIds.length > 0
                ? await readPublicProfileSummariesLookup(supabaseRestRpcClient, userIds)
                : { ok: true, summaries: [] };
            if (!profilesLookup.ok) {
                console.warn('NaverMapView: review bubble profile fetch skipped');
            }

            if (isCancelled) return;
            const nextBubbles: Record<string, VisibleMarkerReviewBubble> = {};
            const reviewsByPhotoPriority = [...typedReviews].sort((left, right) => {
                const leftHasPhoto = Array.isArray(left.food_photos) && left.food_photos.length > 0;
                const rightHasPhoto = Array.isArray(right.food_photos) && right.food_photos.length > 0;
                if (leftHasPhoto !== rightHasPhoto) return rightHasPhoto ? 1 : -1;
                const leftPinned = left.is_pinned ? 1 : 0;
                const rightPinned = right.is_pinned ? 1 : 0;
                if (leftPinned !== rightPinned) return rightPinned - leftPinned;
                return String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''));
            });

            for (const review of reviewsByPhotoPriority) {
                if (!review.restaurant_id) continue;
                const restaurantId = relatedRestaurantIdToTargetId.get(review.restaurant_id);
                if (!restaurantId || nextBubbles[restaurantId]) continue;

                const photoUrl = resolveVisibleMarkerReviewBubblePhotoUrl(review);
                const content = truncateVisibleMarkerReviewBubbleText(
                    review.content || '사진 리뷰를 남겼어요',
                    80,
                );

                nextBubbles[restaurantId] = {
                    restaurantId,
                    reviewId: review.id,
                    userName: resolvePublicReviewerDisplay(
                        review.user_id,
                        profilesLookup.summaries,
                        profilesLookup.ok,
                        { missingNickname: ANONYMOUS_PUBLIC_REVIEWER_NICKNAME },
                    ).nickname,
                    content,
                    photoUrl,
                };
            }

            setVisibleMarkerReviewBubbles((previous) =>
                buildVisibleMarkerReviewBubbleMapSignature(previous) === buildVisibleMarkerReviewBubbleMapSignature(nextBubbles)
                    ? previous
                    : nextBubbles
            );
        };

        fetchVisibleMarkerReviewBubbles();

        return () => {
            isCancelled = true;
        };
    }, [visibleMarkerReviewBubbleTargets]);

    const activateNoncriticalMapEffects = useCallback(() => {
        setShouldRunNoncriticalMapEffects((previous) => previous ? previous : true);
    }, []);

    const releaseSearchSelectionOnUserInteraction = useCallback(() => {
        activateNoncriticalMapEffects();

        const releasePlan = resolveSearchSelectionReleasePlan({
            activeSearchedRestaurant,
            hasReleaseHandler: Boolean(onSearchSelectionRelease),
            releasedSearchSelectionId: releasedSearchSelectionIdRef.current,
        });

        releasedSearchSelectionIdRef.current = releasePlan.nextReleasedSearchSelectionId;

        if (releasePlan.shouldRelease) {
            onSearchSelectionRelease?.();
        }
    }, [activateNoncriticalMapEffects, activeSearchedRestaurant, onSearchSelectionRelease]);

    useEffect(() => {
        if (!isMapInitialized || !mapInstanceRef.current || !onMapBlankClick) return;

        const maps = window.naver?.maps;
        if (!maps?.Event) return;

        const click = createNaverCancellableCallback(() => {
            activateNoncriticalMapEffects();
            onMapInteraction?.();
            onMapBlankClick();
        });
        const listener = maps.Event.addListener(mapInstanceRef.current, 'click', click.handle);

        return () => {
            click.cancel();
            removeNaverMapListener(maps.Event, listener);
        };
    }, [activateNoncriticalMapEffects, isMapInitialized, onMapBlankClick, onMapInteraction]);

    useEffect(() => {
        if (!isMapInitialized || !mapInstanceRef.current) return;

        const maps = window.naver?.maps;
        const map = mapInstanceRef.current;
        const mapElement = mapRef.current;
        if (!maps?.Event || !map) return;

        const { handleSearchReleaseInteraction, handleUserInteraction } = buildNaverMapInteractionHandlers({
            hasUserMovedMapRef,
            onUserInteraction: () => {
                activateNoncriticalMapEffects();
                onMapInteraction?.();
            },
            releaseSearchSelectionOnUserInteraction,
        });
        const interactionListenerPlan = buildNaverMapInteractionListenerPlan();
        const searchRelease = createNaverCancellableCallback(handleSearchReleaseInteraction);
        const userInteraction = createNaverCancellableCallback(handleUserInteraction);
        const interactionHandlers = { searchRelease: searchRelease.handle, userInteraction: userInteraction.handle };

        if (mapElement) {
            interactionListenerPlan.domListeners.forEach(({ eventName, handlerKey }) => {
                mapElement.addEventListener(
                    eventName,
                    interactionHandlers[handlerKey],
                    NAVER_INTERACTION_LISTENER_OPTIONS,
                );
            });
        }

        const mapEventListeners = interactionListenerPlan.mapEventNames.map((eventName) =>
            maps.Event.addListener(map, eventName, searchRelease.handle)
        );

        return () => {
            searchRelease.cancel();
            userInteraction.cancel();
            mapEventListeners.forEach((listener) => {
                removeNaverMapListener(maps.Event, listener);
            });

            if (mapElement) {
                interactionListenerPlan.domListeners.forEach(({ eventName, handlerKey }) => {
                    mapElement.removeEventListener(
                        eventName,
                        interactionHandlers[handlerKey],
                        NAVER_INTERACTION_REMOVE_OPTIONS,
                    );
                });
            }
        };
    }, [activateNoncriticalMapEffects, isMapInitialized, onMapInteraction, releaseSearchSelectionOnUserInteraction]);

    // Renders authorized device coordinates at the approved map-provider boundary.
    useEffect(() => {
        const clearWithRetry = () => {
            lastFocusedDeviceLocationRequestRef.current = null;
            if (clearDeviceLocationMarker()) return;
            const timer = window.setTimeout(clearDeviceLocationMarker, 250);
            return () => window.clearTimeout(timer);
        };
        if (!deviceLocation) return clearWithRetry();
        if (!isMapInitialized || !mapInstanceRef.current || !window.naver?.maps) return;

        const { naver } = window;
        if (!naver.maps.LatLng || !naver.maps.Point || !naver.maps.Marker) return;
        const map = mapInstanceRef.current;

        const currentZoom = map.getZoom();
        if (!hasValidNaverDeviceLocation(deviceLocation, currentZoom) || !Number.isFinite(currentZoom)) {
            return clearWithRetry();
        }

        // Provider boundary: keep coordinates in React state memory, and only apply validated updates to the Naver map.
        const position = new naver.maps.LatLng(deviceLocation.lat, deviceLocation.lng);
        const icon = {
            content: buildDeviceLocationMarkerHtml(deviceLocation),
            anchor: new naver.maps.Point(28, 28),
        };
        const deviceLocationRenderPlan = resolveDeviceLocationMapRenderPlan({
            currentZoom,
            location: deviceLocation,
            previousFocusRequestId: lastFocusedDeviceLocationRequestRef.current,
        });

        if (!deviceLocationMarkerRef.current) {
            deviceLocationMarkerRef.current = new naver.maps.Marker({
                position,
                map,
                icon,
                zIndex: 10000,
            });
        } else {
            deviceLocationMarkerRef.current.setPosition(position);
            deviceLocationMarkerRef.current.setIcon(icon);
            deviceLocationMarkerRef.current.setMap(map);
        }

        if (deviceLocationRenderPlan.shouldFocus) {
            lastFocusedDeviceLocationRequestRef.current = deviceLocationRenderPlan.nextFocusedRequestId;
            map.setCenter(position);
            map.setZoom(deviceLocationRenderPlan.focusZoom);
        }
    }, [clearDeviceLocationMarker, deviceLocation, isMapInitialized]);

    useEffect(() => () => {
        clearDeviceLocationMarker();
    }, [clearDeviceLocationMarker]);

    const handleDetailPanelMouseDownCapture = useMemo(
        () => buildNaverMapDetailPanelMouseDownCaptureHandler(onPanelClick),
        [onPanelClick]
    );

    const handleDetailPanelFocusCapture = useMemo(
        () => buildNaverMapDetailPanelFocusCaptureHandler(onPanelClick),
        [onPanelClick]
    );


    // [Fix] 라우트 변경 감지 - 다른 페이지 갔다가 돌아왔을 때 지도 재초기화
    const pathname = usePathname() ?? "";
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

    // ... (중략) ...

    // [커스텀 토스트] 지도 상단 중앙 알림 상태
    const [mapToast, setMapToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null>(null);

    const showMapToast = useMemo(
        () => buildNaverMapToastTrigger(setMapToast),
        []
    );

    useEffect(() => {
        showMapToast.activate();
        return () => showMapToast.dispose();
    }, [showMapToast]);

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
        floatingBadgePositionClass,
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
        if (!isMobileOrTablet) {
            return resolveNaverMobileVerticalOffset({
                fineTunePx: MOBILE_MARKER_CENTER_FINE_TUNE_PX,
                isMobileOrTablet,
                navHeight: 0,
                sheetHeightPercent: mobileSheetHeightPercent,
                viewportHeight: 0,
            });
        }

        const measuredNavHeight = parseFloat(
            getComputedStyle(document.documentElement)
                .getPropertyValue('--mobile-bottom-nav-effective-height')
        );
        const navHeight = Number.isFinite(measuredNavHeight) ? Math.max(0, measuredNavHeight) : 60;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const mapHeight = mapInstanceRef.current?.getSize?.()?.height ?? viewportHeight;

        return resolveNaverMobileVerticalOffset({
            fineTunePx: MOBILE_MARKER_CENTER_FINE_TUNE_PX,
            isMobileOrTablet,
            navHeight: resolveNaverOccludingNavHeight({ navHeight, viewportHeight, mapHeight }),
            sheetHeightPercent: mobileSheetHeightPercent,
            viewportHeight,
        });
    }, [isMobileOrTablet, mobileSheetHeightPercent]);

    const centerMarkerSelectionImmediately = useCallback((restaurant: Restaurant) => {
        const map = mapInstanceRef.current;
        if (!map || !window.naver) return;

        const currentZoom = map.getZoom();
        const immediateCenterPlan = resolveNaverMarkerClickImmediateCenterPlan({
            currentZoom,
            isGridMode,
            isMobileOrTablet,
            isPanelCollapsed,
            mapFocusZoom: mapFocusZoom ?? null,
            mobileVerticalOffset: getMobileVerticalOffset(),
            panelWidth,
            restaurant,
            usesExternalPanel: Boolean(onMarkerClick) && !reservesDesktopLeftPanelSpace,
        });

        if (immediateCenterPlan.skip) {
            return;
        }

        const immediateCenterResult = applyNaverImmediateMarkerCenter({
            currentZoom,
            getAdjustedCenter,
            map,
            plan: immediateCenterPlan,
        });

        if (immediateCenterResult.applied) {
            lastImmediateMarkerCenterRef.current = immediateCenterResult.markerCenter;
        }
    }, [getMobileVerticalOffset, isGridMode, isMobileOrTablet, isPanelCollapsed, mapFocusZoom, onMarkerClick, panelWidth, reservesDesktopLeftPanelSpace]);

    const handleMarkerRestaurantSelection = useMemo(
        () => buildNaverMarkerRestaurantSelectionHandler({
            centerMarkerImmediately: centerMarkerSelectionImmediately,
            hasUserMovedMapRef,
            onMarkerClick,
            onRestaurantSelect,
            setInternalPanelOpen,
        }),
        [centerMarkerSelectionImmediately, onMarkerClick, onRestaurantSelect]
    );

    // [Helper] 패널 오프셋을 고려한 즉시 이동 (클러스터 클릭 시 사용)
    // 우측 패널이 열려있을 때 클러스터 중심이 "보이는 영역"의 중앙에 위치하도록 조정
    const jumpWithPanelOffset = useCallback((
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
        map.setZoom(targetZoom, false);
        map.setCenter(adjustedCenter);
    }, [getViewportOffset]);

    const fitIslandClusterViewport = useCallback((
        viewport: ReturnType<typeof resolveNaverIslandClusterViewportByRegion>
    ) => {
        const map = mapInstanceRef.current;
        const maps = window.naver?.maps;
        if (!viewport || !map?.fitBounds || !maps?.LatLng || !maps?.LatLngBounds) {
            return false;
        }

        const bounds = new maps.LatLngBounds(
            new maps.LatLng(viewport.bounds.south, viewport.bounds.west),
            new maps.LatLng(viewport.bounds.north, viewport.bounds.east),
        );
        map.fitBounds(bounds, resolveNaverIslandFitBoundsOptions({
            isMobileOrTablet,
            maxZoom: viewport.maxZoom,
            viewportOffset: getViewportOffset(),
        }));
        return true;
    }, [getViewportOffset, isMobileOrTablet]);

    // [통합] 지도 중심 및 줌 조정 로직
    useEffect(() => {
        // Origin authorization may revoke the SDK after its script load event.
        // A retained map instance alone does not authorize another SDK call.
        const maps = window.naver?.maps;
        if (!mapInstanceRef.current || !maps?.Event || !maps.LatLng || !maps.Point || isGridMode) return;

        // [Fix] URL 파라미터로 초기화된 경우 첫 번째 실행에서 줌 오버라이드 방지
        if (isInitialLoadFromUrlRef.current) {
            isInitialLoadFromUrlRef.current = false; // 플래그 해제 (다음 실행부터는 정상 동작)
            return;
        }

        const map = mapInstanceRef.current;

        // 1. selection 변경 여부 확인 (Ref와 비교)
        const currentSelectedId = selectedRestaurant?.id || null;
        // 병합된 레스토랑인 경우 이름이나 카테고리도 변경될 수 있지만 ID가 핵심
        // selectedRegion 변경도 확인해야 함

        // 이전 선택 상태와 비교 (간단히 ID나 Region 문자열로 비교)
        // prevSelectedRestaurantIdRef는 marker click 등 다른 곳에서도 쓰일 수 있으니 주의.
        // 여기서는 이 Effect 전용으로 판단 로직을 수행.

        const previousSelectedId = prevSelectedRestaurantIdRef.current;
        const { isSelectionChanged, nextSelectedId } = resolveNaverSelectionChange({
            currentSelectedId,
            previousSelectedId,
        });
        prevSelectedRestaurantIdRef.current = nextSelectedId;
        const isSelectionClearedByPanelClose =
            isSelectionChanged &&
            previousSelectedId !== null &&
            currentSelectedId === null &&
            selectedRegion === null &&
            !propIsPanelOpen &&
            !internalPanelOpen;

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
        if (isSelectionClearedByPanelClose) {
            return;
        }


        if (isSelectionChanged && currentSelectedId) {
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
            isSelectionChanged,
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

        const immediateMarkerCenter = lastImmediateMarkerCenterRef.current;
        if (
            immediateMarkerCenter &&
            shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
                centeredAt: immediateMarkerCenter.centeredAt,
                immediateOffsetX: immediateMarkerCenter.targetOffsetX,
                immediateOffsetY: immediateMarkerCenter.targetOffsetY,
                immediateTargetLat: immediateMarkerCenter.targetLat,
                immediateTargetLng: immediateMarkerCenter.targetLng,
                immediateZoom: immediateMarkerCenter.targetZoom,
                restaurantId: immediateMarkerCenter.restaurantId,
                selectedRestaurantId: currentSelectedId,
                targetLat,
                targetLng,
                targetOffsetX,
                targetOffsetY,
                targetZoom,
            })
        ) {
            return;
        } else if (immediateMarkerCenter) {
            lastImmediateMarkerCenterRef.current = null;
        }

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

                map.panTo(newCenter, { duration: 0 });
            }
            return;
        }

        // [Case 2] 사용자가 이동하지 않았거나, 새로운 선택이 일어난 경우
        // -> 기존 로직대로 타겟 위치로 이동 및 오프셋 적용

        // 리사이즈 먼저 트리거
        const transitionResizePlan = resolveNaverCenteringTransitionResizePlan();
        maps.Event.trigger(map, transitionResizePlan.initialResizeEvent);

        const newCenterLatLng = getAdjustedCenter(targetLat, targetLng, targetZoom, targetOffsetX, targetOffsetY);
        map.setZoom(targetZoom);
        map.setCenter(newCenterLatLng);

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
        reservesDesktopLeftPanelSpace,
    ]);

    // 리사이즈 시 참조할 최신 상태 Ref 업데이트
    const currentStateRef = useRef(buildNaverInitialCurrentStateSnapshot({
        isSidebarOpen,
        externalPanelOpen,
        isPanelCollapsed,
        isGridMode,
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

        const handleResize = () => {
            if (!window.naver?.maps?.Event) return;
            // 1. 지도 리사이즈 트리거
            window.naver.maps.Event.trigger(map, 'resize');

            const { urlLat, urlLng, urlZoom } = parseNaverMapUrlState(window.location.search);
            if (
                !selectedRestaurant &&
                !selectedRegion &&
                !propIsPanelOpen &&
                !internalPanelOpen &&
                Number.isNaN(urlLat) &&
                Number.isNaN(urlLng) &&
                Number.isNaN(urlZoom)
            ) {
                return;
            }

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

            const immediateMarkerCenter = lastImmediateMarkerCenterRef.current;
            if (
                immediateMarkerCenter &&
                typeof resizePlan.targetLat === 'number' &&
                typeof resizePlan.targetLng === 'number' &&
                shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
                    centeredAt: immediateMarkerCenter.centeredAt,
                    immediateOffsetX: immediateMarkerCenter.targetOffsetX,
                    immediateOffsetY: immediateMarkerCenter.targetOffsetY,
                    immediateTargetLat: immediateMarkerCenter.targetLat,
                    immediateTargetLng: immediateMarkerCenter.targetLng,
                    immediateZoom: immediateMarkerCenter.targetZoom,
                    restaurantId: immediateMarkerCenter.restaurantId,
                    selectedRestaurantId: selectedRestaurant?.id ?? null,
                    targetLat: resizePlan.targetLat,
                    targetLng: resizePlan.targetLng,
                    targetOffsetX: resizePlan.targetOffsetX,
                    targetOffsetY: resizePlan.targetOffsetY,
                    targetZoom: resizePlan.targetZoom,
                })
            ) {
                return;
            } else if (immediateMarkerCenter) {
                lastImmediateMarkerCenterRef.current = null;
            }

            // 애니메이션 없이 즉시 이동 (부드러움 유지)
            map.setCenter(resizePlan.newCenterLatLng);
        };

        const { cancel, observerCallback } = buildNaverResizeObserverHandler({
            runAfterTransition: handleResize,
            triggerResize: () => {
                window.naver?.maps?.Event?.trigger(map, 'resize');
            },
        });
        const resizeObserver = new ResizeObserver(observerCallback);

        resizeObserver.observe(mapRef.current);

        return buildNaverResizeObserverCleanup({
            cancel,
            disconnect: () => resizeObserver.disconnect(),
        });
    }, [getMobileVerticalOffset, internalPanelOpen, isMapInitialized, isMobileOrTablet, propIsPanelOpen, selectedRestaurant, selectedRegion]);

    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동
    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동 (디바운스 적용)
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const { cancel, handleWindowResize } = buildNaverWindowResizeHandler({
            getMap: () => mapInstanceRef.current,
            triggerResize: (map) => {
                window.naver?.maps?.Event?.trigger(map, 'resize');
            },
        });

        window.addEventListener('resize', handleWindowResize, { passive: true });
        return buildNaverWindowResizeCleanup({
            cancel,
            handleWindowResize,
            removeWindowResizeListener: (handler) => window.removeEventListener('resize', handler),
        });
    }, []);

    const {
        data: restaurants = EMPTY_CONTEXTUAL_RESTAURANTS,
        isFetching: isFetchingRestaurants,
        isLoading: isLoadingRestaurants,
        refetch,
        summary: resultSummary,
    } = useHomeMapResults({
        mapMode: 'domestic', filters, selectedRegion, selectedCountry: null, showUserSubmittedMarkers,
    });
    const restaurantEmptyStateMessage = useMemo(
        () => resultSummary.status === 'error'
            ? '맛집 결과를 불러오지 못했습니다'
            : resolveNaverRestaurantEmptyStateMessage(filters, restaurants),
        [filters, restaurants, resultSummary.status],
    );

    const handleReviewSuccess = useMemo(
        () => buildNaverMapReviewSuccessHandler({ refetch, showMapToast }),
        [refetch, showMapToast]
    );

    // 지역이나 필터가 바뀌면 맛집 개수 배지 표시 플래그를 리셋 (새 쿼리에서 다시 1번 표시)
    useEffect(() => {
        hasShownRestaurantCountRef.current = false;
        setRestaurantCountToastCount(0);
        setShowRestaurantCount(false);
    }, [selectedRegion, filters]);

    // restaurants가 변경될 때 이전 데이터를 저장하고, 개수가 안정된 뒤 최종 개수만 1번 표시
    useEffect(() => {
        const countUpdatePlan = resolveNaverRestaurantCountUpdatePlan({
            hasAlreadyShownCount: hasShownRestaurantCountRef.current,
            hideDelayMs: NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS,
            isMobileOrTablet,
            isNoncriticalEffectsActive: shouldRunNoncriticalMapEffects,
            isLoadingRestaurants: isLoadingRestaurants || isFetchingRestaurants,
            restaurantsLength: restaurants.length,
            settleDelayMs: RESTAURANT_COUNT_TOAST_SETTLE_DELAY_MS,
        });

        if (isLoadingRestaurants || isFetchingRestaurants || restaurants.length === 0) {
            setShowRestaurantCount(false);
            return;
        }

        if (countUpdatePlan.shouldShowRestaurantCount) {
            const showTimer = setTimeout(() => {
                setRestaurantCountToastCount(restaurants.length);
                setShowRestaurantCount(true);
                hasShownRestaurantCountRef.current = true;
            }, countUpdatePlan.settleDelayMs);

            return () => {
                clearTimeout(showTimer);
            };
        }
    }, [
        restaurants,
        isLoadingRestaurants,
        isFetchingRestaurants,
        isMobileOrTablet,
        shouldRunNoncriticalMapEffects,
    ]);

    useEffect(() => {
        if (!showRestaurantCount) return;

        const hideTimer = setTimeout(() => {
            setShowRestaurantCount(false);
        }, NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS);

        return () => {
            clearTimeout(hideTimer);
        };
    }, [showRestaurantCount]);

    const showRestaurantCountRef = useRef(showRestaurantCount);

    useEffect(() => { showRestaurantCountRef.current = showRestaurantCount; }, [showRestaurantCount]);

    const activeMapOverlayKind = resolveNaverMapOverlayKind({
        hasAnnouncementTitle: Boolean(announcementToastTitle),
        hasActiveTheme: Boolean(filters.featuredTheme),
        isLoaded,
        isLoadingRestaurants,
        isMapToastVisible: mapToast?.isVisible === true,
        restaurantsLength: restaurants.length,
        showAnnouncementToast,
        showOnlineUsers,
        showRestaurantCount,
    });

    useEffect(() => {
        const dropPlan = resolveNaverMapTimedOverlayDropPlan(activeMapOverlayKind);
        if (dropPlan.dropMapToast && mapToast?.isVisible) showMapToast.dismiss();
        if (dropPlan.dropAnnouncement && showAnnouncementToast) setShowAnnouncementToast(false);
        if (dropPlan.dropRestaurantCount && showRestaurantCount) setShowRestaurantCount(false);
        if (dropPlan.dropOnlineUsers && showOnlineUsers) setShowOnlineUsers(false);
    }, [
        activeMapOverlayKind,
        mapToast?.isVisible,
        showAnnouncementToast,
        showMapToast,
        showOnlineUsers,
        showRestaurantCount,
    ]);

    const handleAnnouncementToastClick = useCallback(() => {
        if (!announcementToastPayload) return;

        window.dispatchEvent(new CustomEvent('openAnnouncementDetail', { detail: announcementToastPayload }));
    }, [announcementToastPayload]);

    // Map, count and list consume the same complete current query result.
    const displayRestaurants = restaurants;

    const handleClusterExpand = useCallback(({ center, islandViewport, resolveTargetZoom }: NaverClusterExpansion) => {
        activateNoncriticalMapEffects();
        hasUserMovedMapRef.current = true;
        if (fitIslandClusterViewport(islandViewport)) return;
        const targetZoom = Math.max(HOME_MAP_CONTEXTUAL_VISIBLE_RESTAURANTS_MIN_ZOOM, resolveTargetZoom());
        jumpWithPanelOffset(center.lat, center.lng, targetZoom);
    }, [activateNoncriticalMapEffects, fitIslandClusterViewport, jumpWithPanelOffset]);

    const { resolveMarkerRestaurant } = useNaverMapClusterRender({
        map: { mapRef, mapInstanceRef, isMapInitialized, markerRenderSignatureRef },
        displayRestaurants,
        resultSummary,
        query: { filters, selectedRegion, showUserSubmittedMarkers },
        selection: { selectedRestaurant, gridSelectedRestaurant, activeSearchedRestaurant },
        device: { isMobileOrTablet, mapOptimization },
        visibleMarkerReviewBubbles,
        events: {
            onMarkerSelect: handleMarkerRestaurantSelection,
            onClusterExpand: handleClusterExpand,
            onReviewBubbleTargetsChange: setVisibleMarkerReviewBubbleTargets,
            onVisibleRestaurantsChange,
            onContextualRestaurantsChange,
        },
    });

    useEffect(() => {
        const resetPlan = resolveReleasedSearchSelectionResetPlan({
            activeSearchedRestaurant,
            releasedSearchSelectionId: releasedSearchSelectionIdRef.current,
        });

        releasedSearchSelectionIdRef.current = resetPlan.nextReleasedSearchSelectionId;
    }, [activeSearchedRestaurant]);

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
                const restaurant = resolveMarkerRestaurant(restaurantId);
                if (restaurant) {
                    const visual = getNaverIndividualMarkerVisual(restaurant, isSelected);
                    const bubble = selectedRestaurant ? undefined : visibleMarkerReviewBubbles[restaurant.id];
                    const markerContent = wrapNaverMarkerContentWithReviewBubble(
                        visual.content,
                        bubble,
                        isMobileOrTablet,
                    );


                    markerPool.update(restaurantId, {
                        icon: {
                            content: markerContent,
                            anchor: reuseMarkerAnchor(
                                marker.getIcon()?.anchor ?? null,
                                visual.anchor.x,
                                visual.anchor.y,
                                () => new naver.maps.Point(visual.anchor.x, visual.anchor.y),
                            )
                        },
                        zIndex: visual.zIndex
                    });
                }
            }
        });
        if (!selectedRestaurant && hasVisibleMarkerReviewBubbles(visibleMarkerReviewBubbles)) {
            scheduleVisibleMarkerReviewBubbleClamp();
        }

        // ref 업데이트
        prevSelectedMarkerIdRef.current = styleUpdatePlan.nextPreviousSelectedId;

    }, [selectedRestaurant, gridSelectedRestaurant, isGridMode, displayRestaurants, visibleMarkerReviewBubbles, isMobileOrTablet, resolveMarkerRestaurant]);


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



    useEffect(() => () => {
        initialIdleWorkRef.current?.cancel();
        initialIdleWorkRef.current = null;
    }, []);

    // Save only in the existing in-memory cache; no URL/storage coordinate writes.
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!isMapInitialized || !map || isMapViewerLoading) return;
        let active = true;
        const capture = () => {
            if (!active) return;
            try {
                const center = map.getCenter();
                const lat = center.lat(), lng = center.lng(), zoom = map.getZoom();
                if (![lat, lng, zoom].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || zoom < 6 || zoom > 18) return;
                writeHomeRouteMemory(routeQueryClient, mapReturnOwner, "domestic-camera", {lat, lng, zoom});
            } catch { /* A failing provider must not abort route teardown. */ }
        };
        const events = window.naver?.maps?.Event;
        if (typeof events?.addListener !== 'function') return;
        try {
            const listener = events.addListener(map, "idle", capture);
            return () => { capture(); active = false; removeNaverMapListener(events, listener); };
        } catch {
            // A provider can retain the callback before registration throws.
            active = false;
        }
    }, [isMapInitialized, isMapViewerLoading, mapReturnOwner, routeQueryClient]);

    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current || isMapViewerLoading) return;

        const scheduleInitialIdle = (map: NaverMapLike, maps: typeof window.naver.maps | undefined) => {
            initialIdleWorkRef.current?.cancel();
            const events = maps?.Event;
            let active = true;
            const fail = () => {
                if (mapInstanceRef.current !== map) return;
                mapInstanceRef.current = null;
                setIsMapInitialized(false);
                setMapInitError("네이버 지도를 초기화하지 못했습니다.");
                // A failed provider must not interrupt the local failure state.
                try { markerPool.clear(); } catch { /* Best-effort provider teardown. */ }
                try { clusterAnimationManager.clear(); } catch { /* Best-effort animation teardown. */ }
            };
            const timer = scheduleNaverInitialIdleTrigger({
                map,
                triggerIdle: (targetMap) => {
                    if (!active || mapInstanceRef.current !== targetMap) return;
                    active = false;
                    if (window.naver?.maps !== maps || maps?.Event !== events || typeof events?.trigger !== 'function') {
                        fail();
                        return;
                    }
                    try { events.trigger(targetMap, 'idle'); } catch { fail(); }
                },
            });
            initialIdleWorkRef.current = {
                map,
                cancel: () => { active = false; clearTimeout(timer); },
            };
        };

        // 기존 인스턴스가 유효하면 재초기화 불필요
        if (isNaverMapInstanceReusable({
            mapElement: mapRef.current,
            mapInstance: mapInstanceRef.current,
        })) {
            const map = mapInstanceRef.current;
            if (map && initialIdleWorkRef.current?.map !== map) scheduleInitialIdle(map, window.naver?.maps);
            return;
        }

        initialIdleWorkRef.current?.cancel();
        initialIdleWorkRef.current = null;

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
            setMapInitError(null);
            const maps = window.naver?.maps;
            if (!maps) throw new Error("네이버 지도를 초기화하지 못했습니다.");

            const { hasValidUrlState, initialCenter, initialZoom } = resolveNaverInitialMapView({
                getDeviceAdjustedZoom,
                search: window.location.search,
                selectedRegion,
            });

            const camera = hasValidUrlState ? undefined : readHomeRouteMemory<{lat: number; lng: number; zoom: number}>(routeQueryClient, mapReturnOwner, "domestic-camera");
            markInitialLoadMilestone('mapConstructionStarted');
            const map = new maps.Map(mapRef.current, buildNaverMapOptions({
                center: new maps.LatLng(camera?.lat ?? initialCenter[0], camera?.lng ?? initialCenter[1]),
                positionTopLeft: maps.Position.TOP_LEFT,
                positionTopRight: maps.Position.TOP_RIGHT,
                zoom: camera?.zoom ?? initialZoom,
            }));

            try {
                map.getBounds();
            } catch {
                throw new Error("네이버 지도 API가 현재 로컬 주소에서 정상 초기화되지 않았습니다.");
            }

            mapInstanceRef.current = map;
            prevSelectedRestaurantIdRef.current = null;
            if (camera) hasUserMovedMapRef.current = true;
            setIsMapInitialized(true);
            markInitialLoadMilestone('mapConstructed');
            const postInitPlan = resolveNaverPostInitPlan({
                hasValidUrlState,
                nodeEnv: process.env.NODE_ENV,
            });
            if (postInitPlan.shouldExposeDebugMap) {
                (window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown }).__TZUDONG_DEBUG_MAP__ = map;
            }

            // [Fix] URL 파라미터로 초기화된 경우 플래그 설정 (centering effect에서 줌 오버라이드 방지)
            if (postInitPlan.shouldMarkInitialLoadFromUrl || camera) {
                isInitialLoadFromUrlRef.current = true;
            }

            // [Fix] 지도 초기화 후 idle 이벤트 강제 트리거 - 클러스터 초기화 보장
            scheduleInitialIdle(map, maps);

            // [URL 라우팅] 지도 이동 시 URL 동기화 비활성화
            // 사용자가 직접 공유 버튼을 클릭할 때만 URL이 생성되도록 변경
            // idle 이벤트에서 URL 동기화하면 공유 URL 접속 시 원치 않는 URL 변경이 발생함
            // naver.maps.Event.addListener(map, 'idle', () => { ... });

        } catch {
            console.error("네이버 지도 초기화 오류:");
            markInitialLoadMilestone('mapConstructionError');
            markerPool.clear();
            clusterAnimationManager.clear();
            mapInstanceRef.current = null;
            setIsMapInitialized(false);
            setMapInitError("네이버 지도를 초기화하지 못했습니다.");
            showMapToast("지도를 초기화하는 중 오류가 발생했습니다.", 'error');
        }
    }, [isLoaded, isMapViewerLoading, mapReturnOwner, routeQueryClient, getDeviceAdjustedZoom, selectedRegion, showMapToast]);

    // [New] 커스텀 스크롤 휠 핸들러 (마우스 호버 위치 기준 줌 고정)
    useEffect(() => {
        if (!isMapInitialized || !mapRef.current || !mapInstanceRef.current) return;

        const mapElement = mapRef.current;
        const map = mapInstanceRef.current;

        // 연속 스크롤 시 목표 줌 레벨 추적 변수 (Effect 클로저 내 유지)
        let targetZoomLevel = map.getZoom();
        let lastWheelTime = 0;
        let pendingAnchorAdjustListener: unknown = null;
        let cancelPendingAnchorAdjust: (() => void) | undefined;
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

            activateNoncriticalMapEffects();

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

                    // 보정 중일 때는 후속 휠 입력을 큐에 보관하고 중심 보정 이후 순차 처리
                    isAnchorAdjusting = true;

                    const applyAnchorCorrection = (updatedProjection: NonNullable<ReturnType<typeof map.getProjection>>) => {
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
                    };

                    const finishAnchorCorrection = () => {
                        const postAdjustPlan = resolveNaverWheelPostAdjustPlan({
                            currentZoom: map.getZoom(),
                            hasQueuedWheelInput: queuedWheelInput !== null,
                        });
                        isAnchorAdjusting = postAdjustPlan.nextIsAnchorAdjusting;
                        targetZoomLevel = postAdjustPlan.nextTargetZoomLevel;
                        if (postAdjustPlan.shouldScheduleQueuedInput) {
                            window.requestAnimationFrame(runQueuedWheelInput);
                        }
                    };

                    const offsetBeforeZoom = projection.fromCoordToOffset(beforeCoord);
                    map.setZoom(nextZoom, false);
                    const updatedProjection = map.getProjection();
                    const offsetAfterZoom = updatedProjection?.fromCoordToOffset(beforeCoord) ?? null;
                    if (updatedProjection && hasNaverWheelProjectionUpdated(offsetBeforeZoom, offsetAfterZoom)) {
                        try {
                            applyAnchorCorrection(updatedProjection);
                        } finally {
                            finishAnchorCorrection();
                        }
                        return;
                    }

                    // 투영이 아직 이전 줌이면 idle 이후에 한 번만 보정한다.
                    cancelPendingAnchorAdjust?.();
                    const anchorCompletion = createNaverOneShotCallback(() => {
                        pendingAnchorAdjustListener = clearNaverPendingAnchorAdjustListener({
                            pendingAnchorAdjustListener,
                            removeListener: (listener) => { removeNaverMapListener(naver.maps.Event, listener); },
                        }).nextPendingAnchorAdjustListener;

                        try {
                            const idleProjection = map.getProjection();
                            if (!idleProjection) return;
                            applyAnchorCorrection(idleProjection);
                        } finally {
                            finishAnchorCorrection();
                        }
                    });
                    cancelPendingAnchorAdjust = anchorCompletion.cancel;
                    pendingAnchorAdjustListener = naver.maps.Event.addListener(map, 'idle', anchorCompletion.handle);
                } catch (error) {
                    console.error("휠 줌 포인터 고정 처리 실패:");
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
        const updatePopularityZoom = () => syncPopularityMarkerZoom(mapElement, map.getZoom());
        updatePopularityZoom();
        const interacting = createNaverCancellableCallback(() => {
            syncPopularityMarkerInteraction(mapElement, true);
            updatePopularityZoom();
        });
        const settled = createNaverCancellableCallback(() => {
            syncPopularityMarkerInteraction(mapElement, false);
            updatePopularityZoom();
        });
        const interactionListeners = window.naver?.maps?.Event
            ? [
                window.naver.maps.Event.addListener(map, "dragstart", interacting.handle),
                window.naver.maps.Event.addListener(map, "idle", settled.handle),
                window.naver.maps.Event.addListener(map, "zoom_changed", interacting.handle),
            ]
            : [];

        return () => {
            interacting.cancel();
            settled.cancel();
            cancelPendingAnchorAdjust?.();
            if (pendingAnchorAdjustListener && window.naver?.maps?.Event) {
                pendingAnchorAdjustListener = clearNaverPendingAnchorAdjustListener({
                    pendingAnchorAdjustListener,
                    removeListener: (listener) => { removeNaverMapListener(window.naver?.maps?.Event, listener); },
                }).nextPendingAnchorAdjustListener;
            }
            const cleanupState = resolveNaverWheelCleanupState();
            isAnchorAdjusting = cleanupState.nextIsAnchorAdjusting;
            queuedWheelInput = cleanupState.nextQueuedWheelInput;
            mapElement.removeEventListener('wheel', handleWheel);
            if (window.naver?.maps?.Event) {
                for (const listener of interactionListeners) {
                    removeNaverMapListener(window.naver.maps.Event, listener);
                }
            }
            syncPopularityMarkerInteraction(mapElement, false);
            mapElement.removeAttribute("data-popularity-details");
        };
    }, [activateNoncriticalMapEffects, isMapInitialized]);

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
    const auxiliaryRuntimes = isLoaded && shouldRunNoncriticalMapEffects && !isPublicRestrictedMode ? (
        <Suspense fallback={null}>
            <NaverMapAnnouncementRuntime
                isAnnouncementToastVisible={showAnnouncementToast}
                onAnnouncementToastPayloadChange={setAnnouncementToastPayload}
                onAnnouncementToastTitleChange={setAnnouncementToastTitle}
                onShowAnnouncementToastChange={setShowAnnouncementToast}
            />
            <NaverMapPresenceRuntime
                isOnlineUsersToastVisible={showOnlineUsers}
                onOnlineUsersCountChange={setOnlineUsersCount}
                onShowOnlineUsersChange={setShowOnlineUsers}
            />
        </Suspense>
    ) : null;

    // 로딩 에러 처리
    if (loadError || mapInitError) {
        return <NaverMapLoadErrorState message={loadError?.message ?? mapInitError ?? "네이버 지도를 초기화하지 못했습니다."} onRetry={loadError ? load : undefined} />;
    }

    // 로딩 중
    if (!isLoaded) {
        return <MapSkeleton message="네이버 지도 화면을 준비하고 있어요" />;
    }

    // 그리드 모드에서는 기존 레이아웃 유지
    if (isGridMode) {
        return (
            <div className="relative h-full">
                {auxiliaryRuntimes}
                <NaverMapSurface
                    activeThemeId={filters.featuredTheme}
                    announcementToastTitle={announcementToastTitle}
                    badgePositionClass={floatingBadgePositionClass}
                    count={onlineUsersCount}
                    dataTestId="map-container"
                    isLoaded={isLoaded}
                    isLoadingRestaurants={isLoadingRestaurants}
                    mapRef={mapRef}
                    mapToast={mapToast}
                    onAnnouncementToastClick={handleAnnouncementToastClick}
                    renderOverlayStack={!isMobileOrTablet}
                    restaurantCountToastCount={restaurantCountToastCount}
                    restaurantsLength={restaurants.length}
                    emptyStateMessage={restaurantEmptyStateMessage}
                    showAnnouncementToast={showAnnouncementToast}
                    showOnlineUsers={showOnlineUsers}
                    showRestaurantCount={showRestaurantCount}
                />
                {/* 모바일: z-0 스태킹 컨텍스트 밖에서 렌더링하여 MobileControlOverlay 위에 표시 */}
                {isMobileOrTablet && (
                    <NaverMapOverlayStack
                        activeThemeId={filters.featuredTheme}
                        announcementToastTitle={announcementToastTitle}
                        badgePositionClass={floatingBadgePositionClass}
                        count={onlineUsersCount}
                        isLoaded={isLoaded}
                        isLoadingRestaurants={isLoadingRestaurants}
                        isMobileOverlayReady={shouldRunNoncriticalMapEffects}
                        mapToast={mapToast}
                        onAnnouncementToastClick={handleAnnouncementToastClick}
                        restaurantCountToastCount={restaurantCountToastCount}
                        restaurantsLength={restaurants.length}
                        emptyStateMessage={restaurantEmptyStateMessage}
                        showAnnouncementToast={showAnnouncementToast}
                        showOnlineUsers={showOnlineUsers}
                        showRestaurantCount={showRestaurantCount}
                    />
                )}
            </div >
        );
    }

    // 단일 지도 모드에서는 Flexbox 레이아웃 적용 (고정 너비 패널)
    return (
        <div className="h-full flex relative overflow-hidden">
            {auxiliaryRuntimes}
            {/* 지도 영역 */}
            <NaverMapSurface
                activeThemeId={filters.featuredTheme}
                announcementToastTitle={announcementToastTitle}
                badgePositionClass={floatingBadgePositionClass}
                className="flex-1 h-full relative z-0"
                count={onlineUsersCount}
                dataTestId="map-container"
                isLoaded={isLoaded}
                isLoadingRestaurants={isLoadingRestaurants}
                mapRef={mapRef}
                mapToast={mapToast}
                onAnnouncementToastClick={handleAnnouncementToastClick}
                renderOverlayStack={!isMobileOrTablet}
                restaurantCountToastCount={restaurantCountToastCount}
                restaurantsLength={restaurants.length}
                emptyStateMessage={restaurantEmptyStateMessage}
                showAnnouncementToast={showAnnouncementToast}
                showOnlineUsers={showOnlineUsers}
                showRestaurantCount={showRestaurantCount}
            />

            {/* 모바일: z-0 스태킹 컨텍스트 밖에서 렌더링하여 MobileControlOverlay 위에 표시 */}
            {isMobileOrTablet && (
                <NaverMapOverlayStack
                    activeThemeId={filters.featuredTheme}
                    announcementToastTitle={announcementToastTitle}
                    badgePositionClass={floatingBadgePositionClass}
                    count={onlineUsersCount}
                    isLoaded={isLoaded}
                    isLoadingRestaurants={isLoadingRestaurants}
                    isMobileOverlayReady={shouldRunNoncriticalMapEffects}
                    mapToast={mapToast}
                    onAnnouncementToastClick={handleAnnouncementToastClick}
                    restaurantCountToastCount={restaurantCountToastCount}
                    restaurantsLength={restaurants.length}
                    emptyStateMessage={restaurantEmptyStateMessage}
                    showAnnouncementToast={showAnnouncementToast}
                    showOnlineUsers={showOnlineUsers}
                    showRestaurantCount={showRestaurantCount}
                />
            )}

            {/* 레스토랑 상세 패널 - 외부 onMarkerClick이 없을 때만 렌더링 (외부 패널 관리가 아닌 경우에만) */}
            {selectedRestaurant && !onMarkerClick && (
                <Suspense fallback={null}>
                    <HydratedDetailRestaurant restaurant={selectedRestaurant}>
                        {(detailRestaurant) => (
                            <>
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
                                    restaurant={detailRestaurant}
                                />
                                <NaverMapReviewModal
                                    isOpen={isReviewModalOpen}
                                    onClose={handleCloseReviewModal}
                                    restaurant={getNaverMapReviewRestaurant(detailRestaurant)}
                                    onSuccess={handleReviewSuccess}
                                />
                            </>
                        )}
                    </HydratedDetailRestaurant>
                </Suspense>
            )}
        </div>
    );
});

NaverMapView.displayName = 'NaverMapView';

export default NaverMapView;
