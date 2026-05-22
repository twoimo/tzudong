import { Suspense, type ComponentType, type MouseEvent, type RefObject } from 'react';

import type { Restaurant } from '@/types/restaurant';
import { useDeferredComponent } from '@/hooks/use-deferred-component';

type RestaurantDetailPanelProps = {
    restaurant: Restaurant;
    onClose: () => void;
    onWriteReview: () => void;
    onEditRestaurant?: () => void;
    onRequestEditRestaurant?: () => void;
    onToggleCollapse: () => void;
    isPanelOpen: boolean;
    showDesktopBackButton?: boolean;
};

type ReviewModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    restaurant: { id: string; name: string } | null;
};

const loadRestaurantDetailPanel = async () => {
    const mod = await import('@/components/restaurant/RestaurantDetailPanel');
    return mod.RestaurantDetailPanel as ComponentType<RestaurantDetailPanelProps>;
};

const loadReviewModal = async () => {
    const mod = await import('@/components/reviews/ReviewModal');
    return mod.ReviewModal as ComponentType<ReviewModalProps>;
};

function NaverMapDetailPanelSkeleton() {
    return (
        <div
            role="status"
            aria-label="맛집 상세 패널 로딩 중"
            className="flex h-full flex-col gap-3 bg-background p-4"
            data-map-detail-panel-skeleton="true"
        >
            <div className="h-48 rounded-2xl bg-muted animate-pulse motion-reduce:animate-none" />
            <div className="h-5 w-2/3 rounded bg-muted animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-full rounded bg-muted animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse motion-reduce:animate-none" />
        </div>
    );
}

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
    const RestaurantDetailPanel = useDeferredComponent(true, loadRestaurantDetailPanel);

    return (
        <div
            className={`h-full relative shadow-xl bg-background transition-[width] duration-300 ${internalPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
            style={{ overflow: 'visible', transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)' }}
            onMouseDownCapture={onMouseDownCapture}
            onFocusCapture={onFocusCapture}
        >
            <div ref={detailPanelRef} className="h-full w-[min(400px,calc(100vw-1rem))] bg-background border-l border-border">
                {RestaurantDetailPanel ? (
                    <Suspense fallback={null}>
                        <RestaurantDetailPanel
                            restaurant={restaurant}
                            onClose={onClose}
                            onWriteReview={onWriteReview}
                            onEditRestaurant={onEditRestaurant}
                            onRequestEditRestaurant={onRequestEditRestaurant}
                            onToggleCollapse={onToggleCollapse}
                            isPanelOpen={internalPanelOpen}
                            showDesktopBackButton
                        />
                    </Suspense>
                ) : (
                    <NaverMapDetailPanelSkeleton />
                )}
            </div>
        </div>
    );
}

export function NaverMapReviewModal({
    isOpen,
    onClose,
    onSuccess,
    restaurant,
}: ReviewModalProps) {
    const ReviewModal = useDeferredComponent(isOpen, loadReviewModal);

    if (!isOpen || !ReviewModal) return null;

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
