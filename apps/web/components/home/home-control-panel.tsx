'use client';

import { lazy, memo, Suspense } from 'react';
import type { Region, Restaurant } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { useDeviceType } from '@/hooks/useDeviceType';
import type { User } from '@supabase/supabase-js';
import type { DeviceMapLocation } from '@/lib/device-location-map';
import MobileControlOverlay from '@/components/home/MobileControlOverlay';
import { useOverseasCountryCounts } from '@/components/home/use-overseas-country-counts';

const HomeDesktopControlPanel = lazy(() => import('@/components/home/home-desktop-control-panel'));

interface HomeControlPanelProps {
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
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    leftSidebarWidth?: number;
    rightPanelWidth?: number;
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    user?: User | null;
    onSubmissionClick?: () => void;
    onTopShellUserIconClick?: () => void;
    onDeviceLocationClick?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    isDeviceLocationPending?: boolean;
    isDeviceHeadingMode?: boolean;
}

function HomeControlPanelComponent({
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
    isAdmin = false,
    onModeChange,
    user,
    onSubmissionClick,
    onTopShellUserIconClick,
    onDeviceLocationClick,
    deviceLocation,
    isDeviceLocationPending = false,
    isDeviceHeadingMode = false,
}: HomeControlPanelProps) {
    const { isMobileOrTablet } = useDeviceType();
    const countryCounts = useOverseasCountryCounts(mapMode);

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
                onTopShellUserIconClick={onTopShellUserIconClick}
                onDeviceLocationClick={onDeviceLocationClick}
                deviceLocation={deviceLocation}
                isDeviceLocationPending={isDeviceLocationPending}
                isDeviceHeadingMode={isDeviceHeadingMode}
            />
        );
    }

    return (
        <Suspense fallback={null}>
            <HomeDesktopControlPanel
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
                onPanelClick={onPanelClick}
                leftSidebarWidth={leftSidebarWidth}
                rightPanelWidth={rightPanelWidth}
            />
        </Suspense>
    );
}

const HomeControlPanel = memo(HomeControlPanelComponent);
HomeControlPanel.displayName = 'HomeControlPanel';

export default HomeControlPanel;
