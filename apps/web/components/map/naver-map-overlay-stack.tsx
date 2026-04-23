import type { CSSProperties } from 'react';

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
    floatingToastPositionClass,
    isLoaded,
    isLoadingRestaurants,
    mapToast,
    onAnnouncementToastClick,
    restaurantsLength,
    showAnnouncementToast,
    showOnlineUsers,
    showRestaurantCount,
}: {
    announcementToastTitle: string;
    badgePositionClass: string;
    centerOffsetStyle: CSSProperties;
    count: number;
    floatingToastPositionClass: string;
    isLoaded: boolean;
    isLoadingRestaurants: boolean;
    mapToast: { message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null;
    onAnnouncementToastClick?: () => void;
    restaurantsLength: number;
    showAnnouncementToast: boolean;
    showOnlineUsers: boolean;
    showRestaurantCount: boolean;
}) {
    return (
        <>
            {(isLoadingRestaurants || !isLoaded) && (
                <MapLoadingIndicator
                    isLoaded={isLoaded}
                    style={centerOffsetStyle}
                    className={badgePositionClass}
                />
            )}

            {!isLoadingRestaurants && isLoaded && restaurantsLength > 0 && showRestaurantCount && (
                <RestaurantCountBadge
                    count={restaurantsLength}
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

            {!isLoadingRestaurants && isLoaded && restaurantsLength === 0 && (
                <div style={centerOffsetStyle} className={badgePositionClass}>
                    <EmptyStateIndicator />
                </div>
            )}

            {mapToast && mapToast.isVisible && (
                <div
                    style={centerOffsetStyle}
                    className={`${floatingToastPositionClass} bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2 animate-in fade-in zoom-in duration-300`}
                >
                    <span className="text-sm font-medium">
                        {mapToast.message}
                    </span>
                </div>
            )}
        </>
    );
}
