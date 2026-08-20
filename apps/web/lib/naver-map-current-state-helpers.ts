import { NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS } from '@/lib/naver-map-overlay-timings';

export function buildNaverCurrentStateSnapshot({
    effectivePanelOffset,
    externalPanelOpen,
    isGridMode,
    isPanelCollapsed,
    isSidebarOpen,
}: {
    effectivePanelOffset: number;
    externalPanelOpen?: boolean;
    isGridMode: boolean;
    isPanelCollapsed: boolean;
    isSidebarOpen: boolean;
}) {
    return {
        isSidebarOpen,
        externalPanelOpen,
        isPanelCollapsed,
        isGridMode,
        effectivePanelOffset,
    };
}

export function buildNaverInitialCurrentStateSnapshot({
    externalPanelOpen,
    isGridMode,
    isPanelCollapsed,
    isSidebarOpen,
}: {
    externalPanelOpen?: boolean;
    isGridMode: boolean;
    isPanelCollapsed: boolean;
    isSidebarOpen: boolean;
}) {
    return buildNaverCurrentStateSnapshot({
        effectivePanelOffset: 0,
        externalPanelOpen,
        isGridMode,
        isPanelCollapsed,
        isSidebarOpen,
    });
}

export function getNaverCurrentPanelOffset(currentState: { effectivePanelOffset: number }) {
    return currentState.effectivePanelOffset;
}

export function resolveNaverRestaurantCountUpdatePlan({
    hasAlreadyShownCount = false,
    hideDelayMs = NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS,
    settleDelayMs = 1200,
    isMobileOrTablet = false,
    isNoncriticalEffectsActive = true,
    isLoadingRestaurants,
    restaurantsLength,
}: {
    hasAlreadyShownCount?: boolean;
    hideDelayMs?: number;
    settleDelayMs?: number;
    isMobileOrTablet?: boolean;
    isNoncriticalEffectsActive?: boolean;
    isLoadingRestaurants: boolean;
    restaurantsLength: number;
}) {
    const hasData = restaurantsLength > 0 && !isLoadingRestaurants;
    // On mobile, wait until noncritical effects are active (search bar has rendered)
    // before showing the badge so it doesn't float at the top before the search bar.
    const isMobileReady = !isMobileOrTablet || isNoncriticalEffectsActive;
    // Once the badge has been shown for this query session, don't show again
    // (prevents 347 → 375 double-toast from progressive loading).
    const shouldShowRestaurantCount = hasData && isMobileReady && !hasAlreadyShownCount;

    return {
        hideDelayMs,
        settleDelayMs,
        shouldShowRestaurantCount,
        shouldStorePreviousRestaurants: hasData,
    } as const;
}
