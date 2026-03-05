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

function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
    let timeoutId: ReturnType<typeof setTimeout>;
    return ((...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    }) as T;
}

export function useDeviceType(): DeviceType {
    const [deviceType, setDeviceType] = useState<DeviceType>({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isMobileOrTablet: false,
        isLandscape: false,
        viewportClass: 'desktop',
        isTouch: false,
    });

    const calculateDeviceType = useCallback(() => {
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
    }, []);

    useEffect(() => {
        setDeviceType(calculateDeviceType());

        const debouncedUpdate = debounce(() => {
            setDeviceType(calculateDeviceType());
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
    return isMobileOrTablet;
}

export { BREAKPOINTS };
