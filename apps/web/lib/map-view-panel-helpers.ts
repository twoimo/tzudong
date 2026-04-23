import type { Restaurant } from '@/types/restaurant';

export function buildMapViewPanelStateSetter({
    onTogglePanelCollapse,
    setLocalIsPanelOpen,
}: {
    onTogglePanelCollapse?: () => void;
    setLocalIsPanelOpen: (isOpen: boolean) => void;
}) {
    return (isOpen: boolean) => {
        if (onTogglePanelCollapse) {
            onTogglePanelCollapse();
            return;
        }
        setLocalIsPanelOpen(isOpen);
    };
}

export function resolveMapViewPanelWidth({
    panelWidth,
    propPanelWidth,
}: {
    panelWidth: number;
    propPanelWidth?: number;
}) {
    return propPanelWidth !== undefined ? propPanelWidth : panelWidth;
}

export function resolveMapViewPanelOpenState({
    localIsPanelOpen,
    propIsPanelOpen,
}: {
    localIsPanelOpen: boolean;
    propIsPanelOpen?: boolean;
}) {
    return propIsPanelOpen !== undefined ? propIsPanelOpen : localIsPanelOpen;
}

export function buildMapViewPanelCloseHandler({
    onPanelClose,
    setIsPanelOpen,
}: {
    onPanelClose?: () => void;
    setIsPanelOpen: (isOpen: boolean) => void;
}) {
    return () => {
        if (onPanelClose) {
            onPanelClose();
            return;
        }
        setIsPanelOpen(false);
    };
}

export function buildMapViewTogglePanelHandler({
    isPanelOpen,
    setIsPanelOpen,
}: {
    isPanelOpen: boolean;
    setIsPanelOpen: (isOpen: boolean) => void;
}) {
    return () => {
        setIsPanelOpen(!isPanelOpen);
    };
}

export function buildMapViewReviewOpenHandler(setIsReviewModalOpen: (isOpen: boolean) => void) {
    return () => setIsReviewModalOpen(true);
}

export function buildMapViewRestaurantAction(
    action: ((restaurant: Restaurant) => void) | undefined,
    restaurant: Restaurant | null | undefined,
) {
    return action && restaurant ? () => action(restaurant) : undefined;
}
