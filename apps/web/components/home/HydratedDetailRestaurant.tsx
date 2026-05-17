'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Restaurant } from '@/types/restaurant';
import { useRestaurantWithMergeContext } from '@/hooks/use-restaurant-detail';

const DETAIL_HYDRATION_IDLE_DELAY_MS = 8000;

type HydratedDetailRestaurantProps = {
    restaurant: Restaurant;
    children: (restaurant: Restaurant) => ReactNode;
};

export default function HydratedDetailRestaurant({ restaurant, children }: HydratedDetailRestaurantProps) {
    const [shouldHydrateDetail, setShouldHydrateDetail] = useState(false);
    const restaurantId = restaurant.id;

    useEffect(() => {
        setShouldHydrateDetail(false);

        const timer = window.setTimeout(() => {
            setShouldHydrateDetail(true);
        }, DETAIL_HYDRATION_IDLE_DELAY_MS);

        return () => window.clearTimeout(timer);
    }, [restaurantId]);

    const { data: hydratedRestaurant } = useRestaurantWithMergeContext(
        shouldHydrateDetail ? restaurant : null
    );

    return <>{children(hydratedRestaurant ?? restaurant)}</>;
}
