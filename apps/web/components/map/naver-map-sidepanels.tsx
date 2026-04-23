import { lazy, Suspense, type MouseEvent, type RefObject } from 'react';

import type { Restaurant } from '@/types/restaurant';

const RestaurantDetailPanel = lazy(() =>
    import('@/components/restaurant/RestaurantDetailPanel').then((mod) => ({
        default: mod.RestaurantDetailPanel,
    }))
);
const ReviewModal = lazy(() =>
    import('@/components/reviews/ReviewModal').then((mod) => ({
        default: mod.ReviewModal,
    }))
);

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
                <Suspense fallback={null}>
                    <RestaurantDetailPanel
                        restaurant={restaurant}
                        onClose={onClose}
                        onWriteReview={onWriteReview}
                        onEditRestaurant={onEditRestaurant}
                        onRequestEditRestaurant={onRequestEditRestaurant}
                        onToggleCollapse={onToggleCollapse}
                        isPanelOpen={internalPanelOpen}
                    />
                </Suspense>
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
    if (!isOpen) return null;

    return (
        <Suspense fallback={null}>
            <ReviewModal
                isOpen={isOpen}
                onClose={onClose}
                restaurant={restaurant}
                onSuccess={onSuccess}
            />
        </Suspense>
    );
}
