import {
    MapViewLoadingIndicator,
    MapViewRestaurantCountBadge,
} from '@/components/map/map-view-overlay-indicators';

export function MapViewOverlayStack({
    isLoadingRestaurants,
    restaurantCount,
    showRestaurantCount,
}: {
    isLoadingRestaurants: boolean;
    restaurantCount: number;
    showRestaurantCount: boolean;
}) {
    return (
        <>
            {isLoadingRestaurants && (
                <MapViewLoadingIndicator />
            )}

            {!isLoadingRestaurants && restaurantCount > 0 && showRestaurantCount && (
                <MapViewRestaurantCountBadge count={restaurantCount} />
            )}
        </>
    );
}
