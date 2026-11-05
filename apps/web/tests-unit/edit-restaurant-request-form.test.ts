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

    test('keeps records with only a video link or only a review editable', () => {
        const formData = buildEditRestaurantInitialFormData({
            ...baseRestaurant,
            id: 'link-only',
            mergedRestaurants: [
                { ...baseRestaurant, id: 'link-only', tzuyang_review: null },
                { ...baseRestaurant, id: 'review-only', youtube_link: null },
            ],
        });

        expect(formData.youtube_reviews).toEqual([
            { youtube_link: baseRestaurant.youtube_link, tzuyang_review: '', restaurant_id: 'link-only' },
            { youtube_link: '', tzuyang_review: baseRestaurant.tzuyang_review, restaurant_id: 'review-only' },
        ]);
    });

    test('provides one editable target when both video fields are missing', () => {
        const formData = buildEditRestaurantInitialFormData({
            ...baseRestaurant,
            youtube_link: null,
            tzuyang_review: null,
        });

        expect(formData.youtube_reviews).toEqual([
            { youtube_link: '', tzuyang_review: '', restaurant_id: baseRestaurant.id },
        ]);
    });

    test('keeps the selected target editable when only a merged sibling has video data', () => {
        const formData = buildEditRestaurantInitialFormData({
            ...baseRestaurant,
            youtube_link: null,
            tzuyang_review: null,
            mergedRestaurants: [
                { ...baseRestaurant, youtube_link: null, tzuyang_review: null },
                { ...baseRestaurant, id: 'restaurant-2' },
            ],
        });

        expect(formData.youtube_reviews.map((review) => review.restaurant_id)).toEqual(['restaurant-2', 'restaurant-1']);
        expect(formData.youtube_reviews[1]).toEqual({ youtube_link: '', tzuyang_review: '', restaurant_id: 'restaurant-1' });
    });
});
