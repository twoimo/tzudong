import type { Restaurant } from '@/types/restaurant';
import { SEOUL_DISTRICT_CENTERS, getDistance } from '@/lib/clustering';

export interface ExtendedBounds {
    south: number;
    north: number;
    west: number;
    east: number;
}

type NaverLatLngLike = {
    lat: () => number;
    lng: () => number;
};

type NaverBoundsLike = {
    getSW: () => NaverLatLngLike;
    getNE: () => NaverLatLngLike;
};

type NaverMapBoundsLike = {
    getBounds: () => NaverBoundsLike | null;
};

const VIEWPORT_PADDING = 0.25;

export const isPointInSeoul = (lat: number, lng: number) => {
    if (lat < 37.42 || lat > 37.70 || lng < 126.76 || lng > 127.18) {
        return false;
    }

    for (const center of Object.values(SEOUL_DISTRICT_CENTERS)) {
        if (getDistance(lat, lng, center.lat, center.lng) < 0.035) {
            return true;
        }
    }

    return false;
};

export const fillExtendedBounds = (
    map: NaverMapBoundsLike | null,
    padding: number,
    target: ExtendedBounds,
): boolean => {
    if (!map) return false;

    let bounds: NaverBoundsLike | null = null;
    try {
        bounds = map.getBounds();
    } catch {
        return false;
    }

    if (!bounds || typeof bounds.getSW !== 'function') return false;

    let sw: NaverLatLngLike;
    let ne: NaverLatLngLike;
    try {
        sw = bounds.getSW();
        ne = bounds.getNE();
    } catch {
        return false;
    }
    const latDiff = ne.lat() - sw.lat();
    const lngDiff = ne.lng() - sw.lng();

    target.south = sw.lat() - latDiff * padding;
    target.north = ne.lat() + latDiff * padding;
    target.west = sw.lng() - lngDiff * padding;
    target.east = ne.lng() + lngDiff * padding;
    return true;
};

export const getExtendedBounds = (
    map: NaverMapBoundsLike | null,
    padding: number = VIEWPORT_PADDING,
): ExtendedBounds | null => {
    const target: ExtendedBounds = { south: 0, north: 0, west: 0, east: 0 };
    return fillExtendedBounds(map, padding, target) ? target : null;
};

export const isRestaurantInViewport = (
    restaurant: Pick<Restaurant, 'lat' | 'lng'>,
    extendedBounds: ExtendedBounds | null,
): boolean => {
    if (!extendedBounds || !restaurant.lat || !restaurant.lng) return true;

    const { south, north, west, east } = extendedBounds;
    return restaurant.lat >= south && restaurant.lat <= north && restaurant.lng >= west && restaurant.lng <= east;
};

export const getPrimaryCategory = (restaurant: Pick<Restaurant, 'categories' | 'category'>): string => {
    if (Array.isArray(restaurant.categories) && restaurant.categories.length > 0) {
        return restaurant.categories[0] ?? '기타';
    }
    if (Array.isArray(restaurant.category) && restaurant.category.length > 0) {
        return restaurant.category[0] ?? '기타';
    }
    return '기타';
};
