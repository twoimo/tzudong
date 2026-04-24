import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    findCanonicalVisitedRestaurant,
    hasRelatedVerifiedUserReview,
} from '../lib/restaurant-visit-matching';

const makeRestaurant = (overrides: Partial<Restaurant>): Restaurant => ({
    id: 'approved-id',
    name: '데일리픽스 강남본점',
    approved_name: '데일리픽스 강남본점',
    road_address: '서울특별시 강남구 논현로85길 70',
    jibun_address: '서울특별시 강남구 역삼동 823-16',
    status: 'approved',
    lat: 37.4977795,
    lng: 127.0324869,
    categories: ['패스트푸드'],
    category: ['패스트푸드'],
    weekly_search_count: null,
    ...overrides,
} as Restaurant);

describe('restaurant visit matching', () => {
    test('marks approved canonical restaurant as visited when review is attached to deleted duplicate', () => {
        const approvedRestaurant = makeRestaurant({ id: 'approved-dailyfix', status: 'approved' });
        const deletedReviewedRestaurant = makeRestaurant({ id: 'deleted-dailyfix', status: 'deleted' });

        expect(hasRelatedVerifiedUserReview({
            restaurant: approvedRestaurant,
            reviewedRestaurantIds: new Set(['deleted-dailyfix']),
            reviewedRestaurants: [deletedReviewedRestaurant],
        })).toBe(true);
    });

    test('does not match same-name reviews at a different address', () => {
        const approvedRestaurant = makeRestaurant({ id: 'approved-dailyfix', status: 'approved' });
        const differentBranch = makeRestaurant({
            id: 'deleted-other-branch',
            road_address: '서울특별시 강남구 다른길 1',
            jibun_address: '서울특별시 강남구 다른동 1-1',
            status: 'deleted',
        });

        expect(hasRelatedVerifiedUserReview({
            restaurant: approvedRestaurant,
            reviewedRestaurantIds: new Set(['deleted-other-branch']),
            reviewedRestaurants: [differentBranch],
        })).toBe(false);
    });

    test('resolves a deleted reviewed restaurant back to its approved canonical card', () => {
        const approvedRestaurant = makeRestaurant({ id: 'approved-dailyfix', status: 'approved' });
        const deletedReviewedRestaurant = makeRestaurant({ id: 'deleted-dailyfix', status: 'deleted' });

        expect(findCanonicalVisitedRestaurant({
            reviewedRestaurant: deletedReviewedRestaurant,
            reviewedRestaurantId: deletedReviewedRestaurant.id,
            approvedRestaurants: [
                makeRestaurant({
                    id: 'different-branch',
                    road_address: '서울특별시 강남구 다른길 1',
                    jibun_address: '서울특별시 강남구 다른동 1-1',
                }),
                approvedRestaurant,
            ],
        })?.id).toBe('approved-dailyfix');
    });
});
