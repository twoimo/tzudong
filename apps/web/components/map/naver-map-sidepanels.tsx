import type { MouseEvent, RefObject } from 'react';

import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';
import { ReviewModal } from '@/components/reviews/ReviewModal';
import type { Restaurant } from '@/types/restaurant';

export function NaverMapDetailPanelShell({
    activePanel,
    detailPanelRef,
    internalPanelOpen,
    onClose,
    onEditRestaurant,
    onFocusCapture,
    onMouseDownCapture,
    onRequestEditRestaurant,
    onToggleCollapse,
    onWriteReview,
    restaurant,
}: {
    activePanel?: 'map' | 'detail' | 'control';
    detailPanelRef: RefObject<HTMLDivElement | null>;
    internalPanelOpen: boolean;
    onClose: () => void;
    onEditRestaurant?: () => void;
    onFocusCapture: () => void;
    onMouseDownCapture: (event: MouseEvent<HTMLDivElement>) => void;
    onRequestEditRestaurant?: () => void;
    onToggleCollapse: () => void;
    onWriteReview: () => void;
    restaurant: Restaurant;
}) {
    return (
        <div
            className={`h-full relative shadow-xl bg-background transition-[width] duration-300 ${internalPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
            style={{ overflow: 'visible', transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)' }}
            onMouseDownCapture={onMouseDownCapture}
            onFocusCapture={onFocusCapture}
        >
            <div ref={detailPanelRef} className="h-full w-[min(400px,calc(100vw-1rem))] bg-background border-l border-border">
                <RestaurantDetailPanel
                    restaurant={restaurant}
                    onClose={onClose}
                    onWriteReview={onWriteReview}
                    onEditRestaurant={onEditRestaurant}
                    onRequestEditRestaurant={onRequestEditRestaurant}
                    onToggleCollapse={onToggleCollapse}
                    isPanelOpen={internalPanelOpen}
                />
            </div>
        </div>
    );
}

export function NaverMapReviewModal({
    isOpen,
    onClose,
    onSuccess,
    restaurant,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    restaurant: { id: string; name: string } | null;
}) {
    return (
        <ReviewModal
            isOpen={isOpen}
            onClose={onClose}
            restaurant={restaurant}
            onSuccess={onSuccess}
        />
    );
}
