import type { MouseEvent } from 'react';
import type { Restaurant } from '@/types/restaurant';

export function buildNaverMapRestaurantAction(
    action: ((restaurant: Restaurant) => void) | undefined,
    restaurant: Restaurant | null,
) {
    return action && restaurant ? () => action(restaurant) : undefined;
}

export function buildNaverMapInternalPanelCloseHandler(setInternalPanelOpen: (isOpen: boolean) => void) {
    return () => setInternalPanelOpen(false);
}

export function buildNaverMapInternalPanelToggleHandler({
    internalPanelOpen,
    setInternalPanelOpen,
}: {
    internalPanelOpen: boolean;
    setInternalPanelOpen: (isOpen: boolean) => void;
}) {
    return () => setInternalPanelOpen(!internalPanelOpen);
}

export function buildNaverMapReviewOpenHandler(setIsReviewModalOpen: (isOpen: boolean) => void) {
    return () => setIsReviewModalOpen(true);
}

export function buildNaverMapReviewCloseHandler(setIsReviewModalOpen: (isOpen: boolean) => void) {
    return () => setIsReviewModalOpen(false);
}

export function shouldCloseNaverInternalPanelForExternalState(externalPanelOpen?: boolean) {
    return externalPanelOpen === false;
}

export function shouldCloseNaverInternalPanelOnEscape({
    internalPanelOpen,
    isGridMode,
    key,
}: {
    internalPanelOpen: boolean;
    isGridMode: boolean;
    key: string;
}) {
    return key === 'Escape' && internalPanelOpen && !isGridMode;
}

export function buildNaverMarkerRestaurantSelectionHandler({
    centerMarkerImmediately,
    hasUserMovedMapRef,
    onMarkerClick,
    onRestaurantSelect,
    setInternalPanelOpen,
}: {
    centerMarkerImmediately?: (restaurant: Restaurant) => void;
    hasUserMovedMapRef: { current: boolean };
    onMarkerClick?: (restaurant: Restaurant) => void;
    onRestaurantSelect?: (restaurant: Restaurant) => void;
    setInternalPanelOpen: (isOpen: boolean) => void;
}) {
    return (restaurant: Restaurant) => {
        hasUserMovedMapRef.current = false;
        centerMarkerImmediately?.(restaurant);
        if (onMarkerClick) {
            onMarkerClick(restaurant);
            return;
        }

        onRestaurantSelect?.(restaurant);
        setInternalPanelOpen(true);
    };
}

export function resolveNaverMarkerClickImmediateCenterPlan({
    currentZoom,
    isGridMode,
    isMobileOrTablet,
    isPanelCollapsed,
    mapFocusZoom,
    mobileVerticalOffset,
    panelWidth,
    restaurant,
    usesExternalPanel,
}: {
    currentZoom: number;
    isGridMode: boolean;
    isMobileOrTablet: boolean;
    isPanelCollapsed: boolean;
    mapFocusZoom: number | null;
    mobileVerticalOffset: number;
    panelWidth: number;
    restaurant: Pick<Restaurant, 'id' | 'lat' | 'lng'>;
    usesExternalPanel: boolean;
}) {
    if (
        isGridMode ||
        typeof restaurant.lat !== 'number' ||
        typeof restaurant.lng !== 'number'
    ) {
        return { skip: true } as const;
    }

    const predictedPanelOffset = usesExternalPanel && !isMobileOrTablet && !isPanelCollapsed
        ? panelWidth
        : 0;

    return {
        skip: false,
        restaurantId: restaurant.id,
        targetLat: restaurant.lat,
        targetLng: restaurant.lng,
        targetZoom: mapFocusZoom ?? currentZoom,
        targetOffsetX: predictedPanelOffset / 2,
        targetOffsetY: isMobileOrTablet ? mobileVerticalOffset : 0,
    } as const;
}

export function applyNaverImmediateMarkerCenter({
    currentZoom,
    getAdjustedCenter,
    map,
    now = Date.now(),
    plan,
}: {
    currentZoom: number;
    getAdjustedCenter: (
        lat: number,
        lng: number,
        targetZoom: number,
        targetOffsetX: number,
        targetOffsetY: number,
    ) => unknown;
    map: {
        setCenter: (center: unknown) => void;
        setZoom: (zoom: number) => void;
    };
    now?: number;
    plan: ReturnType<typeof resolveNaverMarkerClickImmediateCenterPlan>;
}) {
    if (plan.skip) {
        return { applied: false } as const;
    }

    const adjustedCenter = getAdjustedCenter(
        plan.targetLat,
        plan.targetLng,
        plan.targetZoom,
        plan.targetOffsetX,
        plan.targetOffsetY,
    );

    if (plan.targetZoom !== currentZoom) {
        map.setZoom(plan.targetZoom);
    }
    map.setCenter(adjustedCenter);

    return {
        applied: true,
        markerCenter: {
            restaurantId: plan.restaurantId,
            targetLat: plan.targetLat,
            targetLng: plan.targetLng,
            targetZoom: plan.targetZoom,
            targetOffsetX: plan.targetOffsetX,
            targetOffsetY: plan.targetOffsetY,
            centeredAt: now,
        },
    } as const;
}

export function shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({
    centeredAt,
    immediateOffsetX,
    immediateOffsetY,
    immediateTargetLat,
    immediateTargetLng,
    immediateZoom,
    maxAgeMs = 900,
    restaurantId,
    selectedRestaurantId,
    targetLat,
    targetLng,
    targetOffsetX,
    targetOffsetY,
    targetZoom,
}: {
    centeredAt: number;
    immediateOffsetX: number;
    immediateOffsetY: number;
    immediateTargetLat: number;
    immediateTargetLng: number;
    immediateZoom: number;
    maxAgeMs?: number;
    restaurantId: string;
    selectedRestaurantId: string | null;
    targetLat: number;
    targetLng: number;
    targetOffsetX: number;
    targetOffsetY: number;
    targetZoom: number;
}) {
    return (
        restaurantId === selectedRestaurantId &&
        Date.now() - centeredAt <= maxAgeMs &&
        Math.abs(immediateTargetLat - targetLat) < 0.000001 &&
        Math.abs(immediateTargetLng - targetLng) < 0.000001 &&
        Math.abs(immediateOffsetX - targetOffsetX) < 1 &&
        Math.abs(immediateOffsetY - targetOffsetY) < 1 &&
        immediateZoom === targetZoom &&
        Number.isFinite(targetZoom)
    );
}

export function getNaverMapReviewRestaurant(restaurant: Restaurant | null) {
    return restaurant ? { id: restaurant.id, name: restaurant.name } : null;
}

export function buildNaverMapReviewSuccessHandler({
    refetch,
    showMapToast,
}: {
    refetch: () => void;
    showMapToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
    return () => {
        refetch();
        showMapToast('리뷰가 성공적으로 등록되었습니다!', 'success');
    };
}

export function buildNaverMapDetailPanelMouseDownCaptureHandler(
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void,
) {
    return (event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        onPanelClick?.('detail');
    };
}

export function buildNaverMapDetailPanelFocusCaptureHandler(
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void,
) {
    return () => {
        onPanelClick?.('detail');
    };
}
