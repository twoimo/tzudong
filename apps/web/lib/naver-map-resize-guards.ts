export function shouldSkipNaverResizeRecenter({
    hasUserMoved,
    isGridMode,
    skipTarget,
}: {
    hasUserMoved: boolean;
    isGridMode: boolean;
    skipTarget: boolean;
}) {
    return isGridMode || hasUserMoved || skipTarget;
}
