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

interface HomeMapContainerProps {
    mapMode: 'domestic' | 'overseas';
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
}

// [CSR] 지도 렌더링 및 그리드/단일 모드 처리 - 브라우저 전용 지도 라이브러리 사용
function HomeMapContainerComponent({
    mapMode,
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
}: HomeMapContainerProps) {
    const { isMobileOrTablet, isDesktop } = useDeviceType();

    // ========== [PERFORMANCE] 상수 및 Ref 기반 상태 관리 ==========
    const INITIAL_HEIGHT = 65;
    const HEADER_OFFSET = 80; // 헤더(64px) + 여유(16px)
    const MIN_DRAG_HEIGHT = 5;
    const MIN_SHEET_HEIGHT = 20;
    const CLOSE_THRESHOLD = 15;
    const SWIPE_VELOCITY_THRESHOLD = 0.5;

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
    const rafIdRef = useRef<number>(0);

    // [PERFORMANCE] 렌더링에 필요한 상태만 useState로 관리
    const [sheetHeight, setSheetHeight] = useState(INITIAL_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);

    // [PERFORMANCE] 최대 높이 계산 - useMemo로 캐싱
    const maxHeightPercent = useMemo(() => {
        const vh = viewportHeightRef.current;
        return ((vh - HEADER_OFFSET) / vh) * 100;
    }, [sheetHeight]); // sheetHeight 변경 시에만 재계산 (실제 필요 시)

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
                    const maxHeight = ((viewport.height - HEADER_OFFSET) / viewport.height) * 100;
                    setSheetHeight(prev => Math.min(prev, maxHeight));
                }
                throttleTimer = null;
            });
        };

        viewport.addEventListener('resize', handleResize, { passive: true });
        return () => {
            viewport.removeEventListener('resize', handleResize);
            if (throttleTimer !== null) cancelAnimationFrame(throttleTimer);
        };
    }, []);

    // 패널이 열릴 때마다 안전한 초기 높이로 리셋
    useEffect(() => {
        if (isPanelOpen && isMobileOrTablet) {
            const vh = viewportHeightRef.current;
            const maxHeight = ((vh - HEADER_OFFSET) / vh) * 100;
            setSheetHeight(Math.min(INITIAL_HEIGHT, maxHeight));
        }
    }, [isPanelOpen, isMobileOrTablet]);

    // [PERFORMANCE] 드래그 시작 - Ref 기반으로 리렌더링 최소화
    const handleDragStart = useCallback((e: React.TouchEvent) => {
        const touchY = e.touches[0].clientY;

        // Ref로 상태 저장 (리렌더링 없음)
        isDraggingRef.current = true;
        startYRef.current = touchY;
        startHeightRef.current = sheetHeight;
        lastYRef.current = touchY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;

        // 시각적 피드백을 위한 최소한의 상태 업데이트
        setIsDragging(true);
    }, [sheetHeight]);

    // [PERFORMANCE] 드래그 중 - RAF 기반 최적화, 상태 업데이트 최소화
    const handleDragMove = useCallback((e: React.TouchEvent) => {
        if (!isDraggingRef.current) return;

        const currentY = e.touches[0].clientY;
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
            const maxHeight = ((vh - HEADER_OFFSET) / vh) * 100;

            let newHeight = startHeightRef.current + deltaPercent;
            newHeight = Math.max(MIN_DRAG_HEIGHT, Math.min(maxHeight, newHeight));

            setSheetHeight(newHeight);
        });
    }, []);

    // [PERFORMANCE] 드래그 종료 - 조건부 로직 최적화
    const handleDragEnd = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // RAF 정리
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
        }

        // 빠른 스와이프로 닫기
        if (velocityRef.current > SWIPE_VELOCITY_THRESHOLD) {
            onPanelClose();
            return;
        }

        // 현재 높이 기반 판단 (클로저 문제 회피를 위해 직접 접근)
        setSheetHeight(currentHeight => {
            if (currentHeight <= CLOSE_THRESHOLD) {
                // 비동기로 닫기 처리 (상태 업데이트 후)
                queueMicrotask(onPanelClose);
                return currentHeight;
            }
            // 최소 높이 보정
            return currentHeight < MIN_SHEET_HEIGHT ? MIN_SHEET_HEIGHT : currentHeight;
        });
    }, [onPanelClose]);

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

    // 드래그 핸들에서 Pull-to-Refresh 방지 (passive: false 필요)
    useEffect(() => {
        const handle = handleRef.current;
        if (!handle || !isPanelOpen || !isMobileOrTablet) return;

        const preventPullToRefresh = (e: TouchEvent) => {
            // 핸들 위에서 항상 기본 동작 방지
            e.preventDefault();
        };

        handle.addEventListener('touchmove', preventPullToRefresh, { passive: false });

        return () => {
            handle.removeEventListener('touchmove', preventPullToRefresh);
        };
    }, [isPanelOpen, isMobileOrTablet]);

    return (
        <div className="relative w-full h-full">
            {mapMode === 'domestic' ? (
                <NaverMapView
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
                />
            ) : (
                <Suspense fallback={<MapSkeleton />}>
                    <MapView
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
                    />
                </Suspense>
            )}

            {/* [CSR] 맛집 상세 패널 - 데스크탑: 사이드 패널, 모바일/태블릿: 바텀시트 */}
            {panelRestaurant && (
                <>
                    {/* 데스크탑 사이드 패널 */}
                    {isDesktop && (
                        <div
                            className={`absolute top-0 right-0 h-full z-20 shadow-xl bg-background transition-all duration-300 ease-in-out ${isPanelOpen ? 'w-[400px]' : 'w-0'}`}
                            style={{ overflow: 'visible' }}
                        >
                            <div className="h-full w-[400px] bg-background border-l border-border">
                                <RestaurantDetailPanel
                                    restaurant={panelRestaurant}
                                    onClose={onPanelClose}
                                    onWriteReview={onReviewModalOpen}
                                    onEditRestaurant={onAdminEditRestaurant ? () => {
                                        onAdminEditRestaurant(panelRestaurant);
                                    } : undefined}
                                    onRequestEditRestaurant={() => {
                                        onRequestEditRestaurant(panelRestaurant);
                                    }}
                                    onToggleCollapse={onTogglePanelCollapse}
                                    isPanelOpen={isPanelOpen}
                                />
                            </div>
                        </div>
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
                                    'pb-[calc(env(safe-area-inset-bottom)+56px)]'
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
                                    className="sticky top-0 z-20 flex justify-center py-4 bg-background cursor-grab active:cursor-grabbing"
                                    style={{ touchAction: 'none' }}
                                    onTouchStart={handleDragStart}
                                    onTouchMove={handleDragMove}
                                    onTouchEnd={handleDragEnd}
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
                                <div className="flex-1 overflow-y-auto">
                                    <RestaurantDetailPanel
                                        restaurant={panelRestaurant}
                                        onClose={onPanelClose}
                                        onWriteReview={onReviewModalOpen}
                                        onEditRestaurant={onAdminEditRestaurant ? () => {
                                            onAdminEditRestaurant(panelRestaurant);
                                        } : undefined}
                                        onRequestEditRestaurant={() => {
                                            onRequestEditRestaurant(panelRestaurant);
                                        }}
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
