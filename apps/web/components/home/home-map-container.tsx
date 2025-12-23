'use client';

import { Suspense, lazy } from 'react';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";

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
export default function HomeMapContainer({
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
    // [CSR] 단일 지도 모드
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

            {/* [CSR] 맛집 상세 패널 - 오버레이 형태로 표시 */}
            {panelRestaurant && (
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
        </div>
    );
}
