export function resolveNaverResizeCenter<TCenter>({
    currentCenter,
    currentZoom,
    getAdjustedCenter,
    targetLat,
    targetLng,
    targetOffsetX,
    targetOffsetY,
}: {
    currentCenter: { lat: () => number; lng: () => number };
    currentZoom: number;
    getAdjustedCenter: (
        lat: number,
        lng: number,
        targetZoom: number,
        offsetX: number,
        offsetY?: number,
    ) => TCenter;
    targetLat?: number;
    targetLng?: number;
    targetOffsetX: number;
    targetOffsetY: number;
}) {
    return getAdjustedCenter(
        targetLat ?? currentCenter.lat(),
        targetLng ?? currentCenter.lng(),
        currentZoom,
        targetOffsetX,
        targetOffsetY,
    );
}
