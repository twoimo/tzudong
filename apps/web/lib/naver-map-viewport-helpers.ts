export function getNaverViewportOffset({
    externalPanelOpen,
    internalPanelOpen,
    isGridMode,
    isMobileOrTablet,
    isPanelCollapsed,
    onMarkerClick,
    panelWidth,
    propIsPanelOpen,
}: {
    externalPanelOpen?: boolean;
    internalPanelOpen: boolean;
    isGridMode: boolean;
    isMobileOrTablet: boolean;
    isPanelCollapsed: boolean;
    onMarkerClick?: (...args: any[]) => void;
    panelWidth: number;
    propIsPanelOpen?: boolean;
}) {
    if (isMobileOrTablet) return 0;

    const isInternalMode = !onMarkerClick;
    const isShrinkingLayout = isInternalMode && internalPanelOpen && !isGridMode;
    if (isShrinkingLayout) return 0;

    if (isPanelCollapsed) return 0;
    if (!(propIsPanelOpen ?? false) && externalPanelOpen !== false) return 0;

    return panelWidth;
}
