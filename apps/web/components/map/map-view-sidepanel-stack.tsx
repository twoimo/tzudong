import type { MouseEvent, RefObject } from 'react';

import { MapViewDetailPanelShell, MapViewReviewModal } from '@/components/map/map-view-sidepanels';
import type { Restaurant } from '@/types/restaurant';

export function MapViewSidepanelStack({
    activePanel,
    detailPanelRef,
    isPanelOpen,
    isReviewModalOpen,
    onClose,
    onEditRestaurant,
    onFocusCapture,
    onMouseDownCapture,
    onRequestEditRestaurant,
    onReviewModalClose,
    onReviewModalSuccess,
    onToggleCollapse,
    onWriteReview,
    restaurant,
}: {
    activePanel?: 'map' | 'detail' | 'control';
    detailPanelRef: RefObject<HTMLDivElement | null>;
    isPanelOpen: boolean;
    isReviewModalOpen: boolean;
    onClose: () => void;
    onEditRestaurant?: () => void;
    onFocusCapture: () => void;
    onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => void;
    onRequestEditRestaurant?: () => void;
    onReviewModalClose: () => void;
    onReviewModalSuccess: () => void;
    onToggleCollapse: () => void;
    onWriteReview: () => void;
    restaurant: Restaurant | null | undefined;
}) {
    if (!restaurant) {
        return null;
    }

    return (
        <>
            <MapViewDetailPanelShell
                activePanel={activePanel}
                detailPanelRef={detailPanelRef}
                isPanelOpen={isPanelOpen}
                onClose={onClose}
                onEditRestaurant={onEditRestaurant}
                onFocusCapture={onFocusCapture}
                onMouseDownCapture={onMouseDownCapture}
                onRequestEditRestaurant={onRequestEditRestaurant}
                onToggleCollapse={onToggleCollapse}
                onWriteReview={onWriteReview}
                restaurant={restaurant}
            />

            {isReviewModalOpen && (
                <MapViewReviewModal
                    isOpen={isReviewModalOpen}
                    onClose={onReviewModalClose}
                    restaurant={restaurant}
                    onSuccess={onReviewModalSuccess}
                />
            )}
        </>
    );
}
