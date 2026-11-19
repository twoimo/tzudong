'use client';

import { useState, useEffect } from 'react';
import { DESKTOP_MIN_WIDTH_QUERY, TABLET_MIN_WIDTH_QUERY } from '@/lib/viewport-breakpoints';

const DEVICE_MEDIA_QUERIES = {
    tabletOrDesktop: TABLET_MIN_WIDTH_QUERY,
    desktop: DESKTOP_MIN_WIDTH_QUERY,
    landscape: '(orientation: landscape)',
    coarsePointer: '(pointer: coarse)',
} as const;

type DeviceMediaQueries = Record<keyof typeof DEVICE_MEDIA_QUERIES, MediaQueryList>;

export interface DeviceType {
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isMobileOrTablet: boolean;
    isLandscape: boolean;
    viewportClass: 'mobile' | 'tablet' | 'desktop';
    isTouch: boolean;
}

function isBrowserMobileOrTabletViewport(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    return !window.matchMedia(DESKTOP_MIN_WIDTH_QUERY).matches;
}

function getDesktopDeviceType(): DeviceType {
    return {
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isMobileOrTablet: false,
        isLandscape: false,
        viewportClass: 'desktop',
        isTouch: false,
    };
}

function calculateDeviceTypeSnapshot(queries: DeviceMediaQueries): DeviceType {
    const isLandscape = queries.landscape.matches;
    const isTouch =
        queries.coarsePointer.matches ||
        navigator.maxTouchPoints > 0;

    const isMobile = !queries.tabletOrDesktop.matches;
    const isDesktop = queries.desktop.matches;
    const isTablet = !isMobile && !isDesktop;

    const viewportClass: DeviceType['viewportClass'] = isMobile
        ? 'mobile'
        : isTablet
            ? 'tablet'
            : 'desktop';

    return {
        isMobile,
        isTablet,
        isDesktop,
        isMobileOrTablet: isMobile || isTablet,
        isLandscape,
        viewportClass,
        isTouch,
    };
}

function areDeviceTypesEqual(a: DeviceType, b: DeviceType): boolean {
    return (
        a.isMobile === b.isMobile &&
        a.isTablet === b.isTablet &&
        a.isDesktop === b.isDesktop &&
        a.isMobileOrTablet === b.isMobileOrTablet &&
        a.isLandscape === b.isLandscape &&
        a.viewportClass === b.viewportClass &&
        a.isTouch === b.isTouch
    );
}

function resolveDeviceTypeState(previous: DeviceType, next: DeviceType): DeviceType {
    return areDeviceTypesEqual(previous, next) ? previous : next;
}

export function useDeviceType(): DeviceType {
    const [deviceType, setDeviceType] = useState<DeviceType>(getDesktopDeviceType);

    useEffect(() => {
        const queries: DeviceMediaQueries = {
            tabletOrDesktop: window.matchMedia(DEVICE_MEDIA_QUERIES.tabletOrDesktop),
            desktop: window.matchMedia(DEVICE_MEDIA_QUERIES.desktop),
            landscape: window.matchMedia(DEVICE_MEDIA_QUERIES.landscape),
            coarsePointer: window.matchMedia(DEVICE_MEDIA_QUERIES.coarsePointer),
        };
        const updateDeviceType = () => {
            setDeviceType((previous) => resolveDeviceTypeState(previous, calculateDeviceTypeSnapshot(queries)));
        };
        const mediaQueries = Object.values(queries);
        mediaQueries.forEach(query => query.addEventListener('change', updateDeviceType));
        updateDeviceType();

        return () => {
            mediaQueries.forEach(query => query.removeEventListener('change', updateDeviceType));
        };
    }, []);

    return deviceType;
}

export function useIsMobile(): boolean {
    const { isMobileOrTablet } = useDeviceType();
    return isMobileOrTablet || isBrowserMobileOrTabletViewport();
}

export function useImmediateMobileOrTablet(): boolean {
    return useIsMobile();
}

export { BREAKPOINTS } from '@/lib/viewport-breakpoints';
