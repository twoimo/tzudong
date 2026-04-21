export function resolveNaverLayoutShiftDelta({
    effectiveOffset,
    previousOffset,
}: {
    effectiveOffset: number;
    previousOffset: number;
}) {
    const deltaOffset = effectiveOffset - previousOffset;

    return {
        deltaOffset,
        deltaX: deltaOffset / 2,
        shouldPan: deltaOffset !== 0,
    };
}

export function shouldPreserveNaverVisualCenterOnLayoutShift({
    hasUserMovedMap,
    isSelectionChanged,
}: {
    hasUserMovedMap: boolean;
    isSelectionChanged: boolean;
}) {
    return hasUserMovedMap && !isSelectionChanged;
}

export function resolveNaverCenteringTransitionResizePlan({
    delayMs = 320,
}: {
    delayMs?: number;
} = {}) {
    return {
        initialResizeEvent: 'resize',
        followupResizeDelayMs: delayMs,
        followupResizeEvent: 'resize',
    } as const;
}
