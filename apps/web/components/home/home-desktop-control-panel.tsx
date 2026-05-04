'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RegionSelector from '@/components/region/RegionSelector';
import RestaurantSearch from '@/components/search/RestaurantSearch';
import CategoryFilter from '@/components/filters/CategoryFilter';
import { OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';
import type { FilterState } from '@/components/filters/filter-state';
import type { Region, Restaurant } from '@/types/restaurant';

interface HomeDesktopControlPanelProps {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;
    selectedCategories: string[];
    filters: FilterState;
    countryCounts: Record<string, number>;
    onRegionChange: (region: Region | null) => void;
    onCountryChange: (country: string) => void;
    onCategoryChange: (categories: string[]) => void;
    onRestaurantSelect: (restaurant: Restaurant) => void;
    onRestaurantSearch: (restaurant: Restaurant) => void;
    onSearchExecute: (region?: Region | null) => void;
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    leftSidebarWidth?: number;
    rightPanelWidth?: number;
}

export default function HomeDesktopControlPanel({
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
    onPanelClick,
    leftSidebarWidth = 64,
    rightPanelWidth = 0,
}: HomeDesktopControlPanelProps) {
    const [leftPosition, setLeftPosition] = useState<string>('50%');
    const panelRef = useRef<HTMLDivElement>(null);

    const updateLayout = useCallback(() => {
        const windowWidth = window.innerWidth;
        const availableWidth = windowWidth - leftSidebarWidth - rightPanelWidth;
        const centerOfVisibleArea = leftSidebarWidth + (availableWidth / 2);
        setLeftPosition(`${centerOfVisibleArea}px`);
    }, [leftSidebarWidth, rightPanelWidth]);

    useEffect(() => {
        updateLayout();
        window.addEventListener('resize', updateLayout, { passive: true });
        return () => window.removeEventListener('resize', updateLayout);
    }, [updateLayout]);

    const handlePanelMouseDownCapture = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onPanelClick?.('control');
    }, [onPanelClick]);

    const handlePanelFocusCapture = useCallback(() => {
        onPanelClick?.('control');
    }, [onPanelClick]);

    return (
        <div
            ref={panelRef}
            className="fixed bottom-4 z-[50] hover:z-[60]"
            style={{
                left: leftPosition,
                transform: 'translateX(-50%)',
            }}
            onMouseDownCapture={handlePanelMouseDownCapture}
            onFocusCapture={handlePanelFocusCapture}
        >
            <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border shadow-lg p-3 hover:shadow-xl hover:border-primary/50 transition-all duration-300">
                {mapMode === 'domestic' ? (
                    <RegionSelector
                        selectedRegion={selectedRegion}
                        onRegionChange={onRegionChange}
                        onRegionSelect={onSearchExecute}
                    />
                ) : (
                    <Select value={selectedCountry || undefined} onValueChange={onCountryChange}>
                        <SelectTrigger className="w-[clamp(9.5rem,18vw,12.5rem)]">
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

                <CategoryFilter
                    selectedCategories={selectedCategories}
                    onCategoryChange={onCategoryChange}
                    selectedRegion={mapMode === 'domestic' ? selectedRegion : null}
                    selectedCountry={mapMode === 'overseas' ? selectedCountry : null}
                    className="w-[clamp(9.5rem,18vw,12.5rem)]"
                />

                <RestaurantSearch
                    onRestaurantSelect={onRestaurantSelect}
                    onRestaurantSearch={onRestaurantSearch}
                    onSearchExecute={onSearchExecute}
                    filters={filters}
                    selectedRegion={mapMode === 'domestic' ? selectedRegion : selectedCountry}
                    isKoreanOnly={mapMode === 'domestic'}
                    maxItems={3}
                />
            </div>
        </div>
    );
}
