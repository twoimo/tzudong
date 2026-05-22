'use client';

import './home-deferred-globals.css';
import dynamic from 'next/dynamic';
import type { Announcement } from '@/types/announcement';
import type { useHomeState } from './hooks/useHomeState';

const BottomSheet = dynamic(
    () => import('@/components/ui/bottom-sheet').then((mod) => ({ default: mod.BottomSheet })),
    { ssr: false }
);

const AdminRestaurantModal = dynamic(
    () => import('@/components/admin/AdminRestaurantModal').then((mod) => ({ default: mod.AdminRestaurantModal })),
    { ssr: false }
);

const EditRestaurantModal = dynamic(
    () => import('@/components/modals/EditRestaurantModal').then((mod) => ({ default: mod.EditRestaurantModal })),
    { ssr: false }
);

const RestaurantSubmissionModal = dynamic(
    () => import('@/components/modals/RestaurantSubmissionModal'),
    { ssr: false }
);

const AnnouncementPanel = dynamic(
    () => import('@/components/announcement/AnnouncementPanel'),
    { ssr: false }
);

const ReviewModal = dynamic(
    () => import('@/components/reviews/ReviewModal').then((mod) => ({ default: mod.ReviewModal })),
    { ssr: false }
);

type HomeState = ReturnType<typeof useHomeState>;
type HomeClientSidePanelsProps = {
    closeAllPanels: () => void;
    isAdmin: boolean;
    isAnnouncementSheetOpen: boolean;
    isMobileOrTablet: boolean;
    isSubmissionModalOpen: boolean;
    selectedAnnouncement: Announcement | null;
    setIsAnnouncementSheetOpen: (isOpen: boolean) => void;
    setIsSubmissionModalOpen: (isOpen: boolean) => void;
    setSelectedAnnouncement: (announcement: Announcement | null) => void;
    state: HomeState;
};

const ANNOUNCEMENT_HALF_HEIGHT = 50;


export default function HomeClientSidePanels({
    closeAllPanels,
    isAdmin,
    isAnnouncementSheetOpen,
    isMobileOrTablet,
    isSubmissionModalOpen,
    selectedAnnouncement,
    setIsAnnouncementSheetOpen,
    setIsSubmissionModalOpen,
    setSelectedAnnouncement,
    state,
}: HomeClientSidePanelsProps) {
    const reviewRestaurant = state.panelRestaurant ? { id: state.panelRestaurant.id, name: state.panelRestaurant.name } : null;

    return (
        <>
            {state.isEditModalOpen && (
                <EditRestaurantModal
                    isOpen={state.isEditModalOpen}
                    onClose={() => {
                        state.setIsEditModalOpen(false);
                        state.setRestaurantToEdit(null);
                    }}
                    restaurant={state.restaurantToEdit}
                    initialFormData={state.editFormData}
                    presentation={isMobileOrTablet ? 'auto' : 'map-panel'}
                />
            )}

            {isAdmin && state.isAdminEditModalOpen && (
                <AdminRestaurantModal
                    isOpen={state.isAdminEditModalOpen}
                    onClose={() => {
                        state.setIsAdminEditModalOpen(false);
                        state.setAdminRestaurantToEdit(null);
                    }}
                    restaurant={state.adminRestaurantToEdit}
                    onSuccess={(updatedRestaurant) => {
                        state.setRefreshTrigger((prev) => prev + 1);
                        if (updatedRestaurant && state.selectedRestaurant?.id === updatedRestaurant.id) {
                            state.setSelectedRestaurant(updatedRestaurant);
                            state.setPanelRestaurant(updatedRestaurant);
                        }
                        state.setIsAdminEditModalOpen(false);
                        state.setAdminRestaurantToEdit(null);
                    }}
                />
            )}

            {isSubmissionModalOpen && (
                <RestaurantSubmissionModal
                    isOpen={isSubmissionModalOpen}
                    onClose={() => setIsSubmissionModalOpen(false)}
                    presentation={isMobileOrTablet ? 'auto' : 'map-panel'}
                />
            )}

            {state.isReviewModalOpen && isMobileOrTablet && (
                <ReviewModal
                    isOpen={state.isReviewModalOpen}
                    onClose={() => state.setIsReviewModalOpen(false)}
                    restaurant={reviewRestaurant}
                    onSuccess={() => {
                        state.setRefreshTrigger((prev) => prev + 1);
                    }}
                />
            )}

            {state.isReviewModalOpen && !isMobileOrTablet && (
                <ReviewModal
                    isOpen={state.isReviewModalOpen}
                    onClose={() => state.setIsReviewModalOpen(false)}
                    restaurant={reviewRestaurant}
                    onSuccess={() => {
                        state.setRefreshTrigger((prev) => prev + 1);
                    }}
                    presentation="map-panel"
                />
            )}

            {isMobileOrTablet && (
                <BottomSheet
                    isOpen={isAnnouncementSheetOpen}
                    onClose={() => {
                        setIsAnnouncementSheetOpen(false);
                        setSelectedAnnouncement(null);
                        closeAllPanels();
                    }}
                    defaultHeight={ANNOUNCEMENT_HALF_HEIGHT}
                    minHeight={25}
                    maxHeight={100}
                    enablePeek
                    hideBottomNavWhenOpen
                    progressiveHeaderHide
                    showBackdrop={false}
                    closeOnOutsidePointerDown
                    layoutSource="home-announcement-bottom-sheet"
                    className="z-[95] p-0"
                >
                    <div className="h-full min-h-0 overflow-hidden bg-background">
                        <AnnouncementPanel
                            isOpen={isAnnouncementSheetOpen}
                            onClose={closeAllPanels}
                            isAdmin={isAdmin}
                            initialAnnouncement={selectedAnnouncement}
                            isBottomSheet
                        />
                    </div>
                </BottomSheet>
            )}
        </>
    );
}
