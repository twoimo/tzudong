import type { HomeMapThemeFilterId } from '@/lib/home-map-theme-filters';
import type { RefObject } from 'react';

import { MapViewAdminAddButton } from '@/components/map/map-view-sidepanels';
import { MapViewOverlayStack } from '@/components/map/map-view-overlay-stack';

export function MapViewSurface({
    activeThemeId,
    isLoadingRestaurants,
    mapRef,
    onAdminAddRestaurant,
    restaurantCount,
    showRestaurantCount,
}: {
    activeThemeId?: HomeMapThemeFilterId | null;
    isLoadingRestaurants: boolean;
    mapRef: RefObject<HTMLDivElement | null>;
    onAdminAddRestaurant?: () => void;
    restaurantCount: number;
    showRestaurantCount: boolean;
}) {
    return (
        <>
            <div
                ref={mapRef}
                className="flex-1 h-full"
            />

            <MapViewOverlayStack
                activeThemeId={activeThemeId}
                isLoadingRestaurants={isLoadingRestaurants}
                restaurantCount={restaurantCount}
                showRestaurantCount={showRestaurantCount}
            />

            {onAdminAddRestaurant && <MapViewAdminAddButton onClick={onAdminAddRestaurant} />}
        </>
    );
}
