'use client';

import { Suspense, lazy, useState, useCallback, memo, useRef, useEffect, useMemo } from 'react';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

// [CSR] 지도 컴포넌트 지연 로딩 - 번들 사이즈 최적화
const NaverMapView = lazy(() => import("@/components/map/NaverMapView"));
const MapView = lazy(() => import("@/components/map/MapView"));
const OverseasMap = lazy(() => import("@/components/map/OverseasMap"));

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
const INITIAL_HEIGHT = 65;
const HEADER_OFFSET = 80; // 헤더(64px) + 여유(16px)
const MIN_DRAG_HEIGHT = 5;
const MIN_SHEET_HEIGHT = 20;
const CLOSE_THRESHOLD = 15;
const SWIPE_VELOCITY_THRESHOLD = 0.5;
const CONTENT_TOP_EPSILON = 2;
const CONTENT_DRAG_START_THRESHOLD = 16;
const CONTENT_VERTICAL_INTENT_RATIO = 1.2;
const HORIZONTAL_SWIPE_THRESHOLD = 24;
const HORIZONTAL_SWIPE_INTENT_RATIO = 1.0;
const HORIZONTAL_SWIPE_FALLBACK_RATIO = 0.9;

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

const isVerticallyScrollable = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    return allowsScroll && element.scrollHeight > element.clientHeight;
};

const findScrollableTouchTarget = (
    target: EventTarget | null,
    boundary: HTMLElement | null
): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return boundary;

    let node: HTMLElement | null = target;
    while (node && node !== boundary) {
        if (isVerticallyScrollable(node)) return node;
        node = node.parentElement;
    }

    if (boundary && isVerticallyScrollable(boundary)) return boundary;
    return null;
};

