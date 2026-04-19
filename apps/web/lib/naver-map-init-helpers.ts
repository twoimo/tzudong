import { REGION_MAP_CONFIG } from '@/config/maps';
import type { Region } from '@/types/restaurant';

export function getDeviceAdjustedZoom(
    baseZoom: number,
    isMobileOrTablet: boolean,
    isNational = false,
) {
    if (isNational) return baseZoom;
    return isMobileOrTablet ? Math.max(baseZoom - 2, 6) : baseZoom;
}

export function parseNaverMapUrlState(search: string) {
    const params = new URLSearchParams(search);
    const zParam = params.get('z');
    const cParam = params.get('c');
    const urlLat = parseFloat(params.get('lat') || '');
    const urlLng = parseFloat(params.get('lng') || '');

    let urlZoom: number | undefined;
    if (zParam) {
        urlZoom = parseFloat(zParam);
    } else if (cParam) {
        urlZoom = parseFloat(cParam.split(',')[0]);
    }

    const hasValidUrlState = Boolean(urlZoom && !isNaN(urlZoom) && !isNaN(urlLat) && !isNaN(urlLng));

    return {
        hasValidUrlState,
        urlLat,
        urlLng,
        urlZoom,
    };
}

export function resolveNaverRegionConfig(selectedRegion: Region | null | undefined) {
    const regionKey = selectedRegion && selectedRegion in REGION_MAP_CONFIG ? selectedRegion : '전국';
    const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
    const isNational = regionKey === '전국';

    return {
        isNational,
        regionConfig,
        regionKey,
    };
}
