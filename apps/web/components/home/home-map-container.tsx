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

    // 바텀시트 드래그 상태
    const [sheetHeight, setSheetHeight] = useState(75);
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [startHeight, setStartHeight] = useState(75);
    const handleRef = useRef<HTMLDivElement>(null);

    // 드래그 시작
    const handleDragStart = useCallback((e: React.TouchEvent) => {
        setIsDragging(true);
        setStartY(e.touches[0].clientY);
        setStartHeight(sheetHeight);
    }, [sheetHeight]);

    // 드래그 중 - requestAnimationFrame으로 최적화
    const handleDragMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging) return;

        requestAnimationFrame(() => {
            const deltaY = startY - e.touches[0].clientY;
            const viewportHeight = window.innerHeight;
            const deltaPercent = (deltaY / viewportHeight) * 100;

            let newHeight = startHeight + deltaPercent;
            // 최소 30%, 최대 85%로 제한
            newHeight = Math.max(30, Math.min(85, newHeight));

            setSheetHeight(newHeight);
        });
    }, [isDragging, startY, startHeight]);

    // 드래그 종료
    const handleDragEnd = useCallback(() => {
        setIsDragging(false);

        // 스냅 포인트: 30%, 50%, 75%, 85%
        const snapPoints = [30, 50, 75, 85];
        const closest = snapPoints.reduce((prev, curr) =>
            Math.abs(curr - sheetHeight) < Math.abs(prev - sheetHeight) ? curr : prev
        );

        setSheetHeight(closest);
    }, [sheetHeight]);

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
            if (isDragging) {
                e.preventDefault();
            }
        };

        handle.addEventListener('touchmove', preventPullToRefresh, { passive: false });

        return () => {
            handle.removeEventListener('touchmove', preventPullToRefresh);
        };
    }, [isPanelOpen, isMobileOrTablet, isDragging]);

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
                            className="fixed inset-0 z-50 bg-black/30"
                            onClick={onPanelClose}
                        >
                            <div
                                className={cn(
                                    'fixed bottom-0 left-0 right-0 z-50',
                                    'bg-background rounded-t-2xl shadow-xl',
                                    'transition-all duration-150',
                                    isDragging ? '' : 'ease-out',
                                    'overflow-hidden flex flex-col',
                                    // iOS safe area 지원 + 하단 네비게이션바 공간
                                    'pb-[calc(env(safe-area-inset-bottom)+56px)]'
                                )}
                                style={{ height: `${sheetHeight}vh` }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* 핸들 바 - 드래그 가능, 항상 상단 고정, touch-action: none으로 Pull-to-Refresh 방지 */}
                                <div
                                    ref={handleRef}
                                    className="sticky top-0 z-20 flex justify-center py-3 bg-background cursor-grab active:cursor-grabbing border-b border-border/50"
                                    style={{ touchAction: 'none' }}
                                    onTouchStart={handleDragStart}
                                    onTouchMove={handleDragMove}
                                    onTouchEnd={handleDragEnd}
                                >
                                    <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
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
