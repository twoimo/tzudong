import { LoadingSurface } from "@/components/ui/loading-surface";
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
    // Route the lazy import through the deferred-panel barrel so the panel's
    // dedicated Tailwind entry (app/home-detail-globals.css) is loaded with it.
    // Importing @/components/restaurant/RestaurantDetailPanel directly drops that
    // stylesheet on the home route, which silently removes restaurant/review-only
    // utilities (top-2, bg-black/70, ring-1, ...) and blanks the video play badge.
    const mod = await import('@/components/map/map-view-deferred-panels');
    return mod.RestaurantDetailPanel as ComponentType<RestaurantDetailPanelProps>;
};

const loadReviewModal = async () => {
    const mod = await import('@/components/map/map-view-deferred-panels');
    return mod.ReviewModal as ComponentType<ReviewModalProps>;
};

function NaverMapDetailPanelLoading() {
    return (
        <div className="h-full bg-background" data-map-detail-panel-skeleton="true">
            <LoadingSurface label="맛집 상세 패널 로딩 중" className="h-full p-4">
                <article className="space-y-3">
                    <svg viewBox="0 0 320 192" role="img" aria-label="맛집 사진" className="h-48 w-full rounded-2xl">
                        <path d="M0 160 90 64 170 128 240 48 320 144V192H0Z" fill="currentColor" opacity="0.12" />
                    </svg>
                    <h2 className="text-lg font-semibold leading-5">영상 속 맛집</h2>
                    <p className="text-xs leading-3">맛집 소개와 방문 이야기를 만나보세요</p>
                    <p className="text-xs leading-3">음식과 여행을 함께 기록해요</p>
                </article>
            </LoadingSurface>
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
            className={`h-full relative shadow-sm bg-background ${internalPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
            style={{ overflow: 'visible' }}
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
                    <NaverMapDetailPanelLoading />
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
