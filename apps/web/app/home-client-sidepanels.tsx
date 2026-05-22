'use client';

import './home-deferred-globals.css';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
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


type DesktopReviewPanelPosition = {
    x: number;
    y: number;
};

type DesktopReviewPanelDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    initialLeft: number;
    initialTop: number;
    originX: number;
    originY: number;
    panelWidth: number;
    panelHeight: number;
};

const DEFAULT_DESKTOP_REVIEW_PANEL_POSITION: DesktopReviewPanelPosition = { x: 0, y: 0 };
const DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN = 16;
const DESKTOP_REVIEW_PANEL_KEYBOARD_STEP = 24;

function clampDesktopReviewPanelAxis(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

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
    const desktopReviewPanelRef = useRef<HTMLElement | null>(null);
    const desktopReviewPanelOpenerRef = useRef<HTMLElement | null>(null);
    const desktopReviewPanelDragRef = useRef<DesktopReviewPanelDragState | null>(null);
    const [desktopReviewPanelPosition, setDesktopReviewPanelPosition] = useState<DesktopReviewPanelPosition>(
        DEFAULT_DESKTOP_REVIEW_PANEL_POSITION,
    );
    const shouldRenderDesktopReviewPanel = state.isReviewModalOpen && !isMobileOrTablet;
    const reviewRestaurant = state.panelRestaurant ? { id: state.panelRestaurant.id, name: state.panelRestaurant.name } : null;

    const getClampedDesktopReviewPanelPosition = useCallback((clientX: number, clientY: number): DesktopReviewPanelPosition | null => {
        const dragState = desktopReviewPanelDragRef.current;
        if (!dragState || typeof window === 'undefined') return null;

        const deltaX = clientX - dragState.startX;
        const deltaY = clientY - dragState.startY;
        const minLeft = DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const minTop = DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - dragState.panelWidth - DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const maxTop = window.innerHeight - dragState.panelHeight - DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const clampedLeft = clampDesktopReviewPanelAxis(dragState.initialLeft + deltaX, minLeft, maxLeft);
        const clampedTop = clampDesktopReviewPanelAxis(dragState.initialTop + deltaY, minTop, maxTop);

        return {
            x: dragState.originX + clampedLeft - dragState.initialLeft,
            y: dragState.originY + clampedTop - dragState.initialTop,
        };
    }, []);

    const handleDesktopReviewPanelPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!shouldRenderDesktopReviewPanel || event.button !== 0) return;

        const target = event.target as HTMLElement | null;
        if (target?.closest('button,input,textarea,select,a,[role="button"],[data-desktop-map-review-no-drag="true"]')) {
            return;
        }

        const panel = desktopReviewPanelRef.current;
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        desktopReviewPanelDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            initialLeft: rect.left,
            initialTop: rect.top,
            originX: desktopReviewPanelPosition.x,
            originY: desktopReviewPanelPosition.y,
            panelWidth: rect.width,
            panelHeight: rect.height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    }, [desktopReviewPanelPosition.x, desktopReviewPanelPosition.y, shouldRenderDesktopReviewPanel]);

    const handleDesktopReviewPanelPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (desktopReviewPanelDragRef.current?.pointerId !== event.pointerId) return;

        const nextPosition = getClampedDesktopReviewPanelPosition(event.clientX, event.clientY);
        if (nextPosition) {
            setDesktopReviewPanelPosition(nextPosition);
        }
    }, [getClampedDesktopReviewPanelPosition]);

    const handleDesktopReviewPanelPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (desktopReviewPanelDragRef.current?.pointerId !== event.pointerId) return;

        desktopReviewPanelDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const moveDesktopReviewPanelByKeyboard = useCallback((deltaX: number, deltaY: number) => {
        const panel = desktopReviewPanelRef.current;
        if (!panel || typeof window === 'undefined') return;

        const rect = panel.getBoundingClientRect();
        const minLeft = DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const minTop = DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const maxLeft = window.innerWidth - rect.width - DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const maxTop = window.innerHeight - rect.height - DESKTOP_REVIEW_PANEL_VIEWPORT_MARGIN;
        const clampedLeft = clampDesktopReviewPanelAxis(rect.left + deltaX, minLeft, maxLeft);
        const clampedTop = clampDesktopReviewPanelAxis(rect.top + deltaY, minTop, maxTop);

        setDesktopReviewPanelPosition((current) => ({
            x: current.x + clampedLeft - rect.left,
            y: current.y + clampedTop - rect.top,
        }));
    }, []);

    const handleDesktopReviewPanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        const step = event.shiftKey ? DESKTOP_REVIEW_PANEL_KEYBOARD_STEP * 2 : DESKTOP_REVIEW_PANEL_KEYBOARD_STEP;
        const keyboardMoves: Partial<Record<string, [number, number]>> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        };
        const move = keyboardMoves[event.key];

        if (!move) return;

        event.preventDefault();
        moveDesktopReviewPanelByKeyboard(move[0], move[1]);
    }, [moveDesktopReviewPanelByKeyboard]);

    useEffect(() => {
        if (shouldRenderDesktopReviewPanel) return;

        desktopReviewPanelDragRef.current = null;
        setDesktopReviewPanelPosition(DEFAULT_DESKTOP_REVIEW_PANEL_POSITION);
    }, [shouldRenderDesktopReviewPanel]);

    useEffect(() => {
        if (!shouldRenderDesktopReviewPanel || typeof document === 'undefined') return;

        desktopReviewPanelOpenerRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const animationFrame = window.requestAnimationFrame(() => {
            desktopReviewPanelRef.current?.focus({ preventScroll: true });
        });

        return () => {
            window.cancelAnimationFrame(animationFrame);
            desktopReviewPanelOpenerRef.current?.focus({ preventScroll: true });
            desktopReviewPanelOpenerRef.current = null;
        };
    }, [shouldRenderDesktopReviewPanel]);

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

            {shouldRenderDesktopReviewPanel && (
                <section
                    ref={desktopReviewPanelRef}
                    className="fixed bottom-24 right-6 top-6 z-[95] flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-border bg-background/95 shadow-2xl backdrop-blur-sm will-change-transform"
                    style={{ transform: `translate3d(${desktopReviewPanelPosition.x}px, ${desktopReviewPanelPosition.y}px, 0)` }}
                    data-desktop-map-review-panel="true"
                    role="dialog"
                    tabIndex={-1}
                    aria-label="리뷰 작성 창"
                    title="빈 영역을 드래그하거나 화살표 키로 리뷰 작성 창 이동"
                    onKeyDown={handleDesktopReviewPanelKeyDown}
                >
                    <button
                        type="button"
                        className="flex h-7 shrink-0 cursor-move touch-none select-none items-center justify-center border-b border-border/70 bg-muted/35"
                        data-desktop-map-review-drag-handle="true"
                        title="마우스 드래그 또는 화살표 키로 리뷰 작성 창 이동"
                        aria-label="리뷰 작성 창 이동"
                        onKeyDown={handleDesktopReviewPanelKeyDown}
                        onPointerDown={handleDesktopReviewPanelPointerDown}
                        onPointerMove={handleDesktopReviewPanelPointerMove}
                        onPointerUp={handleDesktopReviewPanelPointerEnd}
                        onPointerCancel={handleDesktopReviewPanelPointerEnd}
                    >
                        <span className="h-1.5 w-12 rounded-full bg-muted-foreground/35" aria-hidden="true" />
                    </button>
                    <div className="min-h-0 flex-1">
                        <ReviewModal
                            isOpen={state.isReviewModalOpen}
                            onClose={() => state.setIsReviewModalOpen(false)}
                            restaurant={reviewRestaurant}
                            onSuccess={() => {
                                state.setRefreshTrigger((prev) => prev + 1);
                            }}
                            inline
                        />
                    </div>
                </section>
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
