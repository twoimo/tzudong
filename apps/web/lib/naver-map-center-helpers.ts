type PointLike = { x: number; y: number };
type LatLngLike = { lat: () => number; lng: () => number };

export function calculateNaverAdjustedCenter<TPoint extends PointLike, TLatLng extends LatLngLike>({
    centerLat,
    centerLng,
    currentZoom,
    targetZoom,
    offsetX,
    offsetY = 0,
    projection,
    createLatLng,
    createPoint,
}: {
    centerLat: number;
    centerLng: number;
    currentZoom: number;
    targetZoom: number;
    offsetX: number;
    offsetY?: number;
    projection: {
        fromCoordToOffset: (coord: TLatLng) => TPoint;
        fromOffsetToCoord: (offset: TPoint) => TLatLng;
    };
    createLatLng: (lat: number, lng: number) => TLatLng;
    createPoint: (x: number, y: number) => TPoint;
}) {
    const centerLatLng = createLatLng(centerLat, centerLng);
    const centerPoint = projection.fromCoordToOffset(centerLatLng);
    const offsetPoint = createPoint(centerPoint.x + offsetX, centerPoint.y + offsetY);
    const offsetCenterLatLng = projection.fromOffsetToCoord(offsetPoint);

    const dLat = offsetCenterLatLng.lat() - centerLatLng.lat();
    const dLng = offsetCenterLatLng.lng() - centerLatLng.lng();
    const scale = Math.pow(2, currentZoom - targetZoom);

    return createLatLng(
        centerLatLng.lat() + dLat * scale,
        centerLatLng.lng() + dLng * scale,
    );
}
