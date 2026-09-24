/**
 * Map marker rendering 가드 전용 순수 함수 집합.
 * 동일/동등한 뷰포트 시그니처일 때 마커 렌더링을 스킵해
 * 불필요한 마커 업데이트를 줄이기 위한 비교 유틸.
 */

interface RenderBoundsLike {
    south: number;
    west: number;
    north: number;
    east: number;
}

interface MarkerRenderKindEntry {
    id: string;
    kind: string | null | undefined;
    assetVersion?: string | null | undefined;
}

interface MarkerRenderSignatureInput {
    zoom: number;
    bounds: RenderBoundsLike | null;
    displayRestaurantIds: readonly string[];
    selectedRestaurantId: string | null;
    searchedRestaurantId?: string | null;
    isClusterMode: boolean;
    isRegionalClusterMode: boolean;
    isSeoulDistrictMode: boolean;
    markerKindEntries?: readonly MarkerRenderKindEntry[];
    markerLayerVersion?: string;
    showUserSubmittedMarkers?: boolean;
}

export interface MarkerRenderSignature {
    zoom: number;
    boundsSignature: string | null;
    displayRestaurantIdsSignature: string;
    selectedRestaurantId: string | null;
    searchedRestaurantId: string | null;
    modeSignature: string;
    markerLayerSignature: string;
}

const BOUNDS_PRECISION_DIGITS = 4;

function roundCoord(value: number): number {
    const factor = 10 ** BOUNDS_PRECISION_DIGITS;
    return Math.round(value * factor) / factor;
}

let lastBoundsSignature: string | null = null;
let lastBoundsSouth = Number.NaN;
let lastBoundsWest = Number.NaN;
let lastBoundsNorth = Number.NaN;
let lastBoundsEast = Number.NaN;

function makeBoundsSignature(bounds: RenderBoundsLike | null): string | null {
    if (!bounds) return null;

    const south = roundCoord(bounds.south);
    const west = roundCoord(bounds.west);
    const north = roundCoord(bounds.north);
    const east = roundCoord(bounds.east);
    if (
        south === lastBoundsSouth &&
        west === lastBoundsWest &&
        north === lastBoundsNorth &&
        east === lastBoundsEast &&
        lastBoundsSignature !== null
    ) {
        return lastBoundsSignature;
    }

    lastBoundsSouth = south;
    lastBoundsWest = west;
    lastBoundsNorth = north;
    lastBoundsEast = east;
    lastBoundsSignature = [south, west, north, east].join(',');
    return lastBoundsSignature;
}

const displayIdsSignatureCache = new WeakMap<readonly string[], string>();

function makeDisplayIdsSignature(ids: readonly string[]): string {
    const cached = displayIdsSignatureCache.get(ids);
    if (cached !== undefined) return cached;

    const signature = [...new Set(ids)]
        .filter(Boolean)
        .sort()
        .join("|");
    displayIdsSignatureCache.set(ids, signature);
    return signature;
}

function makeMarkerKindSignature(entries: readonly MarkerRenderKindEntry[] = []): string {
    if (entries.length === 0) return '';

    const latestById = new Map<string, MarkerRenderKindEntry>();

    entries.forEach((entry) => {
        if (!entry.id) return;
        latestById.set(entry.id, entry);
    });

    return Array.from(latestById.values())
        .map((entry) => [
            entry.id,
            entry.kind ?? 'category',
            entry.assetVersion ?? 'asset:default',
        ].join(":"))
        .sort()
        .join("|");
}

const MODE_SIGNATURES = ['000', '001', '010', '011', '100', '101', '110', '111'] as const;

function modeSignature(isClusterMode: boolean, isRegionalClusterMode: boolean, isSeoulDistrictMode: boolean) {
    return MODE_SIGNATURES[
        (isClusterMode ? 4 : 0) + (isRegionalClusterMode ? 2 : 0) + (isSeoulDistrictMode ? 1 : 0)
    ];
}

let lastMarkerLayerSignature = '';
let lastMarkerLayerShowUser = true;
let lastMarkerLayerVersion = '';
let lastMarkerLayerKinds = '';

function markerLayerSignature(
    showUserSubmittedMarkers: boolean | undefined,
    markerLayerVersion: string | undefined,
    markerKindEntries: readonly MarkerRenderKindEntry[] | undefined,
) {
    const showUser = showUserSubmittedMarkers ?? true;
    const version = markerLayerVersion ?? 'default';
    const kinds = makeMarkerKindSignature(markerKindEntries);
    if (
        showUser === lastMarkerLayerShowUser &&
        version === lastMarkerLayerVersion &&
        kinds === lastMarkerLayerKinds
    ) {
        return lastMarkerLayerSignature;
    }

    lastMarkerLayerShowUser = showUser;
    lastMarkerLayerVersion = version;
    lastMarkerLayerKinds = kinds;
    lastMarkerLayerSignature = `user-submitted:${showUser ? '1' : '0'};version:${version};${kinds}`;
    return lastMarkerLayerSignature;
}

export function buildMarkerRenderSignature(input: MarkerRenderSignatureInput): MarkerRenderSignature {
    return {
        zoom: input.zoom,
        boundsSignature: makeBoundsSignature(input.bounds),
        displayRestaurantIdsSignature: makeDisplayIdsSignature(input.displayRestaurantIds),
        selectedRestaurantId: input.selectedRestaurantId,
        searchedRestaurantId: input.searchedRestaurantId ?? null,
        modeSignature: modeSignature(input.isClusterMode, input.isRegionalClusterMode, input.isSeoulDistrictMode),
        markerLayerSignature: markerLayerSignature(
            input.showUserSubmittedMarkers,
            input.markerLayerVersion,
            input.markerKindEntries,
        ),
    };
}

export function shouldSkipMarkerUpdate(
    previous: MarkerRenderSignature,
    next: MarkerRenderSignature,
): boolean {
    return (
        previous.zoom === next.zoom &&
        previous.boundsSignature === next.boundsSignature &&
        previous.displayRestaurantIdsSignature === next.displayRestaurantIdsSignature &&
        previous.selectedRestaurantId === next.selectedRestaurantId &&
        previous.searchedRestaurantId === next.searchedRestaurantId &&
        previous.modeSignature === next.modeSignature &&
        previous.markerLayerSignature === next.markerLayerSignature
    );
}

