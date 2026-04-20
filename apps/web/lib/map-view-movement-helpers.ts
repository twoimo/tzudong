export function shouldCenterSelectedRestaurant({
    lastCenteredRestaurantId,
    selectedRestaurantId,
}: {
    lastCenteredRestaurantId: string | null;
    selectedRestaurantId: string;
}) {
    return lastCenteredRestaurantId !== selectedRestaurantId;
}

export function resolveMapViewSelectedPanTarget({
    boundsNorthEastLng,
    boundsSouthWestLng,
    lng,
    mapWidth,
    panelWidth,
    sidebarWidth,
}: {
    boundsNorthEastLng: number;
    boundsSouthWestLng: number;
    lng: number;
    mapWidth: number;
    panelWidth: number;
    sidebarWidth: number;
}) {
    const lngSpan = boundsNorthEastLng - boundsSouthWestLng;
    const usableWidth = Math.max(mapWidth - sidebarWidth, 1);
    const lngPerPixel = lngSpan / usableWidth;
    const horizontalShiftPx = panelWidth / 2;

    return lng + (lngPerPixel * horizontalShiftPx);
}
