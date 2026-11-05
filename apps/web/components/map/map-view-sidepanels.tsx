import { LoadingSurface } from "@/components/ui/loading-surface";
import type { MouseEvent, RefObject } from 'react';
import dynamic from 'next/dynamic';
import type { Restaurant } from '@/types/restaurant';


function MapViewDetailPanelLoading() {
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

const RestaurantDetailPanel = dynamic(
    () => import('@/components/map/map-view-deferred-panels').then((mod) => ({ default: mod.RestaurantDetailPanel })),
    { ssr: false, loading: MapViewDetailPanelLoading }
);

const ReviewModal = dynamic(
    () => import('@/components/map/map-view-deferred-panels').then((mod) => ({ default: mod.ReviewModal })),
    { ssr: false }
);

export function MapViewAdminAddButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="absolute bottom-8 right-8 bg-primary text-primary-foreground px-6 py-3 rounded-full shadow-sm hover:bg-primary/90 transition-colors font-semibold flex items-center gap-2 z-10"
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
            className={`h-full relative shadow-sm bg-background ${isPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
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
                    showDesktopBackButton
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
