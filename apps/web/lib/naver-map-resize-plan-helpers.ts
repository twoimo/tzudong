import type { Region, Restaurant } from '@/types/restaurant';

import { shouldSkipNaverResizeRecenter } from '@/lib/naver-map-resize-guards';
import { resolveNaverResizeOffsets } from '@/lib/naver-map-resize-offset-helpers';
import { resolveNaverResizeTarget } from '@/lib/naver-map-resize-target-helpers';
import { resolveNaverResizeCenter } from '@/lib/naver-map-resize-center-helpers';

export function resolveNaverResizePlan<TCenter>({
    currentCenter,
    currentZoom,
    effectivePanelOffset,
    getAdjustedCenter,
    hasUserMoved,
    isGridMode,
    isMobileOrTablet,
    mobileVerticalOffset,
    selectedRegion,
    selectedRestaurant,
    urlLat,
    urlLng,
    urlZoom,
}: {
    currentCenter: { lat: () => number; lng: () => number };
    currentZoom: number;
    effectivePanelOffset: number;
    getAdjustedCenter: (
        lat: number,
        lng: number,
        targetZoom: number,
        offsetX: number,
        offsetY?: number,
    ) => TCenter;
    hasUserMoved: boolean;
    isGridMode: boolean;
    isMobileOrTablet: boolean;
    mobileVerticalOffset: number;
    selectedRegion: Region | null;
    selectedRestaurant: Restaurant | null;
    urlLat: number;
    urlLng: number;
    urlZoom: number;
}) {
    if (shouldSkipNaverResizeRecenter({
        hasUserMoved,
        isGridMode,
        skipTarget: false,
    })) {
        return { skip: true } as const;
    }

    const resizeTarget = resolveNaverResizeTarget({
        selectedRegion,
        selectedRestaurant,
        urlLat,
        urlLng,
        urlZoom,
    });

    if (shouldSkipNaverResizeRecenter({
        hasUserMoved: false,
        isGridMode: false,
        skipTarget: resizeTarget.skip,
    })) {
        return { skip: true } as const;
    }

    const { targetOffsetX, targetOffsetY } = resolveNaverResizeOffsets({
        effectivePanelOffset,
        isMobileOrTablet,
        mobileVerticalOffset,
    });

    return {
        skip: false,
        newCenterLatLng: resolveNaverResizeCenter({
            currentCenter,
            currentZoom,
            getAdjustedCenter,
            targetLat: resizeTarget.targetLat,
            targetLng: resizeTarget.targetLng,
            targetOffsetX,
            targetOffsetY,
        }),
    } as const;
}
