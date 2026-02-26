'use client';

import { useMemo } from 'react';
import { useDeviceType } from './useDeviceType';

/**
 * 반응형 레이아웃 정보를 제공하는 훅
 * 화면 크기에 따라 그리드 컬럼 수, 간격, 레이블 표시 여부 등을 반환합니다.
 */
export function useResponsiveLayout() {
    const { isMobile, isTablet, isDesktop, isMobileOrTablet } = useDeviceType();

    const layout = useMemo(() => {
        // 그리드 컬럼 수
        let gridCols = 4;
        if (isMobile) gridCols = 2;
        else if (isTablet) gridCols = 3;

        // 간격
        const spacing = isMobile ? 'compact' : 'normal';

        // 라벨 표시 여부
        const showLabels = !isMobile;

        // 카드 크기
        const cardSize = isMobile ? 'sm' : isTablet ? 'md' : 'lg';

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

/**
 * Tailwind CSS 그리드 클래스를 반환하는 유틸리티 함수
 */
export function getGridClass(cols?: number): string {
    const { gridCols } = useResponsiveLayout();
    const targetCols = cols ?? gridCols;

    // 모바일: 1-2열, 태블릿: 2-3열, 데스크탑: 3-5열
    if (targetCols === 1) return 'grid-cols-1';
    if (targetCols === 2) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2';
    if (targetCols === 3) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3';
    if (targetCols === 4) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
    if (targetCols === 5) return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

    return 'grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
}

/**
 * Tailwind CSS 간격 클래스를 반환하는 유틸리티 함수
 */
export function getGapClass(size?: 'compact' | 'normal' | 'wide'): string {
    const { spacing } = useResponsiveLayout();
    const targetSize = size ?? spacing;

    if (targetSize === 'compact') return 'gap-3';
    if (targetSize === 'wide') return 'gap-6';
    return 'gap-3 md:gap-4'; // normal
}
