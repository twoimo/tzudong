import { REGION_MAP_CONFIG } from '@/config/maps';
import type { Region, Restaurant } from '@/types/restaurant';

export function resolveNaverResizeTarget({
    selectedRegion,
    selectedRestaurant,
    urlLat,
    urlLng,
    urlZoom,
}: {
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
        } as const;
    }

    if (!Number.isNaN(urlLat) && !Number.isNaN(urlLng) && !Number.isNaN(urlZoom)) {
        return {
            skip: true,
        } as const;
    }

    const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : '전국';
    const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];

    return {
        skip: false,
        targetLat: regionConfig.center[0],
        targetLng: regionConfig.center[1],
    } as const;
}
