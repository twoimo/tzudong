export const MOBILE_SHEET_PEEK_DISMISS_DISTANCE_PX = 56;

type ShouldDismissSheetFromPeekArgs = {
    startedAtPeek: boolean;
    dragDistancePx: number;
    gestureVelocity: number;
    minDistancePx?: number;
    minVelocityPxPerMs?: number;
};

export function shouldDismissSheetFromPeek({
    startedAtPeek,
    dragDistancePx,
    gestureVelocity,
    minDistancePx = MOBILE_SHEET_PEEK_DISMISS_DISTANCE_PX,
    minVelocityPxPerMs,
}: ShouldDismissSheetFromPeekArgs) {
    if (!startedAtPeek || dragDistancePx <= 0) return false;
    if (dragDistancePx >= minDistancePx) return true;
    return minVelocityPxPerMs !== undefined && gestureVelocity >= minVelocityPxPerMs;
}
