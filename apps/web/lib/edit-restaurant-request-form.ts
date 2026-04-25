import type { Restaurant } from '@/types/restaurant';

export type EditRestaurantInitialFormData = {
    name: string;
    address: string;
    phone: string;
    category: string[];
    youtube_reviews: Array<{
        youtube_link: string;
        tzuyang_review: string;
        restaurant_id: string;
    }>;
};

export function buildEditRestaurantInitialFormData(restaurant: Restaurant): EditRestaurantInitialFormData {
    const youtubeReviews: EditRestaurantInitialFormData['youtube_reviews'] = [];
    const records = restaurant.mergedRestaurants?.length ? restaurant.mergedRestaurants : [restaurant];

    records.forEach((record) => {
        if (!record.id) return;
        if (!record.youtube_link && !record.tzuyang_review) return;

        youtubeReviews.push({
            youtube_link: record.youtube_link ?? '',
            tzuyang_review: record.tzuyang_review ?? '',
            restaurant_id: record.id,
        });
    });

    if (youtubeReviews.length === 0) {
        youtubeReviews.push({
            youtube_link: restaurant.youtube_link ?? '',
            tzuyang_review: restaurant.tzuyang_review ?? '',
            restaurant_id: restaurant.id,
        });
    }

    return {
        name: restaurant.name,
        address: restaurant.road_address || restaurant.jibun_address || '',
        phone: restaurant.phone || '',
        category: Array.isArray(restaurant.categories)
            ? restaurant.categories
            : (restaurant.categories ? [restaurant.categories] : []),
        youtube_reviews: youtubeReviews,
    };
}
