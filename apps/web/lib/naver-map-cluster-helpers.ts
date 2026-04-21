export function getRegionalClusterTargetZoom(currentZoom: number) {
    return Math.min(currentZoom + 2, 9);
}

export function getSeoulDistrictTargetZoom(currentZoom: number) {
    if (currentZoom <= 10) return 11;
    if (currentZoom <= 12) return 13;
    return 13;
}

export function getSuperclusterTargetZoom(currentZoom: number, expansionZoom: number) {
    const nextZoom = expansionZoom <= currentZoom ? currentZoom + 2 : expansionZoom;
    return Math.max(nextZoom, 9);
}

export function shouldHideInSeoulDistrictMode({
    address,
    isPointInSeoul,
    shouldUseSeoulDistrictCluster,
}: {
    address?: string | null;
    isPointInSeoul: boolean;
    shouldUseSeoulDistrictCluster: boolean;
}) {
    if (!shouldUseSeoulDistrictCluster) return false;
    if (address) return address.includes('서울');
    return isPointInSeoul;
}

export type NaverClusterBbox = [number, number, number, number];

type NaverClusterBoundsLike = {
    getEast: () => number;
    getNorth: () => number;
    getSouth: () => number;
    getWest: () => number;
} | null | undefined;

type NaverClusterCenterLike = {
    lat: () => number;
    lng: () => number;
} | null | undefined;

export const KOREA_CLUSTER_BBOX: NaverClusterBbox = [124, 33, 132, 43];

export function quantizeNaverClusterZoom(zoom: number) {
    return Math.floor(zoom / 2) * 2;
}

export function resolveNaverClusterBoundsBbox(
    bounds: NaverClusterBoundsLike,
    fallbackBbox: NaverClusterBbox = KOREA_CLUSTER_BBOX,
): NaverClusterBbox {
    if (bounds && typeof bounds.getWest === 'function') {
        return [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
        ];
    }

    return [...fallbackBbox] as NaverClusterBbox;
}

export function resolveNaverClusterUpdateBbox({
    bounds,
    center,
    mapHeightPixels = 800,
    mapWidthPixels = 1000,
    zoom,
}: {
    bounds: NaverClusterBoundsLike;
    center: NaverClusterCenterLike;
    mapHeightPixels?: number;
    mapWidthPixels?: number;
    zoom: number;
}) {
    if (bounds && typeof bounds.getWest === 'function') {
        return {
            bbox: resolveNaverClusterBoundsBbox(bounds),
            shouldSkip: false,
            shouldWarnMissingCenter: false,
        } as const;
    }

    if (!center) {
        return {
            bbox: null,
            shouldSkip: true,
            shouldWarnMissingCenter: true,
        } as const;
    }

    const centerLat = center.lat();
    const centerLng = center.lng();
    const latitudeCosine = Math.cos(centerLat * Math.PI / 180);
    const metersPerPixelAtZoom = 156543.03392 * latitudeCosine / Math.pow(2, zoom);
    const metersWidth = metersPerPixelAtZoom * mapWidthPixels;
    const metersHeight = metersPerPixelAtZoom * mapHeightPixels;
    const latDelta = (metersHeight / 2) / 111000;
    const lngDelta = (metersWidth / 2) / (111000 * latitudeCosine);

    return {
        bbox: [
            centerLng - lngDelta,
            centerLat - latDelta,
            centerLng + lngDelta,
            centerLat + latDelta,
        ] as NaverClusterBbox,
        shouldSkip: false,
        shouldWarnMissingCenter: false,
    } as const;
}

