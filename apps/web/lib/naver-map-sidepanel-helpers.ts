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

export function buildNaverMarkerRestaurantSelectionHandler({
    hasUserMovedMapRef,
    onMarkerClick,
    onRestaurantSelect,
    setInternalPanelOpen,
}: {
    hasUserMovedMapRef: { current: boolean };
    onMarkerClick?: (restaurant: Restaurant) => void;
    onRestaurantSelect?: (restaurant: Restaurant) => void;
    setInternalPanelOpen: (isOpen: boolean) => void;
}) {
    return (restaurant: Restaurant) => {
        hasUserMovedMapRef.current = false;
        if (onMarkerClick) {
            onMarkerClick(restaurant);
            return;
        }

        onRestaurantSelect?.(restaurant);
        setInternalPanelOpen(true);
    };
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
