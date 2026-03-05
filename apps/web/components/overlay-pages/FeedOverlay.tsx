'use client';

import FeedContent from '@/components/feed/FeedContent';
import type { Restaurant } from '@/types/restaurant';

interface FeedOverlayProps {
    onClose: () => void;
    onOpenReviewModal?: () => void;
    hideReviewModal?: boolean;
    hideFloatingButton?: boolean;
    initialReviewId?: string | null;
    onOpenRestaurantDetail?: (restaurant: Restaurant) => void;
    onOpenUserProfile?: (userId: string) => void;
    onOpenAuth?: () => void;
}

/**
 * 피드 오버레이 (데스크탑)
 * - FeedContent 컴포넌트를 오버레이 형태로 렌더링
 */
export default function FeedOverlay({
    onClose,
    onOpenReviewModal,
    hideReviewModal,
    hideFloatingButton,
    initialReviewId,
    onOpenRestaurantDetail,
    onOpenUserProfile,
    onOpenAuth,
}: FeedOverlayProps) {
    return (
        <FeedContent
            variant="overlay"
            onClose={onClose}
            onOpenReviewModal={onOpenReviewModal}
            hideReviewModal={hideReviewModal}
            hideFloatingButton={hideFloatingButton}
            initialReviewId={initialReviewId}
            onOpenRestaurantDetail={
                onOpenRestaurantDetail as unknown as
                ((restaurant: Record<string, unknown> & { id: string }) => void) | undefined
            }
            onOpenUserProfile={onOpenUserProfile}
            onOpenAuth={onOpenAuth}
        />
    );
}
