'use client';

import type { ReactNode } from 'react';
import type { Restaurant } from '@/types/restaurant';
import { useRestaurantWithMergeContext } from '@/hooks/use-restaurant-detail';


type HydratedDetailRestaurantProps = {
    restaurant: Restaurant;
    children: (restaurant: Restaurant) => ReactNode;
};

export default function HydratedDetailRestaurant({ restaurant, children }: HydratedDetailRestaurantProps) {
    const { data: hydratedRestaurant } = useRestaurantWithMergeContext(restaurant);

    return <>{children(hydratedRestaurant ?? restaurant)}</>;
}
