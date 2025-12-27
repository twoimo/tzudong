'use client';

import { useState, useEffect, useCallback } from 'react';

// 브레이크포인트 정의 (가로/세로 모드 고려)
const BREAKPOINTS = {
    mobilePortrait: 480,    // 모바일 세로: 480px 이하
    mobileLandscape: 667,   // 모바일 가로 또는 작은 태블릿: 667px 이하
    tabletPortrait: 834,    // 태블릿 세로: 834px 이하
    tabletLandscape: 1024,  // 태블릿 가로: 1024px 이하
} as const;

export interface DeviceType {
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isMobileOrTablet: boolean;
    isLandscape: boolean;
}

// [OPTIMIZATION] debounce 함수 - 과도한 상태 업데이트 방지
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
    let timeoutId: ReturnType<typeof setTimeout>;
    return ((...args: any[]) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    }) as T;
}

/**
 * 디바이스 타입을 감지하는 커스텀 훅
 * [OPTIMIZATION] debounce로 resize 이벤트 최적화, useCallback으로 메모이제이션
 */
export function useDeviceType(): DeviceType {
    const [deviceType, setDeviceType] = useState<DeviceType>({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isMobileOrTablet: false,
        isLandscape: false,
    });

    // [OPTIMIZATION] 계산 로직을 useCallback으로 메모이제이션
    const calculateDeviceType = useCallback(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isLandscape = width > height;

        // 터치 지원 여부 감지
        const isTouchDevice = 'ontouchstart' in window ||
            navigator.maxTouchPoints > 0 ||
            (navigator as any).msMaxTouchPoints > 0;

        // 모바일: 480px 이하 또는 가로모드에서 667x480 이하
        const isMobile = width <= BREAKPOINTS.mobilePortrait ||
            (isLandscape && width <= BREAKPOINTS.mobileLandscape && height <= BREAKPOINTS.mobilePortrait);

        // 태블릿: 모바일이 아니면서 터치 지원 또는 1920px 미만
        // 터치 디바이스이고 1920px 미만이면 태블릿으로 간주
        const isTablet = !isMobile && (
            (isTouchDevice && width < 1920) ||  // 터치 디바이스 + 1920px 미만
            (!isTouchDevice && width <= 1366)    // 비터치 디바이스는 기존 로직
        );

        const isDesktop = !isMobile && !isTablet;

        return {
            isMobile,
            isTablet,
            isDesktop,
            isMobileOrTablet: isMobile || isTablet,
            isLandscape,
        };
    }, []);

    useEffect(() => {
        // 초기 값 즉시 설정
        setDeviceType(calculateDeviceType());

        // [OPTIMIZATION] 50ms debounce로 resize 이벤트 최적화
        const debouncedUpdate = debounce(() => {
            setDeviceType(calculateDeviceType());
        }, 50);

        window.addEventListener('resize', debouncedUpdate);
        window.addEventListener('orientationchange', debouncedUpdate);

        return () => {
            window.removeEventListener('resize', debouncedUpdate);
            window.removeEventListener('orientationchange', debouncedUpdate);
        };
    }, [calculateDeviceType]);

    return deviceType;
}

/**
 * 기존 useIsMobile 훅과의 호환성을 위해 내보내기
 */
export function useIsMobile(): boolean {
    const { isMobileOrTablet } = useDeviceType();
    return isMobileOrTablet;
}

export { BREAKPOINTS };
