import type { Restaurant } from '@/types/restaurant';

export function getRestaurantLatLng(restaurant: Pick<Restaurant, 'lat' | 'lng'> | null | undefined) {
    if (!restaurant) return null;

    const lat = Number(restaurant.lat);
    const lng = Number(restaurant.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return null;
    }

    return { lat, lng };
}

export function buildGoogleMapOptions({
    center,
    zoom,
}: {
    center: { lat: number; lng: number };
    zoom: number;
}) {
    return {
        center,
        zoom,
        mapId: 'tzudong-map',
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
    } as const;
}
