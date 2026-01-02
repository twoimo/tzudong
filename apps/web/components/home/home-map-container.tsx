'use client';

import { Suspense, lazy, useState, useCallback, memo, useRef, useEffect } from 'react';
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

    // 최대 높이 계산 헬퍼 (헤더 80px 고려)
    const getMaxHeightPercent = useCallback(() => {
        if (typeof window === 'undefined') return 85;
        const viewportHeight = window.innerHeight;
        const headerOffset = 80; // 헤더(64px) + 여유(16px)
        return ((viewportHeight - headerOffset) / viewportHeight) * 100;
    }, []);

    // 안전한 초기 높이 (65% - 대부분의 기기에서 헤더 아래)
    const INITIAL_HEIGHT = 65;

    // 바텀시트 드래그 상태
    const [sheetHeight, setSheetHeight] = useState(INITIAL_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [startHeight, setStartHeight] = useState(INITIAL_HEIGHT);
    const handleRef = useRef<HTMLDivElement>(null);
    // 드래그 속도 측정용 ref
    const lastYRef = useRef(0);
    const lastTimeRef = useRef(0);
    const velocityRef = useRef(0);

    // 패널이 열릴 때마다 안전한 초기 높이로 리셋
    useEffect(() => {
        if (isPanelOpen && isMobileOrTablet) {
            const maxHeight = getMaxHeightPercent();
            // 초기 높이가 최대 높이를 넘지 않도록 보정
            setSheetHeight(Math.min(INITIAL_HEIGHT, maxHeight));
        }
    }, [isPanelOpen, isMobileOrTablet, getMaxHeightPercent]);

    // 드래그 시작
    const handleDragStart = useCallback((e: React.TouchEvent) => {
        setIsDragging(true);
        const touchY = e.touches[0].clientY;
        setStartY(touchY);
        setStartHeight(sheetHeight);
        lastYRef.current = touchY;
        lastTimeRef.current = Date.now();
        velocityRef.current = 0;
    }, [sheetHeight]);

    // 드래그 중 - 더 자유로운 드래그
    const handleDragMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging) return;

        const currentY = e.touches[0].clientY;
        const currentTime = Date.now();

        // 속도 계산 (양수면 아래로 드래그)
        const deltaTime = currentTime - lastTimeRef.current;
        if (deltaTime > 0) {
            velocityRef.current = (currentY - lastYRef.current) / deltaTime;
        }
        lastYRef.current = currentY;
        lastTimeRef.current = currentTime;

        requestAnimationFrame(() => {
            const deltaY = startY - currentY;
            const viewportHeight = window.innerHeight;
            const deltaPercent = (deltaY / viewportHeight) * 100;

            const maxHeightPercent = getMaxHeightPercent();

            let newHeight = startHeight + deltaPercent;
            // 최소 5%까지 드래그 가능 (닫기 영역), 최대는 헤더 아래까지
            newHeight = Math.max(5, Math.min(maxHeightPercent, newHeight));

            setSheetHeight(newHeight);
        });
    }, [isDragging, startY, startHeight, getMaxHeightPercent]);

    // 드래그 종료 - 닫기만 처리, 스냅 없이 현재 위치 유지
    const handleDragEnd = useCallback(() => {
        setIsDragging(false);

        // 빠르게 아래로 스와이프 (velocity > 0.5px/ms) 하면 닫기
        if (velocityRef.current > 0.5) {
            onPanelClose();
            return;
        }

        // 닫기 임계값 이하면 닫기 (15% 이하)
        if (sheetHeight <= 15) {
            onPanelClose();
            return;
        }

        // 최소 높이 이하면 최소 높이로 조정 (20%)
        if (sheetHeight < 20) {
            setSheetHeight(20);
        }
        // 스냅 없음 - 현재 위치 그대로 유지
    }, [sheetHeight, onPanelClose]);

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
                                    // [OPTIMIZATION] transform 방식으로 GPU 가속 적용
                                    // 드래그 중에는 트랜지션 제거, 종료 시 부드러운 스프링 효과
                                    isDragging ? '' : 'transition-transform duration-300',
                                    // iOS safe area 지원 + 하단 네비게이션바 공간
                                    'pb-[calc(env(safe-area-inset-bottom)+56px)]'
                                )}
                                style={{
                                    // [OPTIMIZATION] height 대신 transform 사용 (리플로우 없음, GPU 컴포지트만)
                                    height: '100vh',
                                    transform: `translateY(${100 - sheetHeight}vh)`,
                                    willChange: 'transform',
                                    // 커스텀 이징 함수 (Tailwind 경고 회피)
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
