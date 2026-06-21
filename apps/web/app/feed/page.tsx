'use client';

import { useEffect, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import FeedContent, { type FeedRestaurantRecord } from '@/components/feed/FeedContent';
import { BREAKPOINTS } from '@/hooks/useDeviceType';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { Restaurant } from '@/types/restaurant';
import { buildEditRestaurantInitialFormData } from '@/lib/edit-restaurant-request-form';
import { GlobalLoader } from '@/components/ui/global-loader';

const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), { ssr: false });
const RestaurantDetailPanel = dynamic(
    () => import('@/components/restaurant/RestaurantDetailPanel').then((mod) => ({ default: mod.RestaurantDetailPanel })),
    { ssr: false }
);
const ReviewModal = dynamic(
    () => import('@/components/reviews/ReviewModal').then((mod) => ({ default: mod.ReviewModal })),
    { ssr: false }
);
const EditRestaurantModal = dynamic(
    () => import('@/components/modals/EditRestaurantModal').then((mod) => ({ default: mod.EditRestaurantModal })),
    { ssr: false }
);
const EMPTY_SEARCH_PARAMS = new URLSearchParams();

function FeedPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS;
    const [isMounted, setIsMounted] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isRestaurantSheetOpen, setIsRestaurantSheetOpen] = useState(false);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [restaurantSheetHeightRequestKey, setRestaurantSheetHeightRequestKey] = useState(0);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);

    useEffect(() => {
        setIsMounted(true);

        const redirectIfDesktop = () => {
            if (window.innerWidth > BREAKPOINTS.tabletMax) {
                const reviewId = searchParams.get('review');
                const target = reviewId ? `/?panel=feed&review=${encodeURIComponent(reviewId)}` : '/?panel=feed';
                router.replace(target);
            }
        };

        redirectIfDesktop();
        window.addEventListener('resize', redirectIfDesktop, { passive: true });

        return () => {
            window.removeEventListener('resize', redirectIfDesktop);
        };
    }, [router, searchParams]);

    // Mount 전에는 아무것도 렌더링하지 않음 (Hydration Mismatch 방지)
    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > BREAKPOINTS.tabletMax) return null;

    const handleOpenRestaurantDetail = (restaurant: FeedRestaurantRecord) => {
        setRestaurantSheetHeightRequestKey(0);
        setSelectedRestaurant(restaurant as unknown as Restaurant);
        setIsRestaurantSheetOpen(true);
    };

    const handleCloseRestaurantDetail = () => {
        setIsRestaurantSheetOpen(false);
        setSelectedRestaurant(null);
        setRestaurantSheetHeightRequestKey(0);
    };

    const handleOpenDirectionSheet = () => {
        setRestaurantSheetHeightRequestKey((key) => key + 1);
    };

    const handleRequestEditRestaurant = (restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);
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
                    heightRequest={
                        restaurantSheetHeightRequestKey > 0
                            ? { key: restaurantSheetHeightRequestKey, height: 50 }
                            : undefined
                    }
                    className="p-0"
                >
                    <RestaurantDetailPanel
                        restaurant={selectedRestaurant}
                        onClose={handleCloseRestaurantDetail}
                        onWriteReview={() => setIsReviewModalOpen(true)}
                        onOpenDirectionSheet={handleOpenDirectionSheet}
                        onRequestEditRestaurant={handleRequestEditRestaurant}
                        isPanelOpen={isRestaurantSheetOpen}
                        isMobile={true}
                        className="h-full shadow-none border-0 overflow-hidden"
                    />
                </BottomSheet>
            )}
            {restaurantToEdit && (
                <EditRestaurantModal
                    isOpen={true}
                    onClose={() => setRestaurantToEdit(null)}
                    restaurant={restaurantToEdit}
                    initialFormData={buildEditRestaurantInitialFormData(restaurantToEdit)}
                />
            )}
            {isReviewModalOpen && (
                <ReviewModal
                    isOpen={isReviewModalOpen}
                    onClose={() => setIsReviewModalOpen(false)}
                    restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                    onSuccess={() => setIsReviewModalOpen(false)}
                />
            )}
        </div>
    );
}

export default function FeedPage() {
    return (
        <Suspense fallback={(
            <GlobalLoader
                message="피드를 불러오는 중..."
                subMessage="리뷰와 맛집 정보를 준비하고 있습니다"
                fullScreen
            />
        )}>
            <FeedPageContent />
        </Suspense>
    );
}