const isDetailSwipeArea = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-restaurant-detail-swipe-area="content"]') !== null;

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
    const handleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const rafIdRef = useRef<number>(0);
    const contentTouchStartYRef = useRef(0);
    const contentTouchStartXRef = useRef(0);
    const isContentDraggingSheetRef = useRef(false);
    const contentStartBoundaryRef = useRef<'top' | null>(null);
    const contentScrollTargetRef = useRef<HTMLElement | null>(null);
    const contentSwipeDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);

    // [PERFORMANCE] 렌더링에 필요한 상태만 useState로 관리
    const [sheetHeight, setSheetHeight] = useState(INITIAL_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [swipeableRestaurants, setSwipeableRestaurants] = useState<Restaurant[]>([]);

    const getCurrentMaxHeight = useCallback((vh: number = viewportHeightRef.current) => {
        return ((vh - HEADER_OFFSET) / vh) * 100;
    }, []);

    const getContentSnapPoints = useCallback(() => {
        const minSnap = MIN_SHEET_HEIGHT;
        const maxSnap = Math.max(minSnap, getCurrentMaxHeight());
        const midSnap = minSnap + ((maxSnap - minSnap) / 2);
        return [minSnap, midSnap, maxSnap];
    }, [getCurrentMaxHeight]);

    const getNearestSnapHeight = useCallback((currentHeight: number) => {
        const snapPoints = getContentSnapPoints();
        return snapPoints.reduce((closest, snap) =>
            Math.abs(snap - currentHeight) < Math.abs(closest - currentHeight) ? snap : closest
        , snapPoints[0]);
    }, [getContentSnapPoints]);

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
                    // maxHeight 초과 시에만 조정
                    setSheetHeight(prev => Math.min(prev, getCurrentMaxHeight(viewport.height)));
                }
                throttleTimer = null;
            });
        };

        viewport.addEventListener('resize', handleResize, { passive: true });
        return () => {
            viewport.removeEventListener('resize', handleResize);
            if (throttleTimer !== null) cancelAnimationFrame(throttleTimer);
        };
    }, [getCurrentMaxHeight]);

    // 패널이 열릴 때 최대 높이로 열기 (헤더 배제)
    useEffect(() => {
        if (isPanelOpen && isMobileOrTablet) {
            setSheetHeight(getCurrentMaxHeight()); // 최대 높이로 열기
        }
    }, [isPanelOpen, isMobileOrTablet, getCurrentMaxHeight]);

    useEffect(() => {
        if (!isPanelOpen || !isMobileOrTablet || !contentRef.current) return;

        contentRef.current.scrollTop = 0;
        const detailScrollArea = contentRef.current.querySelector<HTMLElement>(
            "[data-restaurant-detail-swipe-area='content']"
        );
        if (detailScrollArea) {
            detailScrollArea.scrollTop = 0;
        }
    }, [isPanelOpen, isMobileOrTablet, panelRestaurant?.id]);

    // [PERFORMANCE] 드래그 시작 공통 로직
    const handleDragStartCore = useCallback((clientY: number) => {
        // Ref로 상태 저장 (리렌더링 없음)
        isDraggingRef.current = true;
        startYRef.current = clientY;
        startHeightRef.current = sheetHeight;
        lastYRef.current = clientY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;

        // 시각적 피드백을 위한 최소한의 상태 업데이트
        setIsDragging(true);
    }, [sheetHeight]);

    // 터치 드래그 시작
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        handleDragStartCore(e.touches[0].clientY);
    }, [handleDragStartCore]);

    // 마우스 드래그 시작
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        handleDragStartCore(e.clientY);
    }, [handleDragStartCore]);

    // [PERFORMANCE] 드래그 중 공통 로직 - RAF 기반 최적화, 상태 업데이트 최소화
    const handleDragMoveCore = useCallback((currentY: number) => {
        if (!isDraggingRef.current) return;

        const currentTime = Date.now();

        // 속도 계산
        const deltaTime = currentTime - lastTimeRef.current;
        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;

        // [PERFORMANCE] 이전 RAF 취소하여 프레임 스키핑 방지
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
            const deltaY = startYRef.current - currentY;
            const vh = viewportHeightRef.current;
            const deltaPercent = (deltaY / vh) * 100;
            const maxHeight = getCurrentMaxHeight(vh);

            let newHeight = startHeightRef.current + deltaPercent;
            newHeight = Math.max(MIN_DRAG_HEIGHT, Math.min(maxHeight, newHeight));

            setSheetHeight(newHeight);
        });
    }, [getCurrentMaxHeight]);

    // 터치 드래그 중
    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        handleDragMoveCore(e.touches[0].clientY);
    }, [handleDragMoveCore]);

    // [PERFORMANCE] 드래그 종료 - 조건부 로직 최적화
    const handleDragEnd = useCallback((source: 'handle' | 'content' = 'handle') => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // RAF 정리
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
        }

        // 빠른 스와이프로 닫기
        if (source === 'handle' && velocityRef.current > SWIPE_VELOCITY_THRESHOLD) {
            onPanelClose();
            return;
        }

        // 현재 높이 기반 판단 (클로저 문제 회피를 위해 직접 접근)
        setSheetHeight(currentHeight => {
            if (source === 'content') {
                return getNearestSnapHeight(currentHeight);
            }
            if (currentHeight <= CLOSE_THRESHOLD) {
                // 비동기로 닫기 처리 (상태 업데이트 후)
                queueMicrotask(onPanelClose);
                return currentHeight;
            }
            // 최소 높이 보정
            return currentHeight < MIN_SHEET_HEIGHT ? MIN_SHEET_HEIGHT : currentHeight;
        });
    }, [onPanelClose, getNearestSnapHeight]);

    const handleContentTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        contentTouchStartYRef.current = e.touches[0].clientY;
        contentTouchStartXRef.current = e.touches[0].clientX;
        isContentDraggingSheetRef.current = false;
        contentSwipeDirectionRef.current = null;
        const scrollTarget = findScrollableTouchTarget(e.target, e.currentTarget);
        contentScrollTargetRef.current = scrollTarget;
        const scrollTop = scrollTarget ? scrollTarget.scrollTop : e.currentTarget.scrollTop;
        const isAtTop = scrollTop <= CONTENT_TOP_EPSILON;
        contentStartBoundaryRef.current = isAtTop ? 'top' : null;
    }, []);

    const handleContentTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const isDetailArea = isDetailSwipeArea(e.target);

        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = currentY - contentTouchStartYRef.current;
        const deltaX = currentX - contentTouchStartXRef.current;
        const absDeltaY = Math.abs(deltaY);
        const absDeltaX = Math.abs(deltaX);
        const scrollTarget = contentScrollTargetRef.current ?? findScrollableTouchTarget(e.target, e.currentTarget);
        if (!contentScrollTargetRef.current) {
            contentScrollTargetRef.current = scrollTarget;
        }

        if (!contentSwipeDirectionRef.current) {
            if (
                swipeableRestaurants.length > 1 &&
                !isDetailArea &&
                absDeltaX >= HORIZONTAL_SWIPE_THRESHOLD &&
                absDeltaX >= absDeltaY * HORIZONTAL_SWIPE_INTENT_RATIO
            ) {
                contentSwipeDirectionRef.current = 'horizontal';
                return;
            }

            if (contentStartBoundaryRef.current !== 'top') return;
            if (absDeltaY <= CONTENT_DRAG_START_THRESHOLD) return;
            if (absDeltaY <= absDeltaX * CONTENT_VERTICAL_INTENT_RATIO) return;
            handleDragStartCore(contentTouchStartYRef.current);
            isContentDraggingSheetRef.current = true;
            contentSwipeDirectionRef.current = 'vertical';
        }

        if (contentSwipeDirectionRef.current === 'horizontal') {
            return;
        }

        e.stopPropagation();
        handleDragMoveCore(currentY);
    }, [handleDragMoveCore, handleDragStartCore, swipeableRestaurants.length]);

    const handleContentTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const isDetailArea = isDetailSwipeArea(e.target);

        const currentTouch = e.changedTouches?.[0] ?? e.touches?.[0];

        if (!currentTouch) {
            contentScrollTargetRef.current = null;
            contentStartBoundaryRef.current = null;
            contentSwipeDirectionRef.current = null;
            return;
        }

        const deltaX = currentTouch.clientX - contentTouchStartXRef.current;
        const deltaY = currentTouch.clientY - contentTouchStartYRef.current;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        const canSwipeHorizontal =
            swipeableRestaurants.length > 1 &&
            (absDeltaX >= HORIZONTAL_SWIPE_THRESHOLD && absDeltaX >= absDeltaY * HORIZONTAL_SWIPE_INTENT_RATIO);
        const canSwipeFallback =
            swipeableRestaurants.length > 1 &&
            (absDeltaX >= HORIZONTAL_SWIPE_THRESHOLD && absDeltaX >= absDeltaY * HORIZONTAL_SWIPE_FALLBACK_RATIO);

        if (!isDetailArea && (contentSwipeDirectionRef.current === 'horizontal' || contentSwipeDirectionRef.current === null) &&
            (canSwipeHorizontal || canSwipeFallback) &&
            (deltaX !== 0)) {
            const direction = deltaX < 0 ? 1 : -1;
            const currentRestaurant = panelRestaurant || selectedRestaurant;
            if (currentRestaurant) {
                const currentIndex = swipeableRestaurants.findIndex((restaurant) =>
                    isSameRestaurantForSwipe(restaurant, currentRestaurant)
                );

                if (currentIndex >= 0) {
                    const nextIndex = currentIndex + direction;
                    const nextRestaurant = swipeableRestaurants[nextIndex];
                    if (nextRestaurant) {
                        onRestaurantSelect(nextRestaurant);
                    }
                }
            }
        }

        if (!isContentDraggingSheetRef.current || contentSwipeDirectionRef.current !== 'vertical') {
            contentScrollTargetRef.current = null;
            contentStartBoundaryRef.current = null;
            contentSwipeDirectionRef.current = null;
            return;
        }

        e.stopPropagation();
        isContentDraggingSheetRef.current = false;
        contentScrollTargetRef.current = null;
        contentStartBoundaryRef.current = null;
        contentSwipeDirectionRef.current = null;
        handleDragEnd('content');
    }, [contentSwipeDirectionRef, onRestaurantSelect, panelRestaurant, selectedRestaurant, swipeableRestaurants, handleDragEnd]);

    const handleSwipeableRestaurantsChange = useCallback((restaurants: Restaurant[]) => {
        if (!restaurants.length) {
            setSwipeableRestaurants([]);
            return;
        }

        const uniqueRestaurants: Restaurant[] = [];
        restaurants.forEach((restaurant) => {
            const isDuplicate = uniqueRestaurants.some((existingRestaurant) =>
                isSameRestaurantForSwipe(existingRestaurant, restaurant)
            );

            if (!isDuplicate) {
                uniqueRestaurants.push(restaurant);
            }
        });

        setSwipeableRestaurants(prev => {
            if (
                prev.length === uniqueRestaurants.length &&
                prev.every((restaurant, index) => isSameRestaurantForSwipe(restaurant, uniqueRestaurants[index]!))
            ) {
                return prev;
            }

            return uniqueRestaurants;
        });
    }, []);

    const handleSwipeToRestaurant = useCallback((step: -1 | 1) => {
        if (swipeableRestaurants.length <= 1) return;

        const currentRestaurant = panelRestaurant || selectedRestaurant;
        if (!currentRestaurant) return;

        const currentIndex = swipeableRestaurants.findIndex((restaurant) =>
            isSameRestaurantForSwipe(restaurant, currentRestaurant)
        );
        if (currentIndex < 0) return;

        const nextIndex = currentIndex + step;
        const nextRestaurant = swipeableRestaurants[nextIndex];
        if (!nextRestaurant) return;

        onRestaurantSelect(nextRestaurant);
    }, [onRestaurantSelect, panelRestaurant, selectedRestaurant, swipeableRestaurants]);

    useEffect(() => {
        if (onSwipeableRestaurantsChange) {
            onSwipeableRestaurantsChange(swipeableRestaurants);
        }
    }, [onSwipeableRestaurantsChange, swipeableRestaurants]);

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
            e.preventDefault();
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

    const mapPadding = useMemo(() => {
        if (!isPanelOpen) return undefined;
        // Desktop: Right panel 400px
        if (isDesktop) return { top: 0, bottom: 0, left: 0, right: 400 };
        // Mobile: Bottom sheet covers ~65%. Center in top area.
        // Using a moderate value (e.g., 50% of viewport) ensures marker is visible.
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        return { top: 0, bottom: vh * 0.45, left: 0, right: 0 };
    }, [isPanelOpen, isDesktop]);

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
                        onMarkerClick={onMarkerClick}
                        externalPanelOpen={externalPanelOpen}
                        isPanelCollapsed={isPanelCollapsed}
                        isPanelOpen={isPanelOpen}
                        onVisibleRestaurantsChange={handleSwipeableRestaurantsChange}
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
                        onMarkerClick={onMarkerClick}
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
                                    "fixed top-16 right-0 h-[calc(100vh-64px)] w-[min(400px,calc(100vw-1rem))] z-[95]",
                                    "bg-background border-l border-border shadow-2xl",
                                    "transform transition-transform duration-300 ease-out",
                                    isPanelOpen ? "translate-x-0" : "translate-x-full"
                                )}
                                style={{ overflow: 'visible' }}
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
                                <RestaurantDetailPanel
                                    restaurant={panelRestaurant}
                                    onClose={onPanelClose}
                                    onWriteReview={onReviewModalOpen}
                                    onEditRestaurant={onAdminEditRestaurant ? handleAdminEditRestaurant : undefined}
                                    onRequestEditRestaurant={handleRequestEditRestaurant}
                                    onToggleCollapse={onTogglePanelCollapse}
                                    isPanelOpen={isPanelOpen}
                                />
                            </div>
                        </>
                    )}


                    {/* 모바일/태블릿 바텀시트 */}
                    {isMobileOrTablet && isPanelOpen && (
                        <div
                            className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200"
                            onClick={onPanelClose}
                        >
                            <div
                                className={cn(
                                    'fixed bottom-0 left-0 right-0 z-50',
                                    'bg-background rounded-t-2xl shadow-xl',
                                    'overflow-hidden flex flex-col',
                                    // 드래그 중에는 트랜지션 제거, 종료 시 부드러운 스프링 효과
                                    isDragging ? '' : 'transition-[height] duration-300',
                                    // iOS safe area 지원 + 하단 네비게이션바 공간
                                    'pb-[calc(env(safe-area-inset-bottom)+64px)]'
                                )}
                                style={{
                                    // [FIX] Safari/삼성 인터넷 100vh 버그 수정
                                    // bottom: 0 고정 + height(px)로 직접 계산
                                    // viewportHeightRef 사용 (visualViewport API 기반)
                                    height: `${viewportHeightRef.current * sheetHeight / 100}px`,
                                    // 최소 상단 위치 강제 (헤더 80px 아래)
                                    maxHeight: `calc(100% - 80px)`,
                                    willChange: 'height',
                                    // 커스텀 이징 함수
                                    transitionTimingFunction: isDragging ? undefined : 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* 핸들 바 - 드래그 가능, 항상 상단 고정, touch-action: none으로 Pull-to-Refresh 방지 */}
                                <div
                                    ref={handleRef}
                                    className="sticky top-0 z-20 flex justify-center py-4 bg-background cursor-grab active:cursor-grabbing select-none"
                                    style={{ touchAction: 'none' }}
                                    onTouchStart={handleTouchStart}
                                    onTouchMove={handleTouchMove}
                                    onTouchEnd={() => handleDragEnd('handle')}
                                    onTouchCancel={() => handleDragEnd('handle')}
                                    onMouseDown={handleMouseDown}
                                >
                                    <div className="w-12 h-1.5 bg-muted-foreground/40 rounded-full" />
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onPanelClose}
                                    className="absolute right-2 top-2 z-30"
                                >
                                    <X className="h-5 w-5" />
                                </Button>

                                {/* 상세 패널 콘텐츠 */}
                                <div
                                    ref={contentRef}
                                    className="flex-1 overflow-hidden"
                                    style={{ touchAction: 'pan-y' }}
                                    onTouchStart={handleContentTouchStart}
                                    onTouchMove={handleContentTouchMove}
                                    onTouchEnd={handleContentTouchEnd}
                                    onTouchCancel={handleContentTouchEnd}
                                >
                                    <RestaurantDetailPanel
                                        restaurant={panelRestaurant}
                                        onClose={onPanelClose}
                                        onWriteReview={onReviewModalOpen}
                                        onEditRestaurant={onAdminEditRestaurant ? handleAdminEditRestaurant : undefined}
                                        onRequestEditRestaurant={handleRequestEditRestaurant}
                                        onSwipeLeft={() => handleSwipeToRestaurant(1)}
                                        onSwipeRight={() => handleSwipeToRestaurant(-1)}
                                        onToggleCollapse={onTogglePanelCollapse}
                                        isPanelOpen={isPanelOpen}
                                        isMobile={true}
                                    />
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
