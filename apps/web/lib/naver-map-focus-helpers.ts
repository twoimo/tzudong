export function focusNaverMapOnRestaurant<TLatLng>({
    createLatLng,
    lat,
    lng,
    map,
    zoom,
}: {
    createLatLng: (lat: number, lng: number) => TLatLng;
    lat: number | null | undefined;
    lng: number | null | undefined;
    map: {
        setCenter: (value: TLatLng) => void;
        setZoom: (value: number) => void;
    } | null;
    zoom: number;
}) {
    if (!map || !lat || !lng) {
        return false;
    }

    map.setZoom(zoom);
    map.setCenter(createLatLng(lat, lng));
    return true;
}
