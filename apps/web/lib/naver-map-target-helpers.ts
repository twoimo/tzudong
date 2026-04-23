import { REGION_MAP_CONFIG } from '@/config/maps';
import type { Region, Restaurant } from '@/types/restaurant';

export function resolveNaverMapTarget({
    currentMapZoom,
    getDeviceAdjustedZoom,
    mapFocusZoom,
    selectedRegion,
    selectedRestaurant,
    urlLat,
    urlLng,
    urlZoom,
}: {
    currentMapZoom: number;
    getDeviceAdjustedZoom: (baseZoom: number, isNational?: boolean) => number;
    mapFocusZoom?: number | null;
    selectedRegion: Region | null;
    selectedRestaurant: Restaurant | null;
    urlLat: number;
    urlLng: number;
    urlZoom: number;
}) {
    if (selectedRestaurant?.lat && selectedRestaurant?.lng) {
        return {
            skip: false,
            targetLat: selectedRestaurant.lat,
            targetLng: selectedRestaurant.lng,
            targetZoom: mapFocusZoom || currentMapZoom,
        } as const;
    }

    if (!Number.isNaN(urlLat) && !Number.isNaN(urlLng) && !Number.isNaN(urlZoom)) {
        return {
            skip: true,
        } as const;
    }

    const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : '전국';
    const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
    const isNational = regionKey === '전국';

    return {
        skip: false,
        targetLat: regionConfig.center[0],
        targetLng: regionConfig.center[1],
        targetZoom: getDeviceAdjustedZoom(regionConfig.zoom, isNational),
    } as const;
}
