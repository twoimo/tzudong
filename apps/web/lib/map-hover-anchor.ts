export type OffsetPoint = {
    x: number;
    y: number;
};

export type GeoPoint = {
    lat: number;
    lng: number;
};

export type HoverAnchorProjection = {
    fromCoordToOffset: (coord: GeoPoint) => OffsetPoint;
    fromOffsetToCoord: (offset: OffsetPoint) => GeoPoint;
};

/**
 * 줌 이후에도 "줌 전 마우스 아래 좌표(anchorCoordBeforeZoom)"가
 * 동일한 화면 픽셀(mouseOffset)에 남도록 중심 좌표를 계산합니다.
 */
export const calculateHoverAnchoredCenter = ({
    projection,
    anchorCoordBeforeZoom,
    currentCenter,
    mouseOffset,
}: {
    projection: HoverAnchorProjection;
    anchorCoordBeforeZoom: GeoPoint;
    currentCenter: GeoPoint;
    mouseOffset: OffsetPoint;
}): GeoPoint => {
    const anchorOffsetAfterZoom = projection.fromCoordToOffset(anchorCoordBeforeZoom);
    const centerOffset = projection.fromCoordToOffset(currentCenter);

    const deltaX = mouseOffset.x - anchorOffsetAfterZoom.x;
    const deltaY = mouseOffset.y - anchorOffsetAfterZoom.y;

    return projection.fromOffsetToCoord({
        x: centerOffset.x - deltaX,
        y: centerOffset.y - deltaY,
    });
};
