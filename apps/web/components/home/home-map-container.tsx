'use client';

import { Suspense, lazy, useState, useCallback, memo, useRef, useEffect, useMemo } from 'react';
import type { Restaurant, Region } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { OVERSEAS_REGIONS } from "@/constants/overseas-regions";
import {
    APP_HEADER_HEIGHT_VAR,
    resetMobileSheetLayoutState,
    setMobileSheetLayoutState,
} from '@/lib/mobile-sheet-layout';
import {
    getAdjacentRestaurantByStep,
    handleDesktopArrowNavigationEvent,
} from '@/lib/home-map-keyboard-navigation';

// [CSR] 지도 컴포넌트 지연 로딩 - 번들 사이즈 최적화
const NaverMapView = lazy(() => import("@/components/map/NaverMapView"));
const OverseasMap = lazy(() => import("@/components/map/OverseasMap"));
const RestaurantDetailPanel = lazy(() =>
    import("@/components/restaurant/RestaurantDetailPanel").then((mod) => ({
        default: mod.RestaurantDetailPanel,
    }))
);

interface HomeMapContainerProps {
    mapMode: 'domestic' | 'overseas';
    mapFocusZoom?: number | null; // [New] 줌 레벨 제어
    filters: FilterState;
    selectedRegion: Region | null;
    selectedCountry: string | null;
    searchedRestaurant: Restaurant | null;
    selectedRestaurant: Restaurant | null;
    refreshTrigger: number;
    panelRestaurant: Restaurant | null;
    isPanelOpen: boolean;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRequestEditRestaurant: (restaurant: Restaurant) => void;
    onRestaurantSelect: (restaurant: Restaurant | null) => void;
    onReleaseSearchSelectionOwnership?: () => void;

    onMapReady: (moveFunction: (restaurant: Restaurant) => void) => void;
    onMarkerClick: (restaurant: Restaurant) => void;
    onPanelClose: () => void;
    onReviewModalOpen: () => void;
    onTogglePanelCollapse?: () => void;
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    externalPanelOpen?: boolean; // 외부 패널이 열려있지 않을 때 NaverMap 내부 패널 닫기
    isPanelCollapsed?: boolean; // 패널 접기 상태
    onSwipeableRestaurantsChange?: (restaurants: Restaurant[]) => void;
}

// ========== [PERFORMANCE] 상수 호이스팅 - 컴포넌트 외부로 이동하여 리렌더링 시 재선언 방지 ==========
const INITIAL_HEIGHT = 50;
const HOME_MAP_MOBILE_LAYOUT_SOURCE = 'home-map-bottom-sheet';
const HEADER_OFFSET = 0;
const PEEK_SHEET_HEIGHT = 25;
const HALF_SHEET_HEIGHT = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.22;
const SWIPE_VELOCITY_CLOSE_THRESHOLD = 0.26;
const SWIPE_VELOCITY_OPEN_THRESHOLD = 0.24;
const CONTENT_TOP_EPSILON = 2;
const CONTENT_DRAG_START_THRESHOLD = 10;
const CONTENT_HORIZONTAL_SWIPE_THRESHOLD = 10;
const CONTENT_HORIZONTAL_INTENT_RATIO = 0.85;
const CONTENT_VERTICAL_INTENT_RATIO = 1.3;
const CONTENT_FULL_DRAG_START_THRESHOLD = 22;
const CONTENT_FULL_VERTICAL_INTENT_RATIO = 1.8;
const SHEET_HALF_OPEN_TOLERANCE = 1;
const HALF_TO_FULL_DISTANCE_PX = 14;
const FULL_TO_HALF_DISTANCE_PX = 18;
const FULL_TO_HALF_FAST_DISTANCE_PX = 18;
const HALF_TO_PEEK_DISTANCE_PX = 28;
const HALF_TO_FULL_FAST_DISTANCE_PX = 12;
const HALF_TO_FULL_VELOCITY_FLOOR_PX_PER_MS = 0.16;
const HALF_TO_FULL_QUICK_VELOCITY_FLOOR_PX_PER_MS = 0.19;
const QUICK_GESTURE_DURATION_MS = 85;
const QUICK_GESTURE_EXTRA_DISTANCE_PX = 2;
const QUICK_GESTURE_SHORT_DISTANCE_PX = 25;
const LONG_PRESS_TRANSITION_THRESHOLD_MS = 175;
const DRAG_RENDER_EPSILON_PERCENT = 0.08;
const SNAP_TRANSITION_BASE_MS = 235;
const SNAP_TRANSITION_FAST_MS = 175;
const SNAP_TRANSITION_SMOOTH_MS = 295;
const SNAP_EASING_BASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SNAP_EASING_FAST = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SNAP_EASING_SMOOTH = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const SHEET_HEIGHT_CSS_VAR = '--home-sheet-height-px';
const KOREA_BOUNDS = {
    minLat: 33,
    maxLat: 39,
    minLng: 124,
    maxLng: 132,
} as const;
const OVERSEAS_KEYWORDS = Object.values(OVERSEAS_REGIONS).flatMap(config =>
    config.keywords.map((keyword) => keyword.toLowerCase())
);

type SheetSnapTransition = {
    duration: number;
    easing: string;
};

const isSameRestaurantForSwipe = (a: Restaurant, b: Restaurant) => {
    if (a.id === b.id) return true;

    if (a.mergedRestaurants?.some((restaurant) => restaurant.id === b.id)) return true;
    if (b.mergedRestaurants?.some((restaurant) => restaurant.id === a.id)) return true;

    if (a.name === b.name && a.lat && a.lng && b.lat && b.lng) {
        const aLat = Number(a.lat);
        const aLng = Number(a.lng);
        const bLat = Number(b.lat);
        const bLng = Number(b.lng);

        if (
            Number.isFinite(aLat) &&
            Number.isFinite(aLng) &&
            Number.isFinite(bLat) &&
            Number.isFinite(bLng) &&
            Math.abs(aLat - bLat) < 0.0001 &&
            Math.abs(aLng - bLng) < 0.0001
        ) {
            return true;
        }
    }

    return false;
};

const RESTAURANT_CONTENT_SCROLL_SELECTOR = "[data-restaurant-detail-swipe-area='content']";

