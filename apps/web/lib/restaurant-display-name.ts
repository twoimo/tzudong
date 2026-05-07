import type { Restaurant } from '@/types/restaurant';

type RestaurantDisplayNameInput = Partial<
    Pick<
        Restaurant,
        | 'approved_name'
        | 'name'
        | 'naver_name'
        | 'origin_name'
        | 'google_name'
        | 'channel_name'
    >
>;

const DEFAULT_RESTAURANT_DISPLAY_NAME = '알 수 없음';

export function getRestaurantDisplayName(
    restaurant: RestaurantDisplayNameInput | null | undefined,
    fallback = DEFAULT_RESTAURANT_DISPLAY_NAME
): string {
    const candidates = [
        restaurant?.approved_name,
        restaurant?.name,
        restaurant?.naver_name,
        restaurant?.origin_name,
        restaurant?.google_name,
        restaurant?.channel_name,
    ];

    return candidates.find((candidate) => Boolean(candidate?.trim()))?.trim() || fallback;
}

export function withRestaurantDisplayName<T extends RestaurantDisplayNameInput>(
    restaurant: T
): T & { name: string } {
    return {
        ...restaurant,
        name: getRestaurantDisplayName(restaurant),
    };
}
