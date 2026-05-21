'use client';

import { memo, useEffect, useState, type ComponentType } from 'react';
import type { Region, Restaurant } from '@/types/restaurant';
import type { Announcement } from '@/types/announcement';
import type { FilterState } from '@/components/filters/filter-state';
import { BREAKPOINTS, useDeviceType } from '@/hooks/useDeviceType';
import type { User } from '@supabase/supabase-js';
import type { DeviceMapLocation } from '@/lib/device-location-map';
import { useDeferredComponent } from '@/hooks/use-deferred-component';


type MobileControlOverlayIntent = 'search' | 'bookmark' | 'notification' | 'user';
type HomeOverlayPanelType = 'mypage' | 'adminReviews' | 'announcement' | null;

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
    initialIntent?: MobileControlOverlayIntent | null;
    panelRestaurant?: Restaurant | null;
    isPanelOpen?: boolean;
    onPanelClose?: () => void;
    onReviewModalOpen?: () => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    isPanelCollapsed?: boolean;
    onTogglePanelCollapse?: () => void;
    user?: User | null;
    isAdmin?: boolean;
    activeRightPanel?: HomeOverlayPanelType;
    selectedAnnouncement?: Announcement | null;
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
    panelRestaurant?: Restaurant | null;
    isPanelOpen?: boolean;
    onPanelClose?: () => void;
    onReviewModalOpen?: () => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    isPanelCollapsed?: boolean;
    onTogglePanelCollapse?: () => void;
    user?: User | null;
    onSubmissionClick?: () => void;
    onTopShellUserIconClick?: () => void;
    onDeviceLocationClick?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    isDeviceLocationPending?: boolean;
    isDeviceHeadingMode?: boolean;
    initialIntent?: MobileControlOverlayIntent | null;
    activeRightPanel?: HomeOverlayPanelType;
    selectedAnnouncement?: Announcement | null;
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
    panelRestaurant = null,
    isPanelOpen = false,
    onPanelClose,
    onReviewModalOpen,
    onAdminEditRestaurant,
    onRequestEditRestaurant,
    isAdmin = false,
    onModeChange,
    user,
    onSubmissionClick,
    onTopShellUserIconClick,
    onDeviceLocationClick,
    deviceLocation,
    isDeviceLocationPending = false,
    isDeviceHeadingMode = false,
    isPanelCollapsed = false,
    onTogglePanelCollapse,
    initialIntent = null,
    activeRightPanel = null,
    selectedAnnouncement = null,
}: HomeControlPanelProps) {
    const { isMobileOrTablet } = useDeviceType();
    const shouldRenderMobile = isMobileOrTablet || (
        typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.tabletMax
    );
    const [shouldLoadMobileOverlay, setShouldLoadMobileOverlay] = useState(() => (
        Boolean(initialIntent) || (typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.tabletMax)
    ));
    const [pendingMobileOverlayIntent, setPendingMobileOverlayIntent] = useState<MobileControlOverlayIntent | null>(initialIntent);
    const [shouldLoadDesktopPanel, setShouldLoadDesktopPanel] = useState(() => (
        typeof window !== 'undefined' ? window.innerWidth > BREAKPOINTS.tabletMax : false
    ));
    const DeferredMobileControlOverlay = useDeferredComponent<MobileControlOverlayProps>(
        shouldRenderMobile && shouldLoadMobileOverlay,
        loadMobileControlOverlay
    );

    useEffect(() => {
        if (!initialIntent) return;

        setPendingMobileOverlayIntent(initialIntent);
        setShouldLoadMobileOverlay(true);
    }, [initialIntent]);
    const DeferredHomeDesktopControlPanel = useDeferredComponent<HomeDesktopControlPanelProps>(
        shouldLoadDesktopPanel,
        loadHomeDesktopControlPanel
    );

    useEffect(() => {
        let resizeRafId = 0;
        const updateShouldLoadDesktopPanel = () => {
            if (resizeRafId) return;

            resizeRafId = window.requestAnimationFrame(() => {
                resizeRafId = 0;
                setShouldLoadDesktopPanel(window.innerWidth > BREAKPOINTS.tabletMax);
            });
        };

        updateShouldLoadDesktopPanel();
        window.addEventListener('resize', updateShouldLoadDesktopPanel, { passive: true });

        return () => {
            window.removeEventListener('resize', updateShouldLoadDesktopPanel);
            if (resizeRafId) window.cancelAnimationFrame(resizeRafId);
        };
    }, []);

    useEffect(() => {
        if (!shouldRenderMobile || shouldLoadMobileOverlay) return;

        setShouldLoadMobileOverlay(true);
    }, [shouldLoadMobileOverlay, shouldRenderMobile]);

    if (shouldRenderMobile) {
        if (!DeferredMobileControlOverlay) {
            return null;
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
                initialIntent={pendingMobileOverlayIntent}
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
            initialIntent={initialIntent}
            panelRestaurant={panelRestaurant}
            isPanelOpen={isPanelOpen}
            onPanelClose={onPanelClose}
            onReviewModalOpen={onReviewModalOpen}
            onAdminEditRestaurant={onAdminEditRestaurant}
            onRequestEditRestaurant={onRequestEditRestaurant}
            onModeChange={onModeChange}
            isPanelCollapsed={isPanelCollapsed}
            onTogglePanelCollapse={onTogglePanelCollapse}
            user={user}
            isAdmin={isAdmin}
            activeRightPanel={activeRightPanel}
            selectedAnnouncement={selectedAnnouncement}
        />
    );
}

const HomeControlPanel = memo(HomeControlPanelComponent);
HomeControlPanel.displayName = 'HomeControlPanel';

export default HomeControlPanel;
