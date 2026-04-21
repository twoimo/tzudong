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

export function resolveNaverInitialView({
    defaultZoom,
    hasValidUrlState,
    regionCenter,
    urlLat,
    urlLng,
    urlZoom,
}: {
    defaultZoom: number;
    hasValidUrlState: boolean;
    regionCenter: readonly [number, number];
    urlLat: number;
    urlLng: number;
    urlZoom?: number;
}) {
    return {
        initialCenter: hasValidUrlState ? [urlLat, urlLng] as const : regionCenter,
        initialZoom: hasValidUrlState ? urlZoom! : defaultZoom,
    };
}

export function resolveNaverInitialMapView({
    getDeviceAdjustedZoom,
    search,
    selectedRegion,
}: {
    getDeviceAdjustedZoom: (baseZoom: number, isNational?: boolean) => number;
    search: string;
    selectedRegion: Region | null | undefined;
}) {
    const { hasValidUrlState, urlLat, urlLng, urlZoom } = parseNaverMapUrlState(search);
    const { regionConfig, isNational } = resolveNaverRegionConfig(selectedRegion);
    const defaultZoom = getDeviceAdjustedZoom(regionConfig.zoom, isNational);

    return {
        ...resolveNaverInitialView({
            defaultZoom,
            hasValidUrlState,
            regionCenter: regionConfig.center,
            urlLat,
            urlLng,
            urlZoom,
        }),
        defaultZoom,
        hasValidUrlState,
        isNational,
        regionConfig,
        urlLat,
        urlLng,
        urlZoom,
    };
}

export function buildNaverMapOptions({
    center,
    positionTopLeft,
    positionTopRight,
    zoom,
}: {
    center: unknown;
    positionTopLeft: unknown;
    positionTopRight: unknown;
    zoom: number;
}) {
    return {
        center,
        zoom,
        minZoom: 6,
        maxZoom: 18,
        zoomControl: false,
        zoomControlOptions: {
            position: positionTopRight,
        },
        mapTypeControl: false,
        mapTypeControlOptions: {
            position: positionTopLeft,
        },
        scaleControl: false,
        background: '#f5f5f5',
        tileSpare: 3,
        tileTransition: true,
        scrollWheel: false,
        pinchZoom: true,
        draggable: true,
        keyboardShortcuts: true,
    };
}

type NaverMapInstanceHealthCheck = {
    getCenter?: () => unknown;
};

type NaverMapElementHealthCheck = {
    children: { length: number };
    getBoundingClientRect: () => { height: number; width: number };
    querySelector: (selector: string) => unknown;
};

export function isNaverMapInstanceReusable({
    mapElement,
    mapInstance,
}: {
    mapElement: NaverMapElementHealthCheck | null | undefined;
    mapInstance: NaverMapInstanceHealthCheck | null | undefined;
}) {
    if (!mapInstance || !mapElement) return false;

    try {
        const center = mapInstance.getCenter?.();
        if (!center) return false;

        const hasMapContent =
            mapElement.querySelector('[class*="naver"]') !== null ||
            mapElement.children.length > 0;
        if (!hasMapContent) return false;

        const rect = mapElement.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    } catch {
        return false;
    }
}

export function scheduleNaverInitialIdleTrigger<TMap>({
    delayMs = 100,
    map,
    setTimeoutFn = setTimeout,
    triggerIdle,
}: {
    delayMs?: number;
    map: TMap | null;
    setTimeoutFn?: typeof setTimeout;
    triggerIdle: (map: TMap) => void;
}) {
    return setTimeoutFn(() => {
        if (map) {
            triggerIdle(map);
        }
    }, delayMs);
}
