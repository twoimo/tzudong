'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import FeedContent, { type FeedRestaurantRecord } from '@/components/feed/FeedContent';
import { BREAKPOINTS } from '@/hooks/useDeviceType';
import AuthModal from '@/components/auth/AuthModal';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';
import { ReviewModal } from '@/components/reviews/ReviewModal';
import type { Restaurant } from '@/types/restaurant';

function FeedPageContent() {
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isRestaurantSheetOpen, setIsRestaurantSheetOpen] = useState(false);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    useEffect(() => {
        setIsMounted(true);

        const redirectIfDesktop = () => {
            if (window.innerWidth > BREAKPOINTS.tabletMax) {
                router.replace('/');
            }
        };

        redirectIfDesktop();
        window.addEventListener('resize', redirectIfDesktop, { passive: true });

        return () => {
            window.removeEventListener('resize', redirectIfDesktop);
        };
    }, [router]);

    // Mount 전에는 아무것도 렌더링하지 않음 (Hydration Mismatch 방지)
    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > BREAKPOINTS.tabletMax) return null;

    const handleOpenRestaurantDetail = (restaurant: FeedRestaurantRecord) => {
        setSelectedRestaurant(restaurant as unknown as Restaurant);
        setIsRestaurantSheetOpen(true);
    };

    const handleCloseRestaurantDetail = () => {
        setIsRestaurantSheetOpen(false);
        setSelectedRestaurant(null);
    };

    return (
        <div className="h-full w-full bg-background overflow-hidden" data-testid="feed-page-container">
            <FeedContent
                variant="page"
                onOpenAuth={() => setIsAuthModalOpen(true)}
                onOpenRestaurantDetail={handleOpenRestaurantDetail}
            />
            {isAuthModalOpen && (
                <AuthModal
                    isOpen={isAuthModalOpen}
                    onClose={() => setIsAuthModalOpen(false)}
                />
            )}
            {selectedRestaurant && (
                <BottomSheet
                    key={selectedRestaurant.id}
                    isOpen={isRestaurantSheetOpen}
                    onClose={handleCloseRestaurantDetail}
                    defaultHeight={50}
                    minHeight={25}
                    headerOffset={0}
                    bottomNavOffset={0}
                    enablePeek={true}
                    hideBottomNavWhenOpen={true}
                    progressiveHeaderHide={true}
                    layoutSource="feed-restaurant-detail-sheet"
                    disableContentScroll={true}
                    className="p-0"
                >
                    <RestaurantDetailPanel
                        restaurant={selectedRestaurant}
                        onClose={handleCloseRestaurantDetail}
                        onWriteReview={() => setIsReviewModalOpen(true)}
                        isPanelOpen={isRestaurantSheetOpen}
                        isMobile={true}
                        className="h-full shadow-none border-0 overflow-hidden"
                    />
                </BottomSheet>
            )}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                onSuccess={() => setIsReviewModalOpen(false)}
            />
        </div>
    );
}

export default function FeedPage() {
    return (
        <Suspense fallback={<div className="h-screen w-full flex items-center justify-center">Loading...</div>}>
            <FeedPageContent />
        </Suspense>
    );
}
