export function resolveNaverResizeOffsets({
    effectivePanelOffset,
    isMobileOrTablet,
    mobileVerticalOffset,
}: {
    effectivePanelOffset: number;
    isMobileOrTablet: boolean;
    mobileVerticalOffset: number;
}): { targetOffsetX: number; targetOffsetY: number } {
    return {
        targetOffsetX: effectivePanelOffset / 2,
        targetOffsetY: isMobileOrTablet ? mobileVerticalOffset : 0,
    };
}
