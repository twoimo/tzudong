'use client'; // [CSR] 사용자 입력 및 상호작용 처리

import { useRef, useEffect, useState } from 'react';
import { Region } from '@/types/restaurant';
import { FilterState } from '@/components/filters/FilterPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDeviceType } from '@/hooks/useDeviceType';

// [OPTIMIZATION] 사용자 요청으로 동시 로딩을 위해 lazy 제거 (번들 크기는 조금 커지지만 UX 개선)
import RegionSelector from "@/components/region/RegionSelector";
import RestaurantSearch from "@/components/search/RestaurantSearch";
import CategoryFilter from "@/components/filters/CategoryFilter";
import MobileControlOverlay from "@/components/home/MobileControlOverlay";

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
}

// [CSR] 지역/국가 선택, 카테고리 필터, 검색 통합 패널 - 모든 사용자 입력 처리
export default function HomeControlPanel({
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
}: HomeControlPanelProps) {
    const { isMobileOrTablet, isDesktop } = useDeviceType();
    const [leftPosition, setLeftPosition] = useState<string>('50%');
    const panelRef = useRef<HTMLDivElement>(null);

    // 데스크탑에서만 위치 계산
    useEffect(() => {
        if (!isDesktop) return;

        const updateLayout = () => {
            const windowWidth = window.innerWidth;
            const availableWidth = windowWidth - leftSidebarWidth - rightPanelWidth;
            const centerOfVisibleArea = leftSidebarWidth + (availableWidth / 2);
            setLeftPosition(`${centerOfVisibleArea}px`);
        };

        updateLayout();
        window.addEventListener('resize', updateLayout);
        return () => window.removeEventListener('resize', updateLayout);
    }, [leftSidebarWidth, rightPanelWidth, isDesktop]);

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
            onClick={(e) => {
                e.stopPropagation();
                onPanelClick?.('control');
            }}
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
                            <SelectValue placeholder="국가 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="미국">미국 ({countryCounts["미국"] || 0}개)</SelectItem>
                            <SelectItem value="일본">일본 ({countryCounts["일본"] || 0}개)</SelectItem>
                            <SelectItem value="대만">대만 ({countryCounts["대만"] || 0}개)</SelectItem>
                            <SelectItem value="태국">태국 ({countryCounts["태국"] || 0}개)</SelectItem>
                            <SelectItem value="인도네시아">인도네시아 ({countryCounts["인도네시아"] || 0}개)</SelectItem>
                            <SelectItem value="튀르키예">튀르키예 ({countryCounts["튀르키예"] || 0}개)</SelectItem>
                            <SelectItem value="헝가리">헝가리 ({countryCounts["헝가리"] || 0}개)</SelectItem>
                            <SelectItem value="오스트레일리아">오스트레일리아 ({countryCounts["오스트레일리아"] || 0}개)</SelectItem>
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
                />
            </div>
        </div>
    );
}
