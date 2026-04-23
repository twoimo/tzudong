import type { MouseEvent } from 'react';
import type { Restaurant } from '@/types/restaurant';

export function buildMapViewReviewCloseHandler(setIsReviewModalOpen: (isOpen: boolean) => void) {
    return () => setIsReviewModalOpen(false);
}

export function buildMapViewReviewSuccessHandler(refetch: () => void) {
    return () => refetch();
}

export function buildMapViewDetailPanelMouseDownCaptureHandler(
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void,
) {
    return (event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        onPanelClick?.('detail');
    };
}

export function buildMapViewDetailPanelFocusCaptureHandler(
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void,
) {
    return () => {
        onPanelClick?.('detail');
    };
}

export function shouldShowMapViewDetailPanel({
    onMarkerClick,
    selectedRestaurant,
}: {
    onMarkerClick?: (restaurant: Restaurant) => void;
    selectedRestaurant: Restaurant | null | undefined;
}) {
    return Boolean(selectedRestaurant && !onMarkerClick);
}

export function shouldShowMapViewReviewModal({
    isReviewModalOpen,
    selectedRestaurant,
}: {
    isReviewModalOpen: boolean;
    selectedRestaurant: Restaurant | null | undefined;
}) {
    return Boolean(selectedRestaurant && isReviewModalOpen);
}
