const DEFAULT_CLUSTER_DISABLE_ZOOM = 13;
const DEFAULT_MAX_MAP_ZOOM = 18;

type IslandClusterViewport = {
    aliases: string[];
    bounds: {
        south: number;
        west: number;
        north: number;
        east: number;
    };
    center: {
        lat: number;
        lng: number;
    };
    maxZoom: number;
};

type IslandRestaurantCandidate = {
    lat?: number | null;
    lng?: number | null;
    road_address?: string | null;
    jibun_address?: string | null;
    address?: string | null;
};

export const NAVER_ISLAND_CLUSTER_VIEWPORTS: Record<string, IslandClusterViewport> = {
    제주특별자치도: {
        aliases: ['제주특별자치도', '제주도', '제주'],
        bounds: { south: 33.06, west: 126.08, north: 33.64, east: 126.98 },
        center: { lat: 33.3625, lng: 126.5339 },
        maxZoom: 10,
    },
    울릉도: {
        aliases: ['울릉도', '울릉'],
        bounds: { south: 37.43, west: 130.77, north: 37.56, east: 130.94 },
        center: { lat: 37.4918, lng: 130.8616 },
        maxZoom: 12,
    },
    욕지도: {
        aliases: ['욕지도', '욕지'],
        bounds: { south: 34.60, west: 128.22, north: 34.67, east: 128.32 },
        center: { lat: 34.6354, lng: 128.2661 },
        maxZoom: 13,
    },
};

const getIslandRestaurantAddress = (restaurant: IslandRestaurantCandidate) =>
    [
        restaurant.road_address,
        restaurant.jibun_address,
        restaurant.address,
    ].filter(Boolean).join(' ');

const isCoordinateInsideIslandViewport = (
    restaurant: IslandRestaurantCandidate,
    viewport: IslandClusterViewport,
) => {
    if (typeof restaurant.lat !== 'number' || typeof restaurant.lng !== 'number') return false;

    return (
        restaurant.lat >= viewport.bounds.south &&
        restaurant.lat <= viewport.bounds.north &&
        restaurant.lng >= viewport.bounds.west &&
        restaurant.lng <= viewport.bounds.east
    );
};

const isRestaurantInIslandViewport = (
    restaurant: IslandRestaurantCandidate,
    viewport: IslandClusterViewport,
) => {
    const address = getIslandRestaurantAddress(restaurant);
    return viewport.aliases.some((alias) => address.includes(alias)) ||
        isCoordinateInsideIslandViewport(restaurant, viewport);
};

export function resolveNaverIslandClusterViewportByRegion(region: string | null | undefined) {
    if (!region) return null;

    return Object.values(NAVER_ISLAND_CLUSTER_VIEWPORTS).find((viewport) =>
        viewport.aliases.some((alias) => region.includes(alias))
    ) ?? null;
}

export function resolveNaverIslandClusterViewportForRestaurants(
    restaurants: IslandRestaurantCandidate[],
) {
    if (restaurants.length === 0) return null;

    return Object.values(NAVER_ISLAND_CLUSTER_VIEWPORTS).find((viewport) =>
        restaurants.every((restaurant) => isRestaurantInIslandViewport(restaurant, viewport))
    ) ?? null;
}

export function resolveNaverIslandFitBoundsOptions({
    isMobileOrTablet,
    maxZoom,
    viewportOffset,
}: {
    isMobileOrTablet: boolean;
    maxZoom: number;
    viewportOffset: number;
}) {
    const horizontalMargin = isMobileOrTablet ? 48 : 72;
    const verticalMargin = isMobileOrTablet ? 80 : 72;

    return {
        top: verticalMargin,
        right: horizontalMargin,
        bottom: isMobileOrTablet ? 168 : verticalMargin,
        left: horizontalMargin + Math.max(0, Math.ceil(viewportOffset)),
        maxZoom,
    };
}

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
