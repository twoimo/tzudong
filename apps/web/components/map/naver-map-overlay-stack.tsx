import type { CSSProperties } from 'react';

import { MapOverlayNotice } from '@/components/map/map-overlay-notice';
import {
    AnnouncementToastBadge,
    EmptyStateIndicator,
    MapLoadingIndicator,
    OnlineUsersBadge,
    RestaurantCountBadge,
} from '@/components/map/naver-map-overlay-indicators';

export function NaverMapOverlayStack({
    announcementToastTitle,
    badgePositionClass,
    centerOffsetStyle,
    count,
    emptyStateMessage,
    floatingToastPositionClass,
    isLoaded,
    isLoadingRestaurants,
    isMobileOverlayReady = true,
    mapToast,
    onAnnouncementToastClick,
    restaurantCountToastCount,
    restaurantsLength,
    showAnnouncementToast,
    showOnlineUsers,
    showRestaurantCount,
}: {
    announcementToastTitle: string;
    badgePositionClass: string;
    centerOffsetStyle: CSSProperties;
    count: number;
    emptyStateMessage?: string;
    floatingToastPositionClass: string;
    isLoaded: boolean;
    isLoadingRestaurants: boolean;
    isMobileOverlayReady?: boolean;
    mapToast: { message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null;
    onAnnouncementToastClick?: () => void;
    restaurantCountToastCount: number;
    restaurantsLength: number;
    showAnnouncementToast: boolean;
    showOnlineUsers: boolean;
    showRestaurantCount: boolean;
}) {
    if (!isMobileOverlayReady) {
        return null;
    }

    return (
        <>
            {(isLoadingRestaurants || !isLoaded) && (
                <MapLoadingIndicator
                    isLoaded={isLoaded}
                    isBusy={isLoadingRestaurants || !isLoaded}
                    style={centerOffsetStyle}
                    className={badgePositionClass}
                />
            )}

            {!isLoadingRestaurants && isLoaded && restaurantsLength > 0 && showRestaurantCount && (
                <RestaurantCountBadge
                    count={restaurantCountToastCount}
                    style={centerOffsetStyle}
                    className={badgePositionClass}
                />
            )}

            {showOnlineUsers && !showRestaurantCount && (
                <OnlineUsersBadge
                    count={count}
                    style={centerOffsetStyle}
                    className={badgePositionClass}
                />
            )}

            {showAnnouncementToast && !showRestaurantCount && !showOnlineUsers && announcementToastTitle && (
                <AnnouncementToastBadge
                    title={announcementToastTitle}
                    style={centerOffsetStyle}
                    className={badgePositionClass}
                    onClick={onAnnouncementToastClick}
                />
            )}

            {isMobileOverlayReady && !isLoadingRestaurants && isLoaded && restaurantsLength === 0 && (
                <div className={floatingToastPositionClass}>
                    <EmptyStateIndicator message={emptyStateMessage} />
                </div>
            )}

            {mapToast && mapToast.isVisible && (
                <MapOverlayNotice
                    className={`${floatingToastPositionClass} rounded-lg border border-border shadow-lg animate-in fade-in zoom-in duration-300 motion-reduce:animate-none`}
                    role={mapToast.type === 'error' ? 'alert' : 'status'}
                    ariaLive={mapToast.type === 'error' ? 'assertive' : 'polite'}
                >
                    {mapToast.message}
                </MapOverlayNotice>
            )}
        </>
    );
}