// [CSR] 지도 렌더링 및 그리드/단일 모드 처리 - 브라우저 전용 지도 라이브러리 사용
function HomeMapContainerComponent({
    mapMode,
    mapFocusZoom,
    filters,
    selectedRegion,
    selectedCountry,
    searchedRestaurant,
    selectedRestaurant,
    refreshTrigger,
    panelRestaurant,
    isPanelOpen,
    onAdminEditRestaurant,
    onRequestEditRestaurant,
    onRestaurantSelect,
    onReleaseSearchSelectionOwnership,

    onMapReady,
    onMarkerClick,
    onPanelClose,
    onReviewModalOpen,
    onTogglePanelCollapse,
    activePanel,
    onPanelClick,
    externalPanelOpen,
    isPanelCollapsed,
    onSwipeableRestaurantsChange,
}: HomeMapContainerProps) {
    const { isMobileOrTablet, isDesktop } = useDeviceType();

    // [PERFORMANCE] 드래그 중 리렌더링 제거 - Ref로 관리
    const viewportHeightRef = useRef(typeof window !== 'undefined'
        ? (window.visualViewport?.height ?? window.innerHeight)
        : 800
    );
    const isDraggingRef = useRef(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(INITIAL_HEIGHT);
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);
    const dragEndYRef = useRef(0);
    const dragEndTimeRef = useRef(0);
    const handleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const sheetContainerRef = useRef<HTMLDivElement>(null);
    const detailScrollAreaRef = useRef<HTMLElement | null>(null);
    const lockedContentScrollTargetRef = useRef<HTMLElement | null>(null);
    const lockedContentScrollTargetOverflowRef = useRef<string | null>(null);
    const lockedContentRootOverflowRef = useRef<string | null>(null);
    const sheetHeightRef = useRef(INITIAL_HEIGHT);
    const sheetHeightPxRef = useRef(0);
    const dragStartTimeRef = useRef(0);
    const contentTouchStartYRef = useRef(0);
    const contentTouchStartXRef = useRef(0);
    const isContentDraggingSheetRef = useRef(false);
    const contentSwipeDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);
    const isCarouselTouchRef = useRef(false);
    const wasPanelOpenRef = useRef(false);
    const lastPanelRestaurantIdRef = useRef<string | null>(null);
    const contentScrollResetNeededRef = useRef(false);
    const pendingSwipeableRestaurantsRef = useRef<Restaurant[]>([]);
    const swipeableRestaurantsRafRef = useRef(0);

    // [PERFORMANCE] 렌더링에 필요한 상태만 useState로 관리
    const [sheetHeight, setSheetHeight] = useState(INITIAL_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [sheetSnapTransition, setSheetSnapTransition] = useState<SheetSnapTransition>({
        duration: SNAP_TRANSITION_BASE_MS,
        easing: SNAP_EASING_BASE,
    });
    const [swipeableRestaurantsByMode, setSwipeableRestaurantsByMode] = useState<{
        domestic: Restaurant[];
        overseas: Restaurant[];
    }>({
        domestic: [],
        overseas: [],
    });
    const activeSwipeableRestaurants = useMemo(
        () => (mapMode === 'domestic' ? swipeableRestaurantsByMode.domestic : swipeableRestaurantsByMode.overseas),
        [mapMode, swipeableRestaurantsByMode]
    );
    const getRestaurantAddressText = useCallback((restaurant: Restaurant) => {
        return `${restaurant.road_address || ''} ${restaurant.jibun_address || ''} ${restaurant.english_address || ''}`.toLowerCase();
    }, []);

    const isOverseasByCoordinate = useCallback((restaurant: Restaurant) => {
        const lat = Number(restaurant.lat);
        const lng = Number(restaurant.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return false;
        }

        return (
            lat < KOREA_BOUNDS.minLat ||
            lat > KOREA_BOUNDS.maxLat ||
            lng < KOREA_BOUNDS.minLng ||
            lng > KOREA_BOUNDS.maxLng
        );
    }, []);

    const getSelectedCountryKeywords = useMemo(() => {
        if (!selectedCountry || !(selectedCountry in OVERSEAS_REGIONS)) {
            return null;
        }

        return OVERSEAS_REGIONS[selectedCountry as keyof typeof OVERSEAS_REGIONS]
            .keywords
            .map((keyword) => keyword.toLowerCase());
    }, [selectedCountry]);

    const getRestaurantListByMode = useCallback((restaurants: Restaurant[]) => {
        if (!restaurants.length) return [];

        return restaurants.filter((restaurant) => {
            const addressText = getRestaurantAddressText(restaurant);
            const hasOverseasKeyword = OVERSEAS_KEYWORDS.some((keyword) => addressText.includes(keyword));
            const isOverseasCoord = isOverseasByCoordinate(restaurant);

            if (mapMode === 'domestic') {
                return !hasOverseasKeyword && !isOverseasCoord;
            }

            if (getSelectedCountryKeywords?.length) {
                return getSelectedCountryKeywords.some((keyword) => addressText.includes(keyword));
            }

            return hasOverseasKeyword || isOverseasCoord;
        });
    }, [getRestaurantAddressText, getSelectedCountryKeywords, isOverseasByCoordinate, mapMode]);

    const getCurrentMaxHeight = useCallback((vh: number = viewportHeightRef.current) => {
        return ((vh - HEADER_OFFSET) / vh) * 100;
    }, []);

    const getContentSnapPoints = useCallback(() => {
        const maxSnap = Math.max(HALF_SHEET_HEIGHT, getCurrentMaxHeight());
        return [PEEK_SHEET_HEIGHT, HALF_SHEET_HEIGHT, maxSnap];
    }, [getCurrentMaxHeight]);

    const getNearestSnapHeight = useCallback((currentHeight: number) => {
        const snapPoints = getContentSnapPoints();
        return snapPoints.reduce((closest, snap) =>
            Math.abs(snap - currentHeight) < Math.abs(closest - currentHeight) ? snap : closest
        , snapPoints[0]);
    }, [getContentSnapPoints]);

    const pxToPercent = useCallback((px: number) => {
        return (px / viewportHeightRef.current) * 100;
    }, []);

    const percentToPx = useCallback((percent: number) => {
        return (percent / 100) * viewportHeightRef.current;
    }, []);

    const syncMobileLayout = useCallback((heightPercent: number) => {
        if (!isMobileOrTablet || !isPanelOpen) {
            resetMobileSheetLayoutState(HOME_MAP_MOBILE_LAYOUT_SOURCE);
            return;
        }

        const maxHeight = getCurrentMaxHeight();
        const clampedHeight = Math.max(PEEK_SHEET_HEIGHT, Math.min(maxHeight, heightPercent));
        const hideBottomNav = true;
        const headerHideProgress =
            clampedHeight <= HALF_SHEET_HEIGHT
                ? 0
                : Math.max(0, Math.min(1, (clampedHeight - HALF_SHEET_HEIGHT) / Math.max(1, maxHeight - HALF_SHEET_HEIGHT)));

        setMobileSheetLayoutState({
            source: HOME_MAP_MOBILE_LAYOUT_SOURCE,
            hideBottomNav,
            headerHideProgress,
        });
    }, [getCurrentMaxHeight, isMobileOrTablet, isPanelOpen]);

    const writeSheetHeightStyle = useCallback((heightPercent: number) => {
        const sheetContainer = sheetContainerRef.current;
        if (!sheetContainer) return;

        const nextHeightPx = percentToPx(heightPercent);
        if (Math.abs(sheetHeightPxRef.current - nextHeightPx) < 0.25) return;

        sheetHeightPxRef.current = nextHeightPx;
        sheetContainer.style.setProperty(SHEET_HEIGHT_CSS_VAR, `${nextHeightPx}px`);
    }, [percentToPx]);

    const applySnapTransition = useCallback((isFlick: boolean, distancePx: number, isLongPress: boolean) => {
        if (isFlick) {
            setSheetSnapTransition({
                duration: SNAP_TRANSITION_FAST_MS,
                easing: SNAP_EASING_FAST,
            });
            return;
        }

        if (isLongPress || distancePx >= 80) {
            setSheetSnapTransition({
                duration: SNAP_TRANSITION_SMOOTH_MS,
                easing: SNAP_EASING_SMOOTH,
            });
            return;
        }

        setSheetSnapTransition({
            duration: SNAP_TRANSITION_BASE_MS,
            easing: SNAP_EASING_BASE,
        });
    }, []);

    const getDetailScrollArea = useCallback(() => {
        const cachedScrollArea = detailScrollAreaRef.current;
        if (cachedScrollArea && contentRef.current?.contains(cachedScrollArea)) {
            return cachedScrollArea;
        }

        if (!contentRef.current) {
            detailScrollAreaRef.current = null;
            return null;
        }

        const scrollArea = contentRef.current.querySelector<HTMLElement>(RESTAURANT_CONTENT_SCROLL_SELECTOR);
        detailScrollAreaRef.current = scrollArea;
        return scrollArea;
    }, []);

    const unlockContentScrollDuringDrag = useCallback(() => {
        const lockedTarget = lockedContentScrollTargetRef.current;
        if (lockedTarget) {
            lockedTarget.style.overflowY = lockedContentScrollTargetOverflowRef.current ?? '';
        }

        const content = contentRef.current;
        if (content) {
            content.style.overflowY = lockedContentRootOverflowRef.current ?? '';
        }

        lockedContentScrollTargetRef.current = null;
        lockedContentScrollTargetOverflowRef.current = null;
        lockedContentRootOverflowRef.current = null;
    }, []);

    const lockContentScrollDuringDrag = useCallback((preferredTarget?: HTMLElement | null) => {
        const content = contentRef.current;
        if (!content) return;

        if (lockedContentRootOverflowRef.current === null) {
            lockedContentRootOverflowRef.current = content.style.overflowY;
        }
        content.style.overflowY = 'hidden';

        const target = preferredTarget ?? getDetailScrollArea();
        if (!target) return;

        if (lockedContentScrollTargetRef.current && lockedContentScrollTargetRef.current !== target) {
            lockedContentScrollTargetRef.current.style.overflowY = lockedContentScrollTargetOverflowRef.current ?? '';
            lockedContentScrollTargetRef.current = null;
            lockedContentScrollTargetOverflowRef.current = null;
        }

        if (!lockedContentScrollTargetRef.current) {
            lockedContentScrollTargetRef.current = target;
            lockedContentScrollTargetOverflowRef.current = target.style.overflowY;
        }

        target.style.overflowY = 'hidden';
    }, [getDetailScrollArea]);

    const setSheetHeightSafe = useCallback((nextHeight: number, forceRender = false) => {
        const maxHeight = getCurrentMaxHeight();
        const nextHeightSafe = Math.max(PEEK_SHEET_HEIGHT, Math.min(maxHeight, nextHeight));
        if (Math.abs(sheetHeightRef.current - nextHeightSafe) < DRAG_RENDER_EPSILON_PERCENT) {
            syncMobileLayout(nextHeightSafe);
            return;
        }

        sheetHeightRef.current = nextHeightSafe;
        writeSheetHeightStyle(nextHeightSafe);
        syncMobileLayout(nextHeightSafe);

        const shouldCommitRender = forceRender || !isDraggingRef.current;
        if (!shouldCommitRender) {
            return;
        }

        setSheetHeight(nextHeightSafe);
    }, [getCurrentMaxHeight, syncMobileLayout, writeSheetHeightStyle]);

    const resetSheetInteractionState = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
        isContentDraggingSheetRef.current = false;
        contentSwipeDirectionRef.current = null;
        velocityRef.current = 0;
        unlockContentScrollDuringDrag();
    }, [unlockContentScrollDuringDrag]);

    const resetContentScrollPosition = useCallback(() => {
        if (!contentRef.current) return;

        contentRef.current.scrollTop = 0;
        const detailScrollArea = getDetailScrollArea();
        if (detailScrollArea) {
            detailScrollArea.scrollTop = 0;
        }
    }, [getDetailScrollArea]);

    // [PERFORMANCE] visualViewport resize 스로틀링 (16ms ≈ 60fps)
    useEffect(() => {
        const viewport = window.visualViewport;
        if (!viewport) return;

        let throttleTimer: number | null = null;

        const handleResize = () => {
            if (throttleTimer !== null) return;

            throttleTimer = requestAnimationFrame(() => {
            viewportHeightRef.current = viewport.height;
                // 드래그 중이 아닐 때만 상태 업데이트 (리렌더링 최소화)
                if (!isDraggingRef.current) {
                    const currentMaxHeight = getCurrentMaxHeight(viewport.height);
                    setSheetHeight(prev => Math.max(PEEK_SHEET_HEIGHT, Math.min(prev, currentMaxHeight)));
                } else if (sheetContainerRef.current) {
                    const sheetHeightPx = percentToPx(sheetHeightRef.current);
                    sheetContainerRef.current.style.setProperty(SHEET_HEIGHT_CSS_VAR, `${sheetHeightPx}px`);
                    sheetHeightPxRef.current = sheetHeightPx;
                }
                throttleTimer = null;
            });
        };

        viewport.addEventListener('resize', handleResize, { passive: true });
        return () => {
            viewport.removeEventListener('resize', handleResize);
            if (throttleTimer !== null) cancelAnimationFrame(throttleTimer);
        };
    }, [getCurrentMaxHeight, percentToPx]);

    // 패널이 열릴 때 50% 높이로 열기 (헤더 배제)
    useEffect(() => {
        if (!isMobileOrTablet) return;

        if (!isPanelOpen) {
            resetSheetInteractionState();
            wasPanelOpenRef.current = false;
            lastPanelRestaurantIdRef.current = null;
            contentScrollResetNeededRef.current = false;
            resetMobileSheetLayoutState(HOME_MAP_MOBILE_LAYOUT_SOURCE);
            return;
        }

        if (!panelRestaurant) {
            contentScrollResetNeededRef.current = false;
            return;
        }

        const nextPanelRestaurantId = panelRestaurant.id;
        const isNewRestaurant = lastPanelRestaurantIdRef.current !== nextPanelRestaurantId;
        const isFirstOpen = !wasPanelOpenRef.current;
        const shouldResetContentScroll = isFirstOpen || isNewRestaurant;

        // 중요: 바텀시트가 이미 열린 상태에서 맛집만 바뀌는 경우(예: 좌우 스와이프),
        // 현재 높이를 유지해야 하므로 최초 오픈일 때만 50%로 초기화한다.
        if (isFirstOpen) {
            setSheetHeightSafe(Math.min(HALF_SHEET_HEIGHT, getCurrentMaxHeight()));
        }
        contentScrollResetNeededRef.current = shouldResetContentScroll;

        lastPanelRestaurantIdRef.current = nextPanelRestaurantId;
        wasPanelOpenRef.current = true;
        resetSheetInteractionState();
    }, [
        isPanelOpen,
        isMobileOrTablet,
        panelRestaurant,
        panelRestaurant?.id,
        getCurrentMaxHeight,
        resetSheetInteractionState,
        setSheetHeightSafe
    ]);

    useEffect(() => {
        return () => {
            resetMobileSheetLayoutState(HOME_MAP_MOBILE_LAYOUT_SOURCE);
        };
    }, []);

    useEffect(() => {
        if (!isPanelOpen) {
            detailScrollAreaRef.current = null;
            return;
        }
    }, [isPanelOpen, panelRestaurant?.id]);

    useEffect(() => {
        sheetHeightRef.current = sheetHeight;
    }, [sheetHeight]);

    useEffect(() => {
        if (!isMobileOrTablet || !isPanelOpen || !panelRestaurant) return;

        if (!contentScrollResetNeededRef.current) return;

        const rafId = requestAnimationFrame(() => {
            resetContentScrollPosition();
            contentScrollResetNeededRef.current = false;
        });

        return () => cancelAnimationFrame(rafId);
    }, [
        isPanelOpen,
        isMobileOrTablet,
        panelRestaurant,
        panelRestaurant?.id,
        resetContentScrollPosition
    ]);

    const startSheetDrag = useCallback((clientY: number) => {
        isDraggingRef.current = true;
        startYRef.current = clientY;
        startHeightRef.current = sheetHeightRef.current;
        dragStartTimeRef.current = performance.now();
        lastYRef.current = clientY;
        lastTimeRef.current = performance.now();
        dragEndYRef.current = clientY;
        dragEndTimeRef.current = performance.now();
        velocityRef.current = 0;
        setSheetSnapTransition({
            duration: SNAP_TRANSITION_BASE_MS,
            easing: SNAP_EASING_BASE,
        });

        if (sheetContainerRef.current) {
            sheetContainerRef.current.style.transitionDuration = '0ms';
        }
        lockContentScrollDuringDrag();
        setIsDragging(true);
    }, [lockContentScrollDuringDrag]);

    const canContentDragFromTouch = useCallback((deltaY: number) => {
        const scrollArea = getDetailScrollArea();
        const top = scrollArea ? scrollArea.scrollTop : contentRef.current?.scrollTop ?? 0;

        const currentMaxHeight = getCurrentMaxHeight();
        const isAtHalf = sheetHeightRef.current <= HALF_SHEET_HEIGHT + SHEET_HALF_OPEN_TOLERANCE;
        const isAtFull = sheetHeightRef.current >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;

        if (isAtHalf) return top <= CONTENT_TOP_EPSILON;
        if (deltaY > 0 && isAtFull) return top <= CONTENT_TOP_EPSILON;

        return false;
    }, [getCurrentMaxHeight, getDetailScrollArea]);

    const endSheetDrag = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
        unlockContentScrollDuringDrag();

        const currentHeight = sheetHeightRef.current;
        const currentMaxHeight = getCurrentMaxHeight();
        const elapsedMs = Math.max(16, dragEndTimeRef.current - dragStartTimeRef.current);
        const dragDistancePx = dragEndYRef.current - startYRef.current;
        const upwardDistancePx = startYRef.current - dragEndYRef.current;
        const gestureVelocity = elapsedMs > 0
            ? dragDistancePx / elapsedMs
            : velocityRef.current;
        const isSwipeDown = gestureVelocity >= SWIPE_VELOCITY_THRESHOLD;
        const isSwipeDownStrong = gestureVelocity >= SWIPE_VELOCITY_CLOSE_THRESHOLD;
        const isSwipeUpStrong = gestureVelocity <= -SWIPE_VELOCITY_OPEN_THRESHOLD;
        const movementFromStart = currentHeight - startHeightRef.current;
        const movementPxFromStart = percentToPx(movementFromStart);
        const startedAtPeek = startHeightRef.current <= PEEK_SHEET_HEIGHT + 0.5;
        const startedAtHalf = !startedAtPeek && startHeightRef.current <= HALF_SHEET_HEIGHT + 0.5;
        const startedAtFull = startHeightRef.current >= currentMaxHeight - 0.5;
        const isQuickGesture = elapsedMs <= QUICK_GESTURE_DURATION_MS;
        const movementPx = Math.abs(movementPxFromStart);
        const isLongPress = !isQuickGesture && elapsedMs >= LONG_PRESS_TRANSITION_THRESHOLD_MS;
        const peekToHalfDistancePercent = pxToPercent(
            HALF_TO_FULL_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const halfToFullDistancePercent = pxToPercent(
            HALF_TO_FULL_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const fullToHalfDistancePercent = pxToPercent(
            FULL_TO_HALF_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const halfToPeekDistancePercent = pxToPercent(
            HALF_TO_PEEK_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0)
        );
        const shouldUseFastTransition = isSwipeUpStrong || isSwipeDownStrong;
        const isQuickAndSmall = isQuickGesture && movementPx <= QUICK_GESTURE_SHORT_DISTANCE_PX;
        const shouldUseSmoothTransition = isLongPress || (!isQuickAndSmall && movementPx > QUICK_GESTURE_SHORT_DISTANCE_PX) || dragDistancePx > HALF_TO_PEEK_DISTANCE_PX;

        applySnapTransition(
            shouldUseFastTransition,
            movementPx,
            shouldUseSmoothTransition
        );
        velocityRef.current = 0;

        const fullToHalfDistancePx =
            FULL_TO_HALF_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0);
        const fullToHalfFastDistancePx = FULL_TO_HALF_FAST_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0);
        const hasFullToHalfHint = isSwipeDownStrong && dragDistancePx >= fullToHalfFastDistancePx;
        const halfToFullFastDistancePx = HALF_TO_FULL_FAST_DISTANCE_PX + (isQuickGesture ? QUICK_GESTURE_EXTRA_DISTANCE_PX : 0);
        const hasFastUpDistance = isSwipeUpStrong && upwardDistancePx >= halfToFullFastDistancePx;
        const hasFastUpVelocity = isSwipeUpStrong && upwardDistancePx >= HALF_TO_FULL_QUICK_VELOCITY_FLOOR_PX_PER_MS * elapsedMs;
        const hasFastUpDistanceByVelocity = isSwipeUpStrong && upwardDistancePx >= HALF_TO_FULL_VELOCITY_FLOOR_PX_PER_MS * elapsedMs;
        const shouldSnapToPeekFromHalf =
            startedAtHalf &&
            dragDistancePx > 0 &&
            dragDistancePx >= HALF_TO_PEEK_DISTANCE_PX;

        if (isSwipeDown) {
            if (startedAtPeek) {
                setSheetHeightSafe(PEEK_SHEET_HEIGHT, true);
                return;
            }

            if (startedAtHalf) {
                setSheetHeightSafe(PEEK_SHEET_HEIGHT, true);
                return;
            }

            setSheetHeightSafe(HALF_SHEET_HEIGHT, true);
            return;
        }

        if (startedAtPeek && (movementPxFromStart > peekToHalfDistancePercent || (hasFastUpDistance && hasFastUpVelocity) || hasFastUpDistanceByVelocity)) {
            setSheetHeightSafe(HALF_SHEET_HEIGHT, true);
            return;
        }

        if (startedAtHalf && (movementPxFromStart < -halfToPeekDistancePercent || shouldSnapToPeekFromHalf)) {
            setSheetHeightSafe(PEEK_SHEET_HEIGHT, true);
            return;
        }

        if (startedAtHalf && (movementPxFromStart > halfToFullDistancePercent || (hasFastUpDistance && hasFastUpVelocity) || hasFastUpDistanceByVelocity)) {
            setSheetHeightSafe(currentMaxHeight, true);
            return;
        }

        if (startedAtFull && (movementPxFromStart < -fullToHalfDistancePercent || (hasFullToHalfHint && dragDistancePx >= fullToHalfDistancePx))) {
            setSheetHeightSafe(HALF_SHEET_HEIGHT, true);
            return;
        }

        if (Math.abs(currentHeight - startHeightRef.current) < 2) {
            setSheetHeightSafe(getNearestSnapHeight(currentHeight), true);
            return;
        }

        setSheetHeightSafe(getNearestSnapHeight(currentHeight), true);
    }, [
        applySnapTransition,
        getCurrentMaxHeight,
        getNearestSnapHeight,
        percentToPx,
        pxToPercent,
        setSheetHeightSafe,
        unlockContentScrollDuringDrag,
    ]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        startSheetDrag(e.touches[0].clientY);
    }, [startSheetDrag]);

    // 마우스 드래그 시작
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startSheetDrag(e.clientY);
    }, [startSheetDrag]);

    // [PERFORMANCE] 드래그 중 공통 로직 - RAF 기반 최적화, 상태 업데이트 최소화
    const handleDragMoveCore = useCallback((currentY: number) => {
        if (!isDraggingRef.current) return;

        const currentTime = performance.now();
        const deltaTime = currentTime - lastTimeRef.current;
        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;
        dragEndYRef.current = currentY;
        dragEndTimeRef.current = currentTime;

        const deltaY = startYRef.current - currentY;
        const vh = viewportHeightRef.current;
        const deltaPercent = (deltaY / vh) * 100;
        const newHeight = startHeightRef.current + deltaPercent;
        setSheetHeightSafe(newHeight);
    }, [setSheetHeightSafe]);

    // 터치 드래그 중
    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        handleDragMoveCore(e.touches[0].clientY);
    }, [handleDragMoveCore]);

    // [PERFORMANCE] 드래그 종료 - 조건부 로직 최적화
    const handleDragEnd = useCallback(() => {
        if (!isDraggingRef.current) return;
        endSheetDrag();
    }, [endSheetDrag]);

    const handleContentTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        contentTouchStartYRef.current = e.touches[0].clientY;
        contentTouchStartXRef.current = e.touches[0].clientX;
        isContentDraggingSheetRef.current = false;
        contentSwipeDirectionRef.current = null;

        // [Fix] 캐러셀 내부 터치는 시트 드래그/스크롤 잠금 건너뛰기
        const target = e.target as HTMLElement;
        isCarouselTouchRef.current = !!target.closest('[aria-roledescription="carousel"]');
        if (isCarouselTouchRef.current) return;

        const detailScrollArea = getDetailScrollArea();
        const top = detailScrollArea ? detailScrollArea.scrollTop : contentRef.current?.scrollTop ?? 0;
        const currentMaxHeight = getCurrentMaxHeight();
        const isAtFull = sheetHeightRef.current >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;
        if (!isAtFull && top <= CONTENT_TOP_EPSILON) {
            lockContentScrollDuringDrag(detailScrollArea);
            return;
        }
        unlockContentScrollDuringDrag();
    }, [getCurrentMaxHeight, getDetailScrollArea, lockContentScrollDuringDrag, unlockContentScrollDuringDrag]);

    const handleContentTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const touch = e.touches[0];
        if (!touch) return;

        // [Fix] 캐러셀 내부 터치는 시트 드래그 시작하지 않음
        if (isCarouselTouchRef.current) return;

        const currentY = touch.clientY;
        const currentX = touch.clientX;
        const deltaY = currentY - contentTouchStartYRef.current;
        const deltaX = currentX - contentTouchStartXRef.current;
        const absDeltaY = Math.abs(deltaY);
        const absDeltaX = Math.abs(deltaX);
        const currentMaxHeight = getCurrentMaxHeight();
        const isAtFull = sheetHeightRef.current >= currentMaxHeight - SHEET_HALF_OPEN_TOLERANCE;
        const verticalDragStartThreshold = isAtFull
            ? CONTENT_FULL_DRAG_START_THRESHOLD
            : CONTENT_DRAG_START_THRESHOLD;
        const verticalIntentRatio = isAtFull
            ? CONTENT_FULL_VERTICAL_INTENT_RATIO
            : CONTENT_VERTICAL_INTENT_RATIO;

        if (!contentSwipeDirectionRef.current) {
            const isHorizontalIntent =
                absDeltaX >= CONTENT_HORIZONTAL_SWIPE_THRESHOLD &&
                absDeltaX >= absDeltaY * CONTENT_HORIZONTAL_INTENT_RATIO;
            if (isHorizontalIntent) {
                contentSwipeDirectionRef.current = 'horizontal';
                unlockContentScrollDuringDrag();
                return;
            }

            if (absDeltaY < verticalDragStartThreshold) return;
            if (absDeltaY < absDeltaX * verticalIntentRatio) return;
            if (!canContentDragFromTouch(deltaY)) return;

            startSheetDrag(contentTouchStartYRef.current);
            lockContentScrollDuringDrag(getDetailScrollArea());
            isContentDraggingSheetRef.current = true;
            contentSwipeDirectionRef.current = 'vertical';
        }

        if (contentSwipeDirectionRef.current === 'horizontal') return;

        e.stopPropagation();
        handleDragMoveCore(currentY);
    }, [
        canContentDragFromTouch,
        getDetailScrollArea,
        handleDragMoveCore,
        lockContentScrollDuringDrag,
        startSheetDrag,
        unlockContentScrollDuringDrag,
        getCurrentMaxHeight,
    ]);

    const handleContentTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isContentDraggingSheetRef.current || contentSwipeDirectionRef.current !== 'vertical') {
            contentSwipeDirectionRef.current = null;
            isContentDraggingSheetRef.current = false;
            unlockContentScrollDuringDrag();
            return;
        }

        e.stopPropagation();
        isContentDraggingSheetRef.current = false;
        contentSwipeDirectionRef.current = null;
        handleDragEnd();
    }, [handleDragEnd, unlockContentScrollDuringDrag]);

    const handleSwipeableRestaurantsChange = useCallback((restaurants: Restaurant[]) => {
        const filteredRestaurants = getRestaurantListByMode(restaurants);

        const uniqueRestaurants: Restaurant[] = [];
        const seenIds = new Set<string>();
        const seenMergeIds = new Set<string>();
        const seenLocationKeys = new Set<string>();
        const seenRestaurantKeys = new Set<string>();

        for (const restaurant of filteredRestaurants) {
            if (!restaurant) continue;

            const normalizedName = (restaurant.name || '').trim().toLowerCase();
            const lat = Number(restaurant.lat);
            const lng = Number(restaurant.lng);
            const hasLatLng = Number.isFinite(lat) && Number.isFinite(lng);
            const locationKey = hasLatLng
                ? `${lat.toFixed(5)}:${lng.toFixed(5)}:${normalizedName}`
                : normalizedName;

            const mergedRestaurants = restaurant.mergedRestaurants ?? [];
            const restaurantIds = [restaurant.id, ...mergedRestaurants.map((merged) => merged.id)].filter(Boolean);

            const isDuplicateById =
                !!restaurantIds.length &&
                restaurantIds.some((id) => seenIds.has(id) || seenMergeIds.has(id));

            if (isDuplicateById) continue;
            if (seenLocationKeys.has(locationKey)) continue;
            if (seenRestaurantKeys.has(restaurant.id)) continue;

            if (restaurant.id) {
                seenIds.add(restaurant.id);
                for (const mergedId of restaurantIds) {
                    if (mergedId) seenMergeIds.add(mergedId);
                }
            }
            seenRestaurantKeys.add(restaurant.id);
            if (locationKey) {
                seenLocationKeys.add(locationKey);
            }
            uniqueRestaurants.push(restaurant);
        }

        pendingSwipeableRestaurantsRef.current = uniqueRestaurants;

        if (swipeableRestaurantsRafRef.current !== 0) {
            return;
        }

        swipeableRestaurantsRafRef.current = requestAnimationFrame(() => {
            swipeableRestaurantsRafRef.current = 0;

            const nextRestaurants = pendingSwipeableRestaurantsRef.current;
            if (!nextRestaurants.length) {
                setSwipeableRestaurantsByMode((prev) =>
                    mapMode === 'domestic'
                        ? (prev.domestic.length === 0 ? prev : { ...prev, domestic: [] })
                        : (prev.overseas.length === 0 ? prev : { ...prev, overseas: [] })
                );
                return;
            }

            setSwipeableRestaurantsByMode(prev => {
                const prevRestaurants = mapMode === 'domestic' ? prev.domestic : prev.overseas;

                if (
                    prevRestaurants.length === nextRestaurants.length &&
                    prevRestaurants.every((restaurant, index) => isSameRestaurantForSwipe(restaurant, nextRestaurants[index]!))
                ) {
                    return prev;
                }

                return mapMode === 'domestic'
                    ? { ...prev, domestic: nextRestaurants }
                    : { ...prev, overseas: nextRestaurants };
            });
        });
    }, [mapMode, getRestaurantListByMode]);

    useEffect(() => () => {
        if (swipeableRestaurantsRafRef.current !== 0) {
            cancelAnimationFrame(swipeableRestaurantsRafRef.current);
            swipeableRestaurantsRafRef.current = 0;
        }
    }, []);

    const handleSwipeToRestaurant = useCallback((step: -1 | 1) => {
        const modeScopedRestaurants = getRestaurantListByMode(activeSwipeableRestaurants);
        if (modeScopedRestaurants.length <= 1) return false;

        const currentRestaurant = panelRestaurant || selectedRestaurant;
        if (!currentRestaurant) return false;

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: modeScopedRestaurants,
            currentRestaurant,
            step,
            isSameRestaurant: isSameRestaurantForSwipe,
        });
        if (!nextRestaurant) return false;

        onRestaurantSelect(nextRestaurant);
        return true;
    }, [activeSwipeableRestaurants, getRestaurantListByMode, onRestaurantSelect, panelRestaurant, selectedRestaurant]);

    const handleMapMarkerClick = useCallback((restaurant: Restaurant) => {
        onMarkerClick(restaurant);
    }, [onMarkerClick]);

    useEffect(() => {
        if (onSwipeableRestaurantsChange) {
            onSwipeableRestaurantsChange(activeSwipeableRestaurants);
        }
    }, [onSwipeableRestaurantsChange, activeSwipeableRestaurants]);

    useEffect(() => {
        if (!isDesktop || !isPanelOpen) return;

        const handleDesktopArrowNavigation = (event: KeyboardEvent) => {
            handleDesktopArrowNavigationEvent({
                event,
                isDesktop,
                isPanelOpen,
                hasCurrentRestaurant: !!(panelRestaurant || selectedRestaurant),
                swipeableCount: activeSwipeableRestaurants.length,
                onNavigate: handleSwipeToRestaurant,
            });
        };

        window.addEventListener('keydown', handleDesktopArrowNavigation);
        return () => {
            window.removeEventListener('keydown', handleDesktopArrowNavigation);
        };
    }, [
        activeSwipeableRestaurants.length,
        handleSwipeToRestaurant,
        isDesktop,
        isPanelOpen,
        panelRestaurant,
        selectedRestaurant,
    ]);

    // Pull-to-Refresh 방지: 바텀시트가 열려있을 때 body에 overscroll-behavior 적용
    useEffect(() => {
        if (isMobileOrTablet && isPanelOpen) {
            document.body.style.overscrollBehavior = 'contain';
            document.documentElement.style.overscrollBehavior = 'contain';
        }
        return () => {
            document.body.style.overscrollBehavior = '';
            document.documentElement.style.overscrollBehavior = '';
        };
    }, [isMobileOrTablet, isPanelOpen]);

    // 드래그 핸들에서 Pull-to-Refresh 방지 및 마우스 이벤트 등록 (passive: false 필요)
    useEffect(() => {
        const handle = handleRef.current;
        if (!handle || !isPanelOpen || !isMobileOrTablet) return;

        const preventPullToRefresh = (e: TouchEvent) => {
            // 핸들 위에서 항상 기본 동작 방지
            if (e.cancelable) {
                e.preventDefault();
            }
        };

        // 마우스 이벤트 핸들러 (window에 등록하여 핸들 밖으로 드래그해도 동작)
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isDraggingRef.current) {
                e.preventDefault();
                handleDragMoveCore(e.clientY);
            }
        };

        const handleWindowMouseUp = () => {
            if (isDraggingRef.current) {
                handleDragEnd();
            }
        };

        handle.addEventListener('touchmove', preventPullToRefresh, { passive: false });
        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);

        return () => {
            handle.removeEventListener('touchmove', preventPullToRefresh);
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isPanelOpen, isMobileOrTablet, handleDragMoveCore, handleDragEnd]);

    // 콘텐츠 영역: 드래그 중 터치 스크롤 방지 (non-passive 리스너)
    useEffect(() => {
        const content = contentRef.current;
        if (!content || !isPanelOpen || !isMobileOrTablet) return;

        const preventContentScrollWhileDragging = (e: TouchEvent) => {
            if (isDraggingRef.current || isContentDraggingSheetRef.current) {
                if (e.cancelable) {
                    e.preventDefault();
                }
            }
        };

        content.addEventListener('touchmove', preventContentScrollWhileDragging, { passive: false });
        return () => {
            content.removeEventListener('touchmove', preventContentScrollWhileDragging);
        };
    }, [isPanelOpen, isMobileOrTablet]);

    // [PERFORMANCE] 메모이제이션된 핸들러 - 자식 컴포넌트 리렌더링 방지
    const handleAdminEditRestaurant = useCallback(() => {
        if (onAdminEditRestaurant && panelRestaurant) {
            onAdminEditRestaurant(panelRestaurant);
        }
    }, [onAdminEditRestaurant, panelRestaurant]);

    const handleRequestEditRestaurant = useCallback(() => {
        if (panelRestaurant) {
            onRequestEditRestaurant(panelRestaurant);
        }
    }, [onRequestEditRestaurant, panelRestaurant]);

    const handleOpenDirectionSheet = useCallback(() => {
        if (!isMobileOrTablet || !isPanelOpen) return;

        const currentMaxHeight = getCurrentMaxHeight();
        const targetHeight = Math.min(
            currentMaxHeight,
            Math.max(sheetHeightRef.current, HALF_SHEET_HEIGHT)
        );

        if (targetHeight > sheetHeightRef.current + DRAG_RENDER_EPSILON_PERCENT) {
            setSheetHeightSafe(targetHeight, true);
        }
    }, [getCurrentMaxHeight, isMobileOrTablet, isPanelOpen, setSheetHeightSafe]);

    const handleReleaseSearchSelectionOwnership = useCallback(() => {
        onReleaseSearchSelectionOwnership?.();

        if (!isMobileOrTablet || !isPanelOpen) {
            return;
        }

        setSheetHeightSafe(PEEK_SHEET_HEIGHT, true);
    }, [isMobileOrTablet, isPanelOpen, onReleaseSearchSelectionOwnership, setSheetHeightSafe]);

    const mapPadding = useMemo(() => {
        if (!isPanelOpen) return undefined;
        // Desktop: Right panel 400px
        if (isDesktop) return { top: 0, bottom: 0, left: 0, right: 400 };
        // Mobile: 바텀시트 높이만큼 bottom padding을 동적으로 적용하여
        // 남은 지도 영역의 중앙에 마커가 오도록 보정
        const clampedSheetHeight = Math.max(0, Math.min(100, sheetHeight));
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        return { top: 0, bottom: vh * (clampedSheetHeight / 100), left: 0, right: 0 };
    }, [isPanelOpen, isDesktop, sheetHeight]);
    const isSheetAtFullHeight = sheetHeight >= getCurrentMaxHeight() - SHEET_HALF_OPEN_TOLERANCE;

    return (
        <div className="relative w-full h-full">
            {mapMode === 'domestic' ? (
                <Suspense fallback={<MapSkeleton />}>
                    <NaverMapView
                        mapFocusZoom={mapFocusZoom} // [New] 줌 레벨 전달
                        filters={filters}
                        selectedRegion={selectedRegion}
                        searchedRestaurant={searchedRestaurant}
                        selectedRestaurant={selectedRestaurant}
                        refreshTrigger={refreshTrigger}
                        onAdminEditRestaurant={onAdminEditRestaurant}
                        onRequestEditRestaurant={onRequestEditRestaurant}
                        onRestaurantSelect={onRestaurantSelect}
                        activePanel={activePanel}
                        onPanelClick={onPanelClick}
                        onMarkerClick={handleMapMarkerClick}
                        externalPanelOpen={externalPanelOpen}
                        isPanelCollapsed={isPanelCollapsed}
                        isPanelOpen={isPanelOpen}
                        mobileSheetHeightPercent={isMobileOrTablet && isPanelOpen ? sheetHeight : 0}
                        onVisibleRestaurantsChange={handleSwipeableRestaurantsChange}
                        onSearchSelectionRelease={handleReleaseSearchSelectionOwnership}
                    />
                </Suspense>
            ) : (
                <Suspense fallback={<MapSkeleton />}>
                    <OverseasMap
                        mapFocusZoom={mapFocusZoom} // [New] 줌 레벨 전달
                        filters={filters}
                        selectedCountry={selectedCountry}
                        searchedRestaurant={searchedRestaurant}
                        selectedRestaurant={selectedRestaurant}
                        refreshTrigger={refreshTrigger}
                        onAdminEditRestaurant={onAdminEditRestaurant}
                        onRestaurantSelect={onRestaurantSelect}
                        onRequestEditRestaurant={onRequestEditRestaurant}
                        onMapReady={onMapReady}
                        onMarkerClick={handleMapMarkerClick}
                        mapPadding={mapPadding}
                        onVisibleRestaurantsChange={handleSwipeableRestaurantsChange}
                    />
                </Suspense>
            )}

            {/* [CSR] 맛집 상세 패널 - 데스크탑: 사이드 패널, 모바일/태블릿: 바텀시트 */}
            {panelRestaurant && (
                <>
                    {/* 데스크탑 오버레이 패널 */}
                    {isDesktop && (
                        <>
                            {/* 상세 패널 */}
                            <div
                                className={cn(
                                    "fixed right-0 w-[min(400px,calc(100vw-1rem))] z-[95]",
                                    "bg-background border-l border-border shadow-2xl",
                                    "transform transition-transform duration-300 ease-out",
                                    isPanelOpen ? "translate-x-0" : "translate-x-full"
                                )}
                                style={{
                                    top: `var(${APP_HEADER_HEIGHT_VAR}, 56px)`,
                                    height: `calc(100vh - var(${APP_HEADER_HEIGHT_VAR}, 56px))`,
                                    overflow: 'visible',
                                }}
                            >
                                {/* 접기 버튼 */}
                                <button
                                    onClick={onPanelClose}
                                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                                    title="패널 닫기"
                                    aria-label="패널 닫기"
                                >
                                    <svg className="h-4 w-4 text-muted-foreground group-hover:text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                                <Suspense fallback={null}>
                                    <RestaurantDetailPanel
                                        restaurant={panelRestaurant}
                                        onClose={onPanelClose}
                                        onWriteReview={onReviewModalOpen}
                                        onEditRestaurant={onAdminEditRestaurant ? handleAdminEditRestaurant : undefined}
                                        onRequestEditRestaurant={handleRequestEditRestaurant}
                                        onOpenDirectionSheet={handleOpenDirectionSheet}
                                        onToggleCollapse={onTogglePanelCollapse}
                                        isPanelOpen={isPanelOpen}
                                    />
                                </Suspense>
                            </div>
                        </>
                    )}

                    {/* 모바일/태블릿 바텀시트 */}
                    {isMobileOrTablet && isPanelOpen && (
                        <div className="fixed inset-0 z-[80] pointer-events-none">
                            <div
                                ref={sheetContainerRef}
                                className={cn(
                                    'fixed bottom-0 left-0 right-0 z-[80] pointer-events-auto',
                                    'bg-background shadow-xl',
                                    isSheetAtFullHeight ? 'rounded-none' : 'rounded-t-2xl',
                                    'overflow-hidden flex flex-col',
                                    isDragging ? '' : 'transition-[height,border-radius]',
                                    'pb-[env(safe-area-inset-bottom)]'
                                )}
                                data-sheet-state={isSheetAtFullHeight ? 'full' : 'partial'}
                                style={{
                                    [`${SHEET_HEIGHT_CSS_VAR}`]: `${viewportHeightRef.current * sheetHeight / 100}px`,
                                    height: `var(${SHEET_HEIGHT_CSS_VAR})`,
                                    maxHeight: '100%',
                                    willChange: isDragging ? 'height' : undefined,
                                    transitionDuration: isDragging ? '0ms' : `${sheetSnapTransition.duration}ms`,
                                    transitionTimingFunction: isDragging ? undefined : sheetSnapTransition.easing,
                                } as unknown as Record<string, string | number | undefined>}
                            >
                                {!isSheetAtFullHeight && (
                                    <>
                                        <div
                                            ref={handleRef}
                                            role="button"
                                            tabIndex={0}
                                            className="sticky top-0 z-20 flex w-full justify-center py-1 bg-transparent cursor-grab active:cursor-grabbing select-none"
                                            style={{
                                                touchAction: 'none',
                                                WebkitTapHighlightColor: 'transparent',
                                                backgroundColor: 'transparent',
                                            }}
                                            onTouchStart={handleTouchStart}
                                            onTouchMove={handleTouchMove}
                                            onTouchEnd={() => handleDragEnd()}
                                            onTouchCancel={() => handleDragEnd()}
                                            onMouseDown={handleMouseDown}
                                            aria-label="상세 패널 높이 조절"
                                        >
                                            <div className="w-8 h-1 bg-muted-foreground/40 rounded-full" />
                                        </div>
                                    </>
                                )}

                                {/* 상세 패널 콘텐츠 */}
                                <div
                                    ref={contentRef}
                                    className="flex-1 overflow-hidden"
                                    style={{
                                        touchAction: isDragging
                                            ? 'none'
                                            : (sheetHeight <= PEEK_SHEET_HEIGHT + SHEET_HALF_OPEN_TOLERANCE ? 'none' : 'pan-y'),
                                        overflowY: isDragging ? 'hidden' : undefined,
                                    }}
                                    onTouchStart={handleContentTouchStart}
                                    onTouchMove={handleContentTouchMove}
                                    onTouchEnd={handleContentTouchEnd}
                                    onTouchCancel={handleContentTouchEnd}
                                >
                                    <Suspense fallback={null}>
                                        <RestaurantDetailPanel
                                            restaurant={panelRestaurant}
                                            onClose={onPanelClose}
                                            onWriteReview={onReviewModalOpen}
                                            onEditRestaurant={onAdminEditRestaurant ? handleAdminEditRestaurant : undefined}
                                            onRequestEditRestaurant={handleRequestEditRestaurant}
                                            onOpenDirectionSheet={handleOpenDirectionSheet}
                                            onSwipeLeft={() => handleSwipeToRestaurant(1)}
                                            onSwipeRight={() => handleSwipeToRestaurant(-1)}
                                            onToggleCollapse={onTogglePanelCollapse}
                                            isPanelOpen={isPanelOpen}
                                            isMobile={true}
                                        />
                                    </Suspense>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// React.memo로 래핑하여 성능 최적화
const HomeMapContainer = memo(HomeMapContainerComponent);
HomeMapContainer.displayName = 'HomeMapContainer';

export default HomeMapContainer;
