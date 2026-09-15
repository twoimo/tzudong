"use client";

import { memo } from 'react';
import type { Region, Restaurant } from '@/types/restaurant';
import type { Announcement } from '@/types/announcement';
import type { FilterState } from '@/components/filters/filter-state';
import type { User } from '@supabase/supabase-js';
import type { DeviceMapLocation } from '@/lib/device-location-map';
import type { HomeMapPanelSide } from '@/lib/home-map-user-preferences';
import type { HomeMapContextualRestaurantsPayload } from '@/lib/home-map-contextual-restaurants';
import type { HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';
import { useHomeViewportMode } from '@/hooks/useHomeViewportMode';
import HomeDesktopControlPanel from './home-desktop-control-panel';
import MobileControlOverlay from './MobileControlOverlay';

type MobileControlOverlayIntent = 'search' | 'bookmark' | 'notification' | 'user';
type HomeOverlayPanelType = 'mypage' | 'adminReviews' | 'announcement' | null;

export interface HomeControlPanelProps {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: Region | null;
    selectedCountry: string | null;
    selectedCategories: string[];
    filters: FilterState;
    onRegionChange: (region: Region | null) => void;
    onCountryChange: (country: string) => void;
    onCategoryChange: (categories: string[]) => void;
    onThemeChange: (themeId: HomeMapThemeFilterId | null) => void;
    onRestaurantSelect: (restaurant: Restaurant) => void;
    onRestaurantSearch: (restaurant: Restaurant) => void;
    onSearchExecute: (region?: Region | null) => void;
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    panelRestaurant?: Restaurant | null;
    isPanelOpen?: boolean;
    contextualRestaurantsPayload?: HomeMapContextualRestaurantsPayload | null;
    isMapFullscreen?: boolean;
    mapInteractionEpoch?: number;
    onPanelClose?: () => void;
    onDetailPanelBack?: () => void;
    onReviewModalOpen?: () => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    isAdmin?: boolean;
    onModeChange?: (mode: 'domestic' | 'overseas') => void;
    isPanelCollapsed?: boolean;
    onTogglePanelCollapse?: () => void;
    onSetPanelCollapsed?: (collapsed: boolean) => void;
    desktopPanelSide?: HomeMapPanelSide;
    user?: User | null;
    onSubmissionClick?: () => void;
    onTopShellUserIconClick?: () => void;
    onDeviceLocationClick?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    isDeviceLocationPending?: boolean;
    isDeviceHeadingMode?: boolean;
    showUserSubmittedMarkers?: boolean;
    onUserSubmittedMarkersToggle?: () => void;
    initialIntent?: MobileControlOverlayIntent | null;
    activeRightPanel?: HomeOverlayPanelType;
    selectedAnnouncement?: Announcement | null;
}

function HomeControlPanelComponent(props: HomeControlPanelProps) {
    const viewportMode = useHomeViewportMode();
    const { contextualRestaurantsPayload } = props;

    // CSS selects the real responsive controls before hydration. Data observers stay
    // disabled until the matching viewport is known, then the inactive branch unmounts.
    return (
        <>
            {viewportMode !== 'desktop' ? (
                <div className="min-[1280px]:hidden" data-home-controls-viewport="mobileOrTablet">
                    <MobileControlOverlay {...props} contextualRestaurantsPayload={contextualRestaurantsPayload} isActive={viewportMode === 'mobileOrTablet'} />
                </div>
            ) : null}
            {viewportMode !== 'mobileOrTablet' ? (
                <div className="hidden min-[1280px]:contents" data-home-controls-viewport="desktop">
                    <HomeDesktopControlPanel {...props} contextualRestaurantsPayload={contextualRestaurantsPayload} isActive={viewportMode === 'desktop'} />
                </div>
            ) : null}
        </>
    );
}

const HomeControlPanel = memo(HomeControlPanelComponent);
HomeControlPanel.displayName = 'HomeControlPanel';
export default HomeControlPanel;
