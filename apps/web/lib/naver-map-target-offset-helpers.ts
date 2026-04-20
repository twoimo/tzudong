export function resolveNaverTargetOffsets({
    effectiveOffset,
    isMobileOrTablet,
    mobileVerticalOffset,
}: {
    effectiveOffset: number;
    isMobileOrTablet: boolean;
    mobileVerticalOffset: number;
}) {
    return {
        targetOffsetX: effectiveOffset / 2,
        targetOffsetY: isMobileOrTablet ? mobileVerticalOffset : 0,
    };
}
