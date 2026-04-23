export function getNaverPanelStateFlags({
    externalPanelOpen,
    internalPanelOpen,
    isGridMode,
    onMarkerClick,
}: {
    externalPanelOpen?: boolean;
    internalPanelOpen: boolean;
    isGridMode: boolean;
    onMarkerClick?: (...args: any[]) => void;
}) {
    const isInternalMode = !onMarkerClick;
    const isShrinkingLayout = isInternalMode && internalPanelOpen && !isGridMode;
    const isExternalPanelOpen = externalPanelOpen === false;

    return {
        isExternalPanelOpen,
        isInternalMode,
        isShrinkingLayout,
    };
}
