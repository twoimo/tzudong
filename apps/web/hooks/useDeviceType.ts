'use client';

import { useState, useEffect, useCallback } from 'react';

const BREAKPOINTS = {
    mobileMax: 767,
    tabletMax: 1279,
} as const;

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

    return window.innerWidth <= BREAKPOINTS.tabletMax;
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

function calculateDeviceTypeSnapshot(): DeviceType {
    if (typeof window === 'undefined') {
        return getDesktopDeviceType();
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const isLandscape = width > height;

    const isTouch =
        window.matchMedia('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0;

    const isMobile = width <= BREAKPOINTS.mobileMax;
    const isTablet = width > BREAKPOINTS.mobileMax && width <= BREAKPOINTS.tabletMax;
    const isDesktop = width > BREAKPOINTS.tabletMax;

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

function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
    let timeoutId: ReturnType<typeof setTimeout>;
    return ((...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    }) as T;
}

export function useDeviceType(): DeviceType {
    const [deviceType, setDeviceType] = useState<DeviceType>(calculateDeviceTypeSnapshot);

    const calculateDeviceType = useCallback(() => {
        return calculateDeviceTypeSnapshot();
    }, []);

    useEffect(() => {
        setDeviceType((previous) => resolveDeviceTypeState(previous, calculateDeviceType()));

        const debouncedUpdate = debounce(() => {
            setDeviceType((previous) => resolveDeviceTypeState(previous, calculateDeviceType()));
        }, 50);

        window.addEventListener('resize', debouncedUpdate, { passive: true });
        window.addEventListener('orientationchange', debouncedUpdate, { passive: true });

        return () => {
            window.removeEventListener('resize', debouncedUpdate);
            window.removeEventListener('orientationchange', debouncedUpdate);
        };
    }, [calculateDeviceType]);

    return deviceType;
}

export function useIsMobile(): boolean {
    const { isMobileOrTablet } = useDeviceType();
    return isMobileOrTablet || isBrowserMobileOrTabletViewport();
}

export function useImmediateMobileOrTablet(): boolean {
    return useIsMobile();
}

export { BREAKPOINTS };
