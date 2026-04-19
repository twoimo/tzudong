import type { CSSProperties } from 'react';

const MOBILE_BADGE_POSITION_CLASS =
    'absolute top-[calc(env(safe-area-inset-top)+124px)] -translate-x-1/2 transition-[left] duration-300 ease-in-out z-[61]';
const DESKTOP_BADGE_POSITION_CLASS =
    'absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out';
const MOBILE_TOAST_POSITION_CLASS =
    'absolute top-[calc(env(safe-area-inset-top)+124px)] -translate-x-1/2 transition-[left] ease-in-out z-[70]';
const DESKTOP_TOAST_POSITION_CLASS =
    'absolute top-4 -translate-x-1/2 transition-[left] ease-in-out';

export function getNaverOverlayPositioning({
    isExternalPanelOpen,
    isGridMode,
    isMobileOrTablet,
    isPanelCollapsed,
    isPanelOpen,
    isShrinkingLayout,
    panelWidth,
}: {
    isExternalPanelOpen: boolean;
    isGridMode: boolean;
    isMobileOrTablet: boolean;
    isPanelCollapsed: boolean;
    isPanelOpen: boolean;
    isShrinkingLayout: boolean;
    panelWidth: number;
}) {
    let effectivePanelOffset = 0;

    if (!isGridMode && !isMobileOrTablet && !isShrinkingLayout && !isPanelCollapsed && (isPanelOpen || isExternalPanelOpen)) {
        effectivePanelOffset = panelWidth;
    }

    return {
        effectivePanelOffset,
        centerOffsetStyle: {
            left: `calc(50% - ${effectivePanelOffset / 2}px)`,
        } satisfies CSSProperties,
        floatingBadgePositionClass: isMobileOrTablet
            ? MOBILE_BADGE_POSITION_CLASS
            : DESKTOP_BADGE_POSITION_CLASS,
        floatingToastPositionClass: isMobileOrTablet
            ? MOBILE_TOAST_POSITION_CLASS
            : DESKTOP_TOAST_POSITION_CLASS,
    };
}
