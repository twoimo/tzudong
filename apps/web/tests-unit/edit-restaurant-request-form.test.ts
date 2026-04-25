import { describe, expect, test } from 'bun:test';

import { buildEditRestaurantInitialFormData } from '../lib/edit-restaurant-request-form';
import type { Restaurant } from '../types/restaurant';

const baseRestaurant = {
    id: 'restaurant-1',
    name: '데일리픽스 강남본점',
    road_address: '서울특별시 강남구 논현로85길 70',
    jibun_address: '서울특별시 강남구 역삼동 823-16',
    phone: '02-1234-5678',
    categories: ['패스트푸드'],
    youtube_link: 'https://www.youtube.com/watch?v=one',
    tzuyang_review: '리뷰 1',
} as Restaurant;

describe('edit restaurant request form data', () => {
    test('builds initial form data from the selected restaurant', () => {
        expect(buildEditRestaurantInitialFormData(baseRestaurant)).toMatchObject({
            name: '데일리픽스 강남본점',
            address: '서울특별시 강남구 논현로85길 70',
            phone: '02-1234-5678',
            category: ['패스트푸드'],
            youtube_reviews: [
                {
                    youtube_link: 'https://www.youtube.com/watch?v=one',
                    tzuyang_review: '리뷰 1',
                    restaurant_id: 'restaurant-1',
                },
            ],
        });
    });

    test('keeps every merged youtube record editable', () => {
        const formData = buildEditRestaurantInitialFormData({
            ...baseRestaurant,
            mergedRestaurants: [
                { ...baseRestaurant, id: 'restaurant-1', youtube_link: 'https://youtu.be/one' },
                { ...baseRestaurant, id: 'restaurant-2', youtube_link: 'https://youtu.be/two', tzuyang_review: '리뷰 2' },
            ],
        });

        expect(formData.youtube_reviews).toHaveLength(2);
        expect(formData.youtube_reviews.map((review) => review.restaurant_id)).toEqual(['restaurant-1', 'restaurant-2']);
    });
});
