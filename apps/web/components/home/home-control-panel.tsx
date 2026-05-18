'use client';

import { memo, useCallback, useEffect, useState, type ComponentType } from 'react';
import type { Region, Restaurant } from '@/types/restaurant';
import type { FilterState } from '@/components/filters/filter-state';
import { BREAKPOINTS, useDeviceType } from '@/hooks/useDeviceType';
import type { User } from '@supabase/supabase-js';
import type { DeviceMapLocation } from '@/lib/device-location-map';
import { useDeferredComponent } from '@/hooks/use-deferred-component';

const MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS = 8000;

type MobileControlOverlayIntent = 'search' | 'bookmark' | 'notification' | 'user';

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
    initialIntent?: MobileControlOverlayIntent | null;
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

function DesktopControlPanelLoadingShell() {
    return (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[50] hidden -translate-x-1/2 min-[1280px]:block">
            <div className="flex max-w-[calc(100vw-12rem)] flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm">
                <div className="h-10 w-[clamp(9.5rem,18vw,12.5rem)] rounded-md border border-input bg-background" aria-hidden="true" />
                <div className="h-10 w-[clamp(9.5rem,18vw,12.5rem)] rounded-md border border-input bg-background" aria-hidden="true" />
                <div className="h-10 w-[clamp(14rem,24vw,20rem)] rounded-md border border-input bg-background" aria-hidden="true" />
            </div>
        </div>
    );
}

function MobileControlOverlayLoadingShell({ onActivate }: { onActivate: (intent: MobileControlOverlayIntent) => void }) {
    return (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(env(safe-area-inset-top)+10px)] min-[1280px]:hidden">
            <div className="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-background/95 px-2 shadow-lg shadow-black/5 backdrop-blur-sm">
                <button
                    type="button"
                    onClick={() => onActivate('search')}
                    className="flex min-h-11 flex-1 items-center rounded-full px-2.5 text-left text-[15px] text-muted-foreground"
                    aria-label="쯔동여지도 검색 열기"
                >
                    쯔동여지도 검색하기
                </button>
                <button
                    type="button"
                    onClick={() => onActivate('bookmark')}
                    className="min-h-11 min-w-11 rounded-full bg-muted/45"
                    aria-label="북마크 불러오기"
                />
                <button
                    type="button"
                    onClick={() => onActivate('notification')}
                    className="min-h-11 min-w-11 rounded-full bg-muted/45"
                    aria-label="알림 불러오기"
                />
                <button
                    type="button"
                    onClick={() => onActivate('user')}
                    className="min-h-11 min-w-11 rounded-full bg-muted/45"
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
    initialIntent?: MobileControlOverlayIntent | null;
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
    initialIntent = null,
}: HomeControlPanelProps) {
    const { isMobileOrTablet } = useDeviceType();
    const shouldRenderMobile = isMobileOrTablet || (
        typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.tabletMax
    );
    const [shouldLoadMobileOverlay, setShouldLoadMobileOverlay] = useState(Boolean(initialIntent));
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

        const requestMobileOverlay = () => setShouldLoadMobileOverlay(true);
        const idleWindow = window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
        };
        const idleCallbackId = idleWindow.requestIdleCallback
            ? idleWindow.requestIdleCallback(requestMobileOverlay, { timeout: MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS })
            : null;
        const idleTimer = idleCallbackId === null ? window.setTimeout(requestMobileOverlay, MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS) : null;
        const eventOptions = { passive: true, once: true } as AddEventListenerOptions;

        window.addEventListener('pointerdown', requestMobileOverlay, eventOptions);
        window.addEventListener('keydown', requestMobileOverlay, { once: true });
        window.addEventListener('touchstart', requestMobileOverlay, eventOptions);

        return () => {
            if (idleCallbackId !== null) idleWindow.cancelIdleCallback?.(idleCallbackId);
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            window.removeEventListener('pointerdown', requestMobileOverlay);
            window.removeEventListener('keydown', requestMobileOverlay);
            window.removeEventListener('touchstart', requestMobileOverlay);
        };
    }, [shouldLoadMobileOverlay, shouldRenderMobile]);

    const handleMobileOverlayIntent = useCallback((intent: MobileControlOverlayIntent) => {
        setPendingMobileOverlayIntent(intent);
        setShouldLoadMobileOverlay(true);
    }, []);

    if (shouldRenderMobile) {
        if (!DeferredMobileControlOverlay) {
            return <MobileControlOverlayLoadingShell onActivate={handleMobileOverlayIntent} />;
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
        return <DesktopControlPanelLoadingShell />;
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
            initialIntent={initialIntent}
        />
    );
}

const HomeControlPanel = memo(HomeControlPanelComponent);
HomeControlPanel.displayName = 'HomeControlPanel';

export default HomeControlPanel;
