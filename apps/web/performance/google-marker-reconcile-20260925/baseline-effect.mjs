import { getRestaurantLatLng } from '../../lib/map-view-google-helpers';
import { getMapViewMarkerIcon } from '../../lib/map-view-helpers';
import { buildMapViewMarkerHtml, getMapViewMarkerSize, isMapViewMarkerSelected } from '../../lib/map-view-marker-helpers';
export function baselineUpdate({ previous, restaurants, Marker, map, onActivate }) {
    const markersRef = { current: previous }, restaurantsToShow = restaurants;
    const googleMapRef = { current: map }, isLoaded = true;
    const google = { maps: { marker: { AdvancedMarkerElement: Marker } } };
    const searchedRestaurant = null, selectedRestaurant = null;
    const onMarkerClick = onActivate, onRestaurantSelect = undefined;
    const moveToRestaurant = () => { }, setHasGoogleRuntimeError = () => { };
    if (!googleMapRef.current || !isLoaded)
        return;
    // 기존 마커 제거 (메모리 누수 방지)
    markersRef.current.forEach(({ marker }) => {
        marker.map = null;
    });
    markersRef.current = [];
    const markerConstructor = google.maps.marker?.AdvancedMarkerElement;
    if (!markerConstructor) {
        console.warn('MapView: Advanced marker support unavailable');
        setHasGoogleRuntimeError(true);
        return;
    }
    // 새 마커 생성
    restaurantsToShow.forEach((restaurant) => {
        const position = getRestaurantLatLng(restaurant);
        if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
            console.warn('MapView: marker skipped because restaurant coordinates are invalid', { restaurantId: restaurant.id });
            return;
        }
        const isSelected = isMapViewMarkerSelected({
            restaurantId: restaurant.id,
            searchedRestaurantId: searchedRestaurant?.id,
            selectedRestaurantId: selectedRestaurant?.id,
        });
        const imagePath = getMapViewMarkerIcon(restaurant.categories);
        const markerSize = getMapViewMarkerSize(isSelected);
        const markerElement = document.createElement("div");
        markerElement.className = `custom-marker ${isSelected ? 'selected-marker' : ''}`;
        markerElement.innerHTML = buildMapViewMarkerHtml({
            imagePath,
            isSelected,
            markerSize,
            name: restaurant.name,
        });
        let marker;
        try {
            marker = new markerConstructor({
                map: googleMapRef.current,
                position,
                content: markerElement,
                title: restaurant.name,
            });
        }
        catch {
            console.warn('MapView: Advanced marker creation skipped', { restaurantId: restaurant.id });
            return;
        }
        markerElement.addEventListener("click", () => {
            // 1. 패널을 먼저 즉시 열기 (지도 이동 전에)
            onMarkerClick?.(restaurant);
            // 2. selectedRestaurant 업데이트
            onRestaurantSelect?.(restaurant);
            // 3. 지도 이동은 마지막에 (비동기 작업)
            moveToRestaurant(restaurant);
        });
        markersRef.current.push({ marker, restaurantId: restaurant.id });
    });
    return markersRef.current;
}
