'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RegionSelector from '@/components/region/RegionSelector';
import CategoryFilter from '@/components/filters/CategoryFilter';
import { OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';
import type { FilterState } from '@/components/filters/filter-state';
import type { Region, Restaurant } from '@/types/restaurant';
import { useOverseasCountryCounts } from '@/components/home/use-overseas-country-counts';
import { useDeferredComponent } from '@/hooks/use-deferred-component';


type RestaurantSearchComponentProps = {
    onRestaurantSelect: (restaurant: Restaurant) => void;
    onRestaurantSearch?: (restaurant: Restaurant) => void;
    onSearchExecute?: (region?: Region | null) => void;
    filters?: FilterState;
    selectedRegion?: string | null;
    isKoreanOnly?: boolean;
    maxItems?: number;
    autoFocusInput?: boolean;
};

const loadDesktopRestaurantSearch = async () => {
    const mod = await import('@/components/search/RestaurantSearch');
    return mod.default as ComponentType<RestaurantSearchComponentProps>;
};

interface HomeDesktopControlPanelProps {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;
    selectedCategories: string[];
    filters: FilterState;
    onRegionChange: (region: Region | null) => void;
    onCountryChange: (country: string) => void;
    onCategoryChange: (categories: string[]) => void;
    onRestaurantSelect: (restaurant: Restaurant) => void;
    onRestaurantSearch: (restaurant: Restaurant) => void;
    onSearchExecute: (region?: Region | null) => void;
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    leftSidebarWidth?: number;
    rightPanelWidth?: number;
    initialIntent?: 'search' | 'bookmark' | 'notification' | 'user' | null;
}

export default function HomeDesktopControlPanel({
    mapMode,
    selectedRegion,
    selectedCountry,
    selectedCategories,
    filters,
    onRegionChange,
    onCountryChange,
    onCategoryChange,
    onRestaurantSelect,
    onRestaurantSearch,
    onSearchExecute,
    onPanelClick,
    leftSidebarWidth = 64,
    rightPanelWidth = 0,
    initialIntent = null,
}: HomeDesktopControlPanelProps) {
    const [leftPosition, setLeftPosition] = useState<string>('50%');
    const panelRef = useRef<HTMLDivElement>(null);
    const countryCounts = useOverseasCountryCounts(mapMode);
    const DeferredRestaurantSearch = useDeferredComponent<RestaurantSearchComponentProps>(
        true,
        loadDesktopRestaurantSearch
    );
    useEffect(() => {
        if (initialIntent !== 'search') return;

        onPanelClick?.('control');
    }, [initialIntent, onPanelClick]);

    const updateLayout = useCallback(() => {
        const windowWidth = window.innerWidth;
        const availableWidth = windowWidth - leftSidebarWidth - rightPanelWidth;
        const centerOfVisibleArea = leftSidebarWidth + (availableWidth / 2);
        setLeftPosition(`${centerOfVisibleArea}px`);
    }, [leftSidebarWidth, rightPanelWidth]);

    useEffect(() => {
        let resizeRafId = 0;
        const scheduleLayoutUpdate = () => {
            if (resizeRafId) return;

            resizeRafId = window.requestAnimationFrame(() => {
                resizeRafId = 0;
                updateLayout();
            });
        };

        scheduleLayoutUpdate();
        window.addEventListener('resize', scheduleLayoutUpdate, { passive: true });
        return () => {
            window.removeEventListener('resize', scheduleLayoutUpdate);
            if (resizeRafId) window.cancelAnimationFrame(resizeRafId);
        };
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
            className="fixed bottom-4 z-[50] max-w-[calc(100vw-12rem)] hover:z-[60]"
            style={{
                left: leftPosition,
                transform: 'translateX(-50%)',
            }}
            onMouseDownCapture={handlePanelMouseDownCapture}
            onFocusCapture={handlePanelFocusCapture}
        >
            <div className="flex max-w-full flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm transition-all duration-300 hover:border-primary/50 hover:shadow-xl motion-reduce:transition-none">
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

                {DeferredRestaurantSearch ? (
                    <DeferredRestaurantSearch
                        onRestaurantSelect={onRestaurantSelect}
                        onRestaurantSearch={onRestaurantSearch}
                        onSearchExecute={onSearchExecute}
                        filters={filters}
                        selectedRegion={mapMode === 'domestic' ? selectedRegion : selectedCountry}
                        isKoreanOnly={mapMode === 'domestic'}
                        maxItems={3}
                        autoFocusInput
                    />
                ) : null}
            </div>
        </div>
    );
}
