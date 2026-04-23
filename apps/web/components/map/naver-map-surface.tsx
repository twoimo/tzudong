import type { CSSProperties, RefObject } from 'react';

import { NaverMapOverlayStack } from '@/components/map/naver-map-overlay-stack';

export function NaverMapSurface({
    announcementToastTitle,
    badgePositionClass,
    centerOffsetStyle,
    className,
    count,
    dataTestId,
    floatingToastPositionClass,
    isLoaded,
    isLoadingRestaurants,
    mapRef,
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
    className?: string;
    count: number;
    dataTestId?: string;
    floatingToastPositionClass: string;
    isLoaded: boolean;
    isLoadingRestaurants: boolean;
    mapRef: RefObject<HTMLDivElement | null>;
    mapToast: { message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null;
    onAnnouncementToastClick?: () => void;
    restaurantsLength: number;
    showAnnouncementToast: boolean;
    showOnlineUsers: boolean;
    showRestaurantCount: boolean;
}) {
    return (
        <div className={className}>
            <div
                ref={mapRef}
                data-testid={dataTestId}
                className="w-full h-full"
            />

            <NaverMapOverlayStack
                announcementToastTitle={announcementToastTitle}
                badgePositionClass={badgePositionClass}
                centerOffsetStyle={centerOffsetStyle}
                count={count}
                floatingToastPositionClass={floatingToastPositionClass}
                isLoaded={isLoaded}
                isLoadingRestaurants={isLoadingRestaurants}
                mapToast={mapToast}
                onAnnouncementToastClick={onAnnouncementToastClick}
                restaurantsLength={restaurantsLength}
                showAnnouncementToast={showAnnouncementToast}
                showOnlineUsers={showOnlineUsers}
                showRestaurantCount={showRestaurantCount}
            />
        </div>
    );
}
