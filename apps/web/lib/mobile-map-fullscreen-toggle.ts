export type MobileMapBlankTapAction =
    | 'none'
    | 'collapse-to-peek'
    | 'enter-map-fullscreen'
    | 'restore-from-map-fullscreen';

export interface ResolveMobileMapBlankTapActionInput {
    isMobileOrTablet: boolean;
    isPanelOpen: boolean;
    hasPanelRestaurant: boolean;
    isMapFullscreen: boolean;
    sheetHeight: number;
    peekHeight: number;
    peekTolerance?: number;
}

/**
 * 빈 지도 탭을 바텀시트/지도 전체화면 상태 전이로 변환한다.
 *
 * 모바일 홈 UX는 "마커 선택 → 바텀시트 → 빈 지도 탭으로 단계적 지도 집중" 흐름을
 * 갖는다. 이 헬퍼는 React 상태와 지도 SDK 이벤트에서 독립적으로 동작을 고정한다.
 */
export function resolveMobileMapBlankTapAction({
    isMobileOrTablet,
    isPanelOpen,
    hasPanelRestaurant,
    isMapFullscreen,
    sheetHeight,
    peekHeight,
    peekTolerance = 0.75,
}: ResolveMobileMapBlankTapActionInput): MobileMapBlankTapAction {
    if (!isMobileOrTablet || !isPanelOpen || !hasPanelRestaurant) {
        return 'none';
    }

    if (isMapFullscreen) {
        return 'restore-from-map-fullscreen';
    }

    const isAtPeek = sheetHeight <= peekHeight + peekTolerance;
    if (isAtPeek) {
        return 'enter-map-fullscreen';
    }

    return 'collapse-to-peek';
}
