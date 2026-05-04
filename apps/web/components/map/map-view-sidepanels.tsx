import type { MouseEvent, RefObject } from 'react';
import dynamic from 'next/dynamic';
import type { Restaurant } from '@/types/restaurant';

const RestaurantDetailPanel = dynamic(
    () => import('@/components/map/map-view-deferred-panels').then((mod) => ({ default: mod.RestaurantDetailPanel })),
    { ssr: false }
);

const ReviewModal = dynamic(
    () => import('@/components/map/map-view-deferred-panels').then((mod) => ({ default: mod.ReviewModal })),
    { ssr: false }
);

export function MapViewAdminAddButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="absolute bottom-8 right-8 bg-gradient-primary text-primary-foreground px-6 py-3 rounded-full shadow-lg hover:opacity-90 transition-opacity font-semibold flex items-center gap-2 z-10"
        >
            <span className="text-xl">+</span>
            맛집 등록
        </button>
    );
}

export function MapViewDetailPanelShell({
    activePanel,
    detailPanelRef,
    isPanelOpen,
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
    isPanelOpen: boolean;
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
            className={`h-full relative shadow-xl bg-background transition-all duration-300 ease-in-out ${isPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
            style={{ overflow: 'visible' }}
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
                    isPanelOpen={isPanelOpen}
                />
            </div>
        </div>
    );
}

export function MapViewReviewModal({
    isOpen,
    onClose,
    onSuccess,
    restaurant,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    restaurant: Restaurant;
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
