export function calculateNaverMobileVerticalOffset({
    fineTunePx,
    navHeight,
    sheetHeightPercent,
    viewportHeight,
}: {
    fineTunePx: number;
    navHeight: number;
    sheetHeightPercent: number;
    viewportHeight: number;
}) {
    const clampedSheetHeightPercent = Math.max(0, Math.min(100, sheetHeightPercent));
    const sheetHeightPx = (clampedSheetHeightPercent / 100) * viewportHeight;

    return (sheetHeightPx / 2) + (navHeight / 2) + fineTunePx;
}
