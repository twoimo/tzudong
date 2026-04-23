'use client';

import dynamic from 'next/dynamic';
import type { Announcement } from '@/types/announcement';
import type { useHomeState } from './hooks/useHomeState';

const SubmissionFloatingButton = dynamic(
    () => import('../components/home/SubmissionFloatingButton'),
    { ssr: false }
);

const BottomSheet = dynamic(
    () => import('@/components/ui/bottom-sheet').then((mod) => ({ default: mod.BottomSheet })),
    { ssr: false }
);

const RightPanelWrapper = dynamic(
    () => import('@/components/layout/RightPanelWrapper'),
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

const AdminReviewPanel = dynamic(
    () => import('@/components/admin/AdminReviewPanel'),
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
type PanelType = 'mypage' | 'adminReviews' | 'announcement' | null;

type HomeClientSidePanelsProps = {
    activeRightPanel: PanelType;
    closeAllPanels: () => void;
    isAdmin: boolean;
    isAnnouncementSheetOpen: boolean;
    isDesktop: boolean;
    isMobileOrTablet: boolean;
    isPanelCollapsed: boolean;
    isSidebarOpen: boolean;
    isSubmissionModalOpen: boolean;
    onSubmissionButtonClick: () => void;
    selectedAnnouncement: Announcement | null;
    setIsAnnouncementSheetOpen: (isOpen: boolean) => void;
    setIsSubmissionModalOpen: (isOpen: boolean) => void;
    setSelectedAnnouncement: (announcement: Announcement | null) => void;
    state: HomeState;
    togglePanelCollapse: () => void;
};

const ANNOUNCEMENT_HALF_HEIGHT = 50;

export default function HomeClientSidePanels({
    activeRightPanel,
    closeAllPanels,
    isAdmin,
    isAnnouncementSheetOpen,
    isDesktop,
    isMobileOrTablet,
    isPanelCollapsed,
    isSidebarOpen,
    isSubmissionModalOpen,
    onSubmissionButtonClick,
    selectedAnnouncement,
    setIsAnnouncementSheetOpen,
    setIsSubmissionModalOpen,
    setSelectedAnnouncement,
    state,
    togglePanelCollapse,
}: HomeClientSidePanelsProps) {
    return (
        <>
            {isDesktop && (
                <SubmissionFloatingButton
                    onClick={onSubmissionButtonClick}
                    isSidebarOpen={isSidebarOpen}
                />
            )}

            {state.isEditModalOpen && (
                <EditRestaurantModal
                    isOpen={state.isEditModalOpen}
                    onClose={() => {
                        state.setIsEditModalOpen(false);
                        state.setRestaurantToEdit(null);
                    }}
                    restaurant={state.restaurantToEdit}
                    initialFormData={state.editFormData}
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
                />
            )}

            {state.isReviewModalOpen && (
                <ReviewModal
                    isOpen={state.isReviewModalOpen}
                    onClose={() => state.setIsReviewModalOpen(false)}
                    restaurant={state.panelRestaurant ? { id: state.panelRestaurant.id, name: state.panelRestaurant.name } : null}
                    onSuccess={() => {
                        state.setRefreshTrigger((prev) => prev + 1);
                    }}
                />
            )}

            {isAdmin && (
                <RightPanelWrapper
                    isOpen={activeRightPanel === 'adminReviews'}
                    isCollapsed={isPanelCollapsed}
                >
                    <AdminReviewPanel
                        isOpen={!isPanelCollapsed}
                        onClose={closeAllPanels}
                        onToggleCollapse={togglePanelCollapse}
                        isCollapsed={isPanelCollapsed}
                    />
                </RightPanelWrapper>
            )}

            {!isMobileOrTablet ? (
                <RightPanelWrapper
                    isOpen={activeRightPanel === 'announcement'}
                    isCollapsed={isPanelCollapsed}
                >
                    <AnnouncementPanel
                        isOpen={!isPanelCollapsed}
                        onClose={closeAllPanels}
                        onToggleCollapse={togglePanelCollapse}
                        isCollapsed={isPanelCollapsed}
                        isAdmin={isAdmin}
                        initialAnnouncement={selectedAnnouncement}
                    />
                </RightPanelWrapper>
            ) : (
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
