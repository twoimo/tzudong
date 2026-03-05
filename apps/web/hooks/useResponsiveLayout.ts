'use client';

import { useMemo } from 'react';
import { useDeviceType } from './useDeviceType';

type LayoutSpacing = 'compact' | 'normal';
type GapSize = LayoutSpacing | 'wide';
type CardSize = 'sm' | 'md' | 'lg';

type ResponsiveLayout = {
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isMobileOrTablet: boolean;
    gridCols: number;
    spacing: LayoutSpacing;
    showLabels: boolean;
    cardSize: CardSize;
};

/**
 * 반응형 레이아웃 정보를 제공하는 훅
 * 화면 크기에 따라 그리드 컬럼 수, 간격, 레이블 표시 여부 등을 반환합니다.
 */
export function useResponsiveLayout(): ResponsiveLayout {
    const { isMobile, isTablet, isDesktop, isMobileOrTablet } = useDeviceType();

    const layout = useMemo(() => {
        // 그리드 컬럼 수
        let gridCols = 4;
        if (isMobile) gridCols = 2;
        else if (isTablet) gridCols = 3;

        // 간격
        const spacing: LayoutSpacing = isMobile ? 'compact' : 'normal';

        // 라벨 표시 여부
        const showLabels = !isMobile;

        // 카드 크기
        const cardSize: CardSize = isMobile ? 'sm' : isTablet ? 'md' : 'lg';

        return {
            isMobile,
            isTablet,
            isDesktop,
            isMobileOrTablet,
            gridCols,
            spacing,
            showLabels,
            cardSize,
        };
    }, [isMobile, isTablet, isDesktop, isMobileOrTablet]);

    return layout;
}

function resolveGridClass(targetCols: number): string {
    // 모바일: 1-2열, 태블릿: 2-3열, 데스크탑: 3-5열
    if (targetCols === 1) return 'grid-cols-1';
    if (targetCols === 2) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2';
    if (targetCols === 3) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3';
    if (targetCols === 4) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
    if (targetCols === 5) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';
    return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
}

function resolveGapClass(targetSize: GapSize): string {
    if (targetSize === 'compact') return 'gap-3';
    if (targetSize === 'wide') return 'gap-6';
    return 'gap-3 md:gap-4'; // normal
}

/**
 * Tailwind CSS 그리드 클래스를 반환하는 유틸리티 함수
 */
export function getGridClass(cols?: number): string {
    return resolveGridClass(cols ?? 4);
}

/**
 * Tailwind CSS 간격 클래스를 반환하는 유틸리티 함수
 */
export function getGapClass(size?: GapSize): string {
    return resolveGapClass(size ?? 'normal');
}

export function useResponsiveGridClass(cols?: number): string {
    const { gridCols } = useResponsiveLayout();
    return useMemo(() => resolveGridClass(cols ?? gridCols), [cols, gridCols]);
}

export function useResponsiveGapClass(size?: GapSize): string {
    const { spacing } = useResponsiveLayout();
    return useMemo(() => resolveGapClass(size ?? spacing), [size, spacing]);
}
