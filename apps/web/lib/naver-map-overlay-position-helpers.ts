import type { CSSProperties } from 'react';

const MOBILE_MAP_STATUS_BADGE_STACK_OFFSET_CLASS =
    'top-[calc(env(safe-area-inset-top)_+_114px)]';
const MOBILE_BADGE_POSITION_CLASS =
    `mobile-map-status-badge fixed ${MOBILE_MAP_STATUS_BADGE_STACK_OFFSET_CLASS} left-1/2 -translate-x-1/2 transition-[left] duration-300 ease-in-out z-[70]`;
const DESKTOP_BADGE_POSITION_CLASS =
    'absolute top-4 -translate-x-1/2 transition-[left] duration-300 ease-in-out';
const MOBILE_TOAST_POSITION_CLASS =
    'fixed right-3 bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))_+_env(safe-area-inset-bottom)_+_0.75rem)] transition-[right,bottom] ease-in-out z-[70]';
const DESKTOP_TOAST_POSITION_CLASS =
    'absolute right-4 bottom-4 transition-[right,bottom] ease-in-out';

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
