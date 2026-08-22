import type { RefObject } from 'react';

import { NaverMapOverlayStack } from '@/components/map/naver-map-overlay-stack';
import { cn } from '@/lib/utils';

export function NaverMapSurface({
    announcementToastTitle,
    badgePositionClass,
    className,
    count,
    dataTestId,
    emptyStateMessage,
    isLoaded,
    isLoadingRestaurants,
    mapRef,
    mapToast,
    onAnnouncementToastClick,
    renderOverlayStack = true,
    restaurantCountToastCount,
    restaurantsLength,
    showAnnouncementToast,
    showOnlineUsers,
    showRestaurantCount,
}: {
    announcementToastTitle: string;
    badgePositionClass: string;
    className?: string;
    count: number;
    emptyStateMessage?: string;
    dataTestId?: string;
    isLoaded: boolean;
    isLoadingRestaurants: boolean;
    mapRef: RefObject<HTMLDivElement | null>;
    mapToast: { message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null;
    onAnnouncementToastClick?: () => void;
    renderOverlayStack?: boolean;
    restaurantCountToastCount: number;
    restaurantsLength: number;
    showAnnouncementToast: boolean;
    showOnlineUsers: boolean;
    showRestaurantCount: boolean;
}) {
    return (
        <div
            className={cn('relative h-full min-h-0 min-w-0 w-full overflow-hidden', className)}
            data-layout-primitives="overlay-stack frame"
            data-scroll-owner="map-canvas-none"
            data-map-layer-signature="naver-map-surface"
        >
            <div
                ref={mapRef}
                data-testid={dataTestId}
                className="w-full h-full"
            />

            {renderOverlayStack && (
                <NaverMapOverlayStack
                    announcementToastTitle={announcementToastTitle}
                    badgePositionClass={badgePositionClass}
                    count={count}
                    isLoaded={isLoaded}
                    isLoadingRestaurants={isLoadingRestaurants}
                    mapToast={mapToast}
                    onAnnouncementToastClick={onAnnouncementToastClick}
                    restaurantCountToastCount={restaurantCountToastCount}
                    restaurantsLength={restaurantsLength}
                    emptyStateMessage={emptyStateMessage}
                    showAnnouncementToast={showAnnouncementToast}
                    showOnlineUsers={showOnlineUsers}
                    showRestaurantCount={showRestaurantCount}
                />
            )}
        </div>
    );
}
