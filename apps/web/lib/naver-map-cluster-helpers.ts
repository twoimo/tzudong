const DEFAULT_CLUSTER_DISABLE_ZOOM = 13;
const DEFAULT_MAX_MAP_ZOOM = 18;

function toFiniteZoom(value: number, fallback: number) {
    return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function getFirstQuantizedZoomAbove(clusterMaxZoom: number, maxMapZoom: number) {
    let candidate = Math.min(maxMapZoom, Math.floor(clusterMaxZoom) + 1);

    while (candidate < maxMapZoom && quantizeNaverClusterZoom(candidate) <= clusterMaxZoom) {
        candidate += 1;
    }

    return candidate;
}

export function getIndividualMarkerRevealZoom({
    currentZoom,
    clusterMaxZoom = DEFAULT_CLUSTER_DISABLE_ZOOM - 1,
    maxMapZoom = DEFAULT_MAX_MAP_ZOOM,
    minRevealZoom = DEFAULT_CLUSTER_DISABLE_ZOOM,
}: {
    currentZoom: number;
    clusterMaxZoom?: number;
    maxMapZoom?: number;
    minRevealZoom?: number;
}) {
    const safeCurrentZoom = toFiniteZoom(currentZoom, minRevealZoom - 1);
    const safeClusterMaxZoom = toFiniteZoom(clusterMaxZoom, DEFAULT_CLUSTER_DISABLE_ZOOM - 1);
    const quantizedRevealZoom = getFirstQuantizedZoomAbove(safeClusterMaxZoom, maxMapZoom);

    return Math.min(
        maxMapZoom,
        Math.max(
            safeCurrentZoom + 1,
            safeClusterMaxZoom + 1,
            quantizedRevealZoom,
            minRevealZoom,
        ),
    );
}

export function getRegionalClusterTargetZoom(currentZoom: number, clusterMaxZoom?: number) {
    return getIndividualMarkerRevealZoom({ currentZoom, clusterMaxZoom });
}

export function getSeoulDistrictTargetZoom(currentZoom: number, clusterMaxZoom?: number) {
    return getIndividualMarkerRevealZoom({ currentZoom, clusterMaxZoom });
}

export function getSuperclusterTargetZoom(currentZoom: number, expansionZoom: number, clusterMaxZoom?: number) {
    const revealZoom = getIndividualMarkerRevealZoom({ currentZoom, clusterMaxZoom });
    return Math.min(DEFAULT_MAX_MAP_ZOOM, Math.max(expansionZoom, revealZoom));
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
