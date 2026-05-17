'use client';

import { memo, useEffect, useState, type ComponentType } from 'react';
import type { Region, Restaurant } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { BREAKPOINTS, useDeviceType } from '@/hooks/useDeviceType';
import type { User } from '@supabase/supabase-js';
import type { DeviceMapLocation } from '@/lib/device-location-map';
import { useDeferredComponent } from '@/hooks/use-deferred-component';

const MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS = 8000;

type HomeDesktopControlPanelProps = {
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
};

const loadHomeDesktopControlPanel = async () => {
    const mod = await import('@/components/home/home-desktop-control-panel');
    return mod.default as ComponentType<HomeDesktopControlPanelProps>;
};

type MobileControlOverlayProps = HomeControlPanelProps;

const loadMobileControlOverlay = async () => {
    const mod = await import('@/components/home/MobileControlOverlay');
    return mod.default as ComponentType<MobileControlOverlayProps>;
};

function MobileControlOverlayLoadingShell({ onActivate }: { onActivate: () => void }) {
    return (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(env(safe-area-inset-top)+10px)] min-[1280px]:hidden">
            <div className="pointer-events-auto flex h-12 items-center gap-2 rounded-full border border-border bg-background/95 px-2 shadow-lg backdrop-blur-sm">
                <button
                    type="button"
                    onClick={onActivate}
                    className="flex h-10 flex-1 items-center rounded-full px-2.5 text-left text-[15px] text-muted-foreground"
                    aria-label="쯔동여지도 검색 열기"
                >
                    쯔동여지도 검색하기
                </button>
                <button
                    type="button"
                    onClick={onActivate}
                    className="h-9 w-9 rounded-full border border-border bg-background"
                    aria-label="북마크 불러오기"
                />
                <button
                    type="button"
                    onClick={onActivate}
                    className="h-9 w-9 rounded-full border border-border bg-background"
                    aria-label="알림 불러오기"
                />
                <button
                    type="button"
                    onClick={onActivate}
                    className="h-9 w-9 rounded-full border border-border bg-background"
                    aria-label="사용자 메뉴 불러오기"
                />
            </div>
        </div>
    );
}

export interface HomeControlPanelProps {
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
    const shouldRenderMobile = isMobileOrTablet || (
        typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.tabletMax
    );
    const [shouldLoadMobileOverlay, setShouldLoadMobileOverlay] = useState(false);
    const [shouldLoadDesktopPanel, setShouldLoadDesktopPanel] = useState(false);
    const DeferredMobileControlOverlay = useDeferredComponent<MobileControlOverlayProps>(
        shouldRenderMobile && shouldLoadMobileOverlay,
        loadMobileControlOverlay
    );
    const DeferredHomeDesktopControlPanel = useDeferredComponent<HomeDesktopControlPanelProps>(
        shouldLoadDesktopPanel,
        loadHomeDesktopControlPanel
    );

    useEffect(() => {
        const updateShouldLoadDesktopPanel = () => {
            setShouldLoadDesktopPanel(window.innerWidth > BREAKPOINTS.tabletMax);
        };

        updateShouldLoadDesktopPanel();
        window.addEventListener('resize', updateShouldLoadDesktopPanel, { passive: true });

        return () => {
            window.removeEventListener('resize', updateShouldLoadDesktopPanel);
        };
    }, []);

    useEffect(() => {
        if (!shouldRenderMobile || shouldLoadMobileOverlay) return;

        const requestMobileOverlay = () => setShouldLoadMobileOverlay(true);
        const idleTimer = window.setTimeout(requestMobileOverlay, MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS);
        const eventOptions = { passive: true, once: true } as AddEventListenerOptions;

        window.addEventListener('pointerdown', requestMobileOverlay, eventOptions);
        window.addEventListener('keydown', requestMobileOverlay, { once: true });
        window.addEventListener('touchstart', requestMobileOverlay, eventOptions);

        return () => {
            window.clearTimeout(idleTimer);
            window.removeEventListener('pointerdown', requestMobileOverlay);
            window.removeEventListener('keydown', requestMobileOverlay);
            window.removeEventListener('touchstart', requestMobileOverlay);
        };
    }, [shouldLoadMobileOverlay, shouldRenderMobile]);

    if (shouldRenderMobile) {
        if (!DeferredMobileControlOverlay) {
            return <MobileControlOverlayLoadingShell onActivate={() => setShouldLoadMobileOverlay(true)} />;
        }

        return (
            <DeferredMobileControlOverlay
                mapMode={mapMode}
                selectedRegion={selectedRegion}
                selectedCountry={selectedCountry}
                selectedCategories={selectedCategories}
                filters={filters}
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

    if (!DeferredHomeDesktopControlPanel) {
        return null;
    }

    return (
        <DeferredHomeDesktopControlPanel
            mapMode={mapMode}
            selectedRegion={selectedRegion}
            selectedCountry={selectedCountry}
            selectedCategories={selectedCategories}
            filters={filters}
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
    );
}

const HomeControlPanel = memo(HomeControlPanelComponent);
HomeControlPanel.displayName = 'HomeControlPanel';

export default HomeControlPanel;
