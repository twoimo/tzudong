import {
    AnnouncementToastBadge,
    EmptyStateIndicator,
    MapLoadingIndicator,
    OnlineUsersBadge,
    RestaurantCountBadge,
} from '@/components/map/naver-map-overlay-indicators';
import { MapOverlayNotice } from '@/components/map/map-overlay-notice';

export type NaverMapOverlayKind = 'loading' | 'map-toast' | 'announcement' | 'restaurant-count' | 'online-users' | 'empty';

export const NAVER_MAP_TIMED_OVERLAY_LIFECYCLE_POLICY = {
    lowerPriorityOnPreemption: 'drop',
    timedOccurrenceResume: 'never',
    persistentEmptyResume: 'when-timed-slot-clears',
} as const;

export type NaverMapTimedOverlayDropPlan = {
    dropAnnouncement: boolean;
    dropMapToast: boolean;
    dropOnlineUsers: boolean;
    dropRestaurantCount: boolean;
};

export function resolveNaverMapTimedOverlayDropPlan(
    overlayKind: NaverMapOverlayKind | null,
): NaverMapTimedOverlayDropPlan {
    return {
        dropMapToast: overlayKind === 'loading',
        dropAnnouncement: overlayKind === 'loading' || overlayKind === 'map-toast',
        dropRestaurantCount: overlayKind === 'loading' || overlayKind === 'map-toast' || overlayKind === 'announcement',
        dropOnlineUsers: overlayKind === 'loading'
            || overlayKind === 'map-toast'
            || overlayKind === 'announcement'
            || overlayKind === 'restaurant-count',
    };
}

export function resolveNaverMapOverlayKind({
    hasAnnouncementTitle,
    isLoaded,
    isLoadingRestaurants,
    isMapToastVisible,
    restaurantsLength,
    showAnnouncementToast,
    showOnlineUsers,
    showRestaurantCount,
}: {
    hasAnnouncementTitle: boolean;
    isLoaded: boolean;
    isLoadingRestaurants: boolean;
    isMapToastVisible: boolean;
    restaurantsLength: number;
    showAnnouncementToast: boolean;
    showOnlineUsers: boolean;
    showRestaurantCount: boolean;
}): NaverMapOverlayKind | null {
    if (isLoadingRestaurants || !isLoaded) return 'loading';
    if (isMapToastVisible) return 'map-toast';
    if (showAnnouncementToast && hasAnnouncementTitle) return 'announcement';
    if (restaurantsLength > 0 && showRestaurantCount) return 'restaurant-count';
    if (showOnlineUsers) return 'online-users';
    if (restaurantsLength === 0) return 'empty';
    return null;
}

export function NaverMapOverlayStack({
    announcementToastTitle,
    badgePositionClass,
    count,
    emptyStateMessage,
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
    count: number;
    emptyStateMessage?: string;
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

    const overlayKind = resolveNaverMapOverlayKind({
        hasAnnouncementTitle: Boolean(announcementToastTitle),
        isLoaded,
        isLoadingRestaurants,
        isMapToastVisible: mapToast?.isVisible === true,
        restaurantsLength,
        showAnnouncementToast,
        showOnlineUsers,
        showRestaurantCount,
    });

    if (!overlayKind) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-0 z-[70]">
            <div className={badgePositionClass} data-map-overlay-kind={overlayKind}>
                {overlayKind === 'loading' ? (
                    <MapLoadingIndicator
                        isLoaded={isLoaded}
                        isBusy
                    />
                ) : null}

                {overlayKind === 'restaurant-count' ? (
                    <RestaurantCountBadge count={restaurantCountToastCount} />
                ) : null}

                {overlayKind === 'online-users' ? (
                    <OnlineUsersBadge count={count} />
                ) : null}

                {overlayKind === 'announcement' ? (
                    <AnnouncementToastBadge
                        title={announcementToastTitle}
                        onClick={onAnnouncementToastClick}
                    />
                ) : null}

                {overlayKind === 'empty' ? (
                    <EmptyStateIndicator message={emptyStateMessage} />
                ) : null}

                {overlayKind === 'map-toast' && mapToast ? (
                    <MapOverlayNotice
                        role={mapToast.type === 'error' ? 'alert' : 'status'}
                        ariaLive={mapToast.type === 'error' ? 'assertive' : 'polite'}
                    >
                        {mapToast.message}
                    </MapOverlayNotice>
                ) : null}
            </div>
        </div>
    );
}
