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

export function getNaverCurrentPanelOffset(currentState: { effectivePanelOffset: number }) {
    return currentState.effectivePanelOffset;
}
