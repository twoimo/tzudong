'use client';

import { Suspense, lazy } from 'react';
import { Restaurant, Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, MapPin, Users } from "lucide-react";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";

// [CSR] 지도 컴포넌트 지연 로딩 - 번들 사이즈 최적화
const NaverMapView = lazy(() => import("@/components/map/NaverMapView"));
const MapView = lazy(() => import("@/components/map/MapView"));

interface HomeMapContainerProps {
    mapMode: 'domestic' | 'overseas';
    isGridMode: boolean;
    gridRegions: Region[];
    gridSelectedRestaurants: { [key: string]: Restaurant | null };
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
    onGridRestaurantSelect: (region: Region, restaurant: Restaurant) => void;
    onGridRestaurantClose: (region: Region) => void;
    onSwitchToSingleMap: (region?: Region | null) => void;
    onMapReady: (moveFunction: (restaurant: Restaurant) => void) => void;
    onMarkerClick: (restaurant: Restaurant) => void;
    onPanelClose: () => void;
    onReviewModalOpen: () => void;
    onTogglePanelCollapse?: () => void;
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
}

// [CSR] 지도 렌더링 및 그리드/단일 모드 처리 - 브라우저 전용 지도 라이브러리 사용
export default function HomeMapContainer({
    mapMode,
    isGridMode,
    gridRegions,
    gridSelectedRestaurants,
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
    onGridRestaurantSelect,
    onGridRestaurantClose,
    onSwitchToSingleMap,
    onMapReady,
    onMarkerClick,
    onPanelClose,
    onReviewModalOpen,
    onTogglePanelCollapse,
    activePanel,
    onPanelClick,
}: HomeMapContainerProps) {
    if (isGridMode) {
        // [CSR] 그리드 모드: 2x2 그리드로 4개 지역 표시 - 복수 지도 인스턴스
        return (
            <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-1 p-1">
                {gridRegions.map((region) => {
                    const gridSelectedRestaurant = gridSelectedRestaurants[region];
                    return (
                        <div key={region} className="relative min-h-0 overflow-hidden rounded-md border border-border">
                            <NaverMapView
                                filters={filters}
                                selectedRegion={region}
                                searchedRestaurant={null}
                                selectedRestaurant={null}
                                refreshTrigger={refreshTrigger}
                                onAdminEditRestaurant={onAdminEditRestaurant}
                                isGridMode={true}
                                gridSelectedRestaurant={gridSelectedRestaurant}
                                onRestaurantSelect={(restaurant) => onGridRestaurantSelect(region, restaurant)}
                            />
                            <Button
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 left-2 bg-background/95 backdrop-blur-sm hover:bg-background text-sm font-semibold shadow z-10 h-auto py-1 px-2 text-foreground"
                                onClick={() => onSwitchToSingleMap(region)}
                            >
                                {region}
                            </Button>

                            {/* [CSR] 각 그리드별 맛집 모달 - 인라인 표시 */}
                            {gridSelectedRestaurant && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-30">
                                    <div className="bg-background rounded-lg border shadow-lg max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
                                        <div className="p-6">
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                                    <ChefHat className="h-5 w-5 text-orange-500" />
                                                    {gridSelectedRestaurant.name}
                                                </h3>
                                                <button
                                                    onClick={() => onGridRestaurantClose(region)}
                                                    className="text-muted-foreground hover:text-foreground"
                                                >
                                                    ✕
                                                </button>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                    <MapPin className="h-4 w-4" />
                                                    {gridSelectedRestaurant.road_address || gridSelectedRestaurant.jibun_address || gridSelectedRestaurant.address}
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <Users className="h-4 w-4 text-blue-500" />
                                                    <span className="text-sm">
                                                        방문: {gridSelectedRestaurant.review_count || 0}회
                                                    </span>
                                                </div>

                                                {((gridSelectedRestaurant.categories && gridSelectedRestaurant.categories.length > 0) ||
                                                    (gridSelectedRestaurant.category && gridSelectedRestaurant.category.length > 0)) && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {(gridSelectedRestaurant.categories || gridSelectedRestaurant.category)?.map((cat, index) => (
                                                                <Badge key={index} variant="secondary" className="text-xs">
                                                                    {cat}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}

                                                {gridSelectedRestaurant.description && (
                                                    <p className="text-sm text-muted-foreground line-clamp-3">
                                                        {gridSelectedRestaurant.description}
                                                    </p>
                                                )}

                                                <div className="flex gap-2 pt-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => {
                                                            onReviewModalOpen();
                                                            onGridRestaurantClose(region);
                                                        }}
                                                        className="flex-1"
                                                    >
                                                        리뷰 쓰기
                                                    </Button>
                                                    {onAdminEditRestaurant && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => {
                                                                onAdminEditRestaurant(gridSelectedRestaurant);
                                                                onGridRestaurantClose(region);
                                                            }}
                                                        >
                                                            수정
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    // [CSR] 단일 지도 모드 - 국내/해외 분기
    return (
        <Suspense fallback={<MapSkeleton />}>
            {mapMode === 'domestic' ? (
                // [CSR] 국내 지도 - 네이버 맵 API 사용
                <NaverMapView
                    filters={filters}
                    selectedRegion={selectedRegion}
                    searchedRestaurant={searchedRestaurant}
                    selectedRestaurant={selectedRestaurant}
                    refreshTrigger={refreshTrigger}
                    onAdminEditRestaurant={onAdminEditRestaurant}
                    onRequestEditRestaurant={onRequestEditRestaurant}
                    isGridMode={false}
                    onRestaurantSelect={onRestaurantSelect}
                    activePanel={activePanel}
                    onPanelClick={onPanelClick}
                />
            ) : (
                // [CSR] 해외 지도 - Flexbox 레이아웃으로 변경 (고정 너비 패널)
                <div className="w-full h-full flex relative overflow-hidden">
                    {/* 지도 영역 */}
                    <div className="flex-1 h-full relative z-0">
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
                    </div>

                    {/* [CSR] 맛집 상세 패널 - 고정 너비 400px, 애니메이션 적용 */}
                    {panelRestaurant && (
                        <div
                            className={`h-full relative z-20 shadow-xl bg-background transition-all duration-300 ease-in-out ${isPanelOpen ? 'w-[400px]' : 'w-0'}`}
                            style={{ overflow: 'visible' }} // 버튼이 밖으로 튀어나와야 함
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
            )}
        </Suspense>
    );
}
