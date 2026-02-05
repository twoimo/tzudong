'use client'; // [CSR] 사용자 입력 및 상호작용 처리

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDeviceType } from '@/hooks/useDeviceType';

// [OPTIMIZATION] 사용자 요청으로 동시 로딩을 위해 lazy 제거 (번들 크기는 조금 커지지만 UX 개선)
import RegionSelector from "@/components/region/RegionSelector";
import RestaurantSearch from "@/components/search/RestaurantSearch";
import CategoryFilter from "@/components/filters/CategoryFilter";
import MobileControlOverlay from "@/components/home/MobileControlOverlay";
import { OVERSEAS_REGION_LIST } from "@/constants/overseas-regions";

interface HomeControlPanelProps {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;
    selectedCategories: string[];
    filters: FilterState;
    countryCounts: Record<string, number>;
    onRegionChange: (region: Region | null) => void;
    onCountryChange: (country: string) => void;
    onCategoryChange: (categories: string[]) => void;
    onRestaurantSelect: (restaurant: any) => void;
    onRestaurantSearch: (restaurant: any) => void;
    onSearchExecute: (region?: Region | null) => void;
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    leftSidebarWidth?: number;
    rightPanelWidth?: number;
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    user?: any;
    onSubmissionClick?: () => void;
}

// [CSR] 지역/국가 선택, 카테고리 필터, 검색 통합 패널 - 모든 사용자 입력 처리
// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const HomeControlPanelComponent = ({
    mapMode,
    selectedRegion,
    selectedCountry,
    selectedCategories,
    filters,
    countryCounts,
    onRegionChange,
    onCountryChange,
    onCategoryChange,
    onRestaurantSelect,
    onRestaurantSearch,
    onSearchExecute,
    activePanel,
    onPanelClick,
    leftSidebarWidth = 64,
    rightPanelWidth = 0,
    isAdmin = false,
    onModeChange,
    user,
    onSubmissionClick,
}: HomeControlPanelProps) => {
    const { isMobileOrTablet, isDesktop } = useDeviceType();
    const [leftPosition, setLeftPosition] = useState<string>('50%');
    const panelRef = useRef<HTMLDivElement>(null);

    // [OPTIMIZATION] useCallback으로 메모이제이션
    const updateLayout = useCallback(() => {
        const windowWidth = window.innerWidth;
        const availableWidth = windowWidth - leftSidebarWidth - rightPanelWidth;
        const centerOfVisibleArea = leftSidebarWidth + (availableWidth / 2);
        setLeftPosition(`${centerOfVisibleArea}px`);
    }, [leftSidebarWidth, rightPanelWidth]);

    // 데스크탑에서만 위치 계산
    useEffect(() => {
        if (!isDesktop) return;

        updateLayout();
        window.addEventListener('resize', updateLayout, { passive: true });
        return () => window.removeEventListener('resize', updateLayout, { passive: true } as any);
    }, [isDesktop, updateLayout]);

    // [OPTIMIZATION] 클릭 핸들러 메모이제이션
    const handlePanelClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onPanelClick?.('control');
    }, [onPanelClick]);

    // 모바일/태블릿에서는 MobileControlOverlay 사용
    if (isMobileOrTablet) {
        return (
            <MobileControlOverlay
                mapMode={mapMode}
                selectedRegion={selectedRegion}
                selectedCountry={selectedCountry}
                selectedCategories={selectedCategories}
                filters={filters}
                countryCounts={countryCounts}
                onRegionChange={onRegionChange}
                onCountryChange={onCountryChange}
                onCategoryChange={onCategoryChange}
                onRestaurantSelect={onRestaurantSelect}
                onRestaurantSearch={onRestaurantSearch}
                onSearchExecute={onSearchExecute}
                isAdmin={isAdmin}
                onModeChange={onModeChange}
                user={user}
                onSubmissionClick={onSubmissionClick}
            />
        );
    }

    // 데스크탑에서는 기존 하단 패널 사용 (컴팩트 모드 제거됨)
    return (
        <div
            ref={panelRef}
            className="fixed bottom-4 z-[50] hover:z-[60]"
            style={{
                left: leftPosition,
                transform: 'translateX(-50%)'
            }}
            onClick={handlePanelClick}
        >
            <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border shadow-lg p-3 hover:shadow-xl hover:border-primary/50 transition-all duration-300">
                {/* [CSR] 지역/국가 선택 - 드롭다운 인터랙션 */}
                {mapMode === 'domestic' ? (
                    <RegionSelector
                        selectedRegion={selectedRegion}
                        onRegionChange={onRegionChange}
                        onRegionSelect={onSearchExecute}
                    />
                ) : (
                    <Select value={selectedCountry || undefined} onValueChange={onCountryChange}>
                        <SelectTrigger className="w-48">
                            <SelectValue placeholder="지역 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            {OVERSEAS_REGION_LIST.map((region) => (
                                <SelectItem key={region} value={region}>
                                    {region} ({countryCounts[region] || 0}개)
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* [CSR] 카테고리 필터 - 선택 인터랙션 */}
                <CategoryFilter
                    selectedCategories={selectedCategories}
                    onCategoryChange={onCategoryChange}
                    selectedRegion={mapMode === 'domestic' ? selectedRegion : null}
                    selectedCountry={mapMode === 'overseas' ? selectedCountry : null}
                    className="w-48"
                />

                {/* [CSR] 검색 - 텍스트 입력 및 자동완성 */}
                <RestaurantSearch
                    onRestaurantSelect={onRestaurantSelect}
                    onRestaurantSearch={onRestaurantSearch}
                    onSearchExecute={onSearchExecute}
                    filters={filters}
                    selectedRegion={mapMode === 'domestic' ? selectedRegion : (selectedCountry as any)}
                    isKoreanOnly={mapMode === 'domestic'}
                    maxItems={3}
                />
            </div>
        </div>
    );
};

// [OPTIMIZATION] React.memo로 래핑하여 props 변경 시에만 리렌더링
const HomeControlPanel = memo(HomeControlPanelComponent);
HomeControlPanel.displayName = 'HomeControlPanel';

export default HomeControlPanel;
