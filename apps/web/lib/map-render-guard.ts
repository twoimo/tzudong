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

interface MarkerRenderSignatureInput {
    zoom: number;
    bounds: RenderBoundsLike | null;
    displayRestaurantIds: readonly string[];
    selectedRestaurantId: string | null;
    searchedRestaurantId?: string | null;
    isClusterMode: boolean;
    isRegionalClusterMode: boolean;
    isSeoulDistrictMode: boolean;
}

export interface MarkerRenderSignature {
    zoom: number;
    boundsSignature: string | null;
    displayRestaurantIdsSignature: string;
    selectedRestaurantId: string | null;
    searchedRestaurantId: string | null;
    modeSignature: string;
}

const BOUNDS_PRECISION_DIGITS = 4;

function roundCoord(value: number): number {
    const factor = 10 ** BOUNDS_PRECISION_DIGITS;
    return Math.round(value * factor) / factor;
}

function makeBoundsSignature(bounds: RenderBoundsLike | null): string | null {
    if (!bounds) return null;

    return [
        roundCoord(bounds.south),
        roundCoord(bounds.west),
        roundCoord(bounds.north),
        roundCoord(bounds.east),
    ].join(",");
}

function makeDisplayIdsSignature(ids: readonly string[]): string {
    return [...new Set(ids)]
        .filter(Boolean)
        .sort()
        .join("|");
}

export function buildMarkerRenderSignature(input: MarkerRenderSignatureInput): MarkerRenderSignature {
    return {
        zoom: input.zoom,
        boundsSignature: makeBoundsSignature(input.bounds),
        displayRestaurantIdsSignature: makeDisplayIdsSignature(input.displayRestaurantIds),
        selectedRestaurantId: input.selectedRestaurantId,
        searchedRestaurantId: input.searchedRestaurantId ?? null,
        modeSignature: `${input.isClusterMode ? "1" : "0"}${input.isRegionalClusterMode ? "1" : "0"}${input.isSeoulDistrictMode ? "1" : "0"}`,
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
        previous.modeSignature === next.modeSignature
    );
}

