import type { HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';
import { MapThemeNotice } from './MapThemeNotice';
import {
    MapViewLoadingIndicator,
    MapViewRestaurantCountBadge,
} from '@/components/map/map-view-overlay-indicators';

export function MapViewOverlayStack({
    activeThemeId,
    isLoadingRestaurants,
    restaurantCount,
    showRestaurantCount,
}: {
    activeThemeId?: HomeMapThemeFilterId | null;
    isLoadingRestaurants: boolean;
    restaurantCount: number;
    showRestaurantCount: boolean;
}) {
    return (
        <>
            {!isLoadingRestaurants && !showRestaurantCount && activeThemeId && restaurantCount > 0 && <MapThemeNotice themeId={activeThemeId} className="absolute top-4 left-1/2 -translate-x-1/2" />}
            {isLoadingRestaurants && (
                <MapViewLoadingIndicator />
            )}

            {!isLoadingRestaurants && restaurantCount > 0 && showRestaurantCount && (
                <MapViewRestaurantCountBadge count={restaurantCount} />
            )}
        </>
    );
}
