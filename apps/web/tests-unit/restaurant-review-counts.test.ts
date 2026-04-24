import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { buildRelatedVerifiedReviewCountMap } from '../lib/restaurant-review-counts';

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

describe('related restaurant review counts', () => {
    test('counts verified reviews attached to a deleted duplicate for its approved canonical card', () => {
        const approvedRestaurant = makeRestaurant({ id: 'approved-dailyfix', status: 'approved' });
        const deletedDuplicate = makeRestaurant({ id: 'deleted-dailyfix', status: 'deleted' });

        const countMap = buildRelatedVerifiedReviewCountMap(
            [approvedRestaurant],
            [approvedRestaurant, deletedDuplicate],
            [{ restaurant_id: 'deleted-dailyfix' }]
        );

        expect(countMap.get('approved-dailyfix')).toBe(1);
    });

    test('does not count same-name reviews from a different address', () => {
        const approvedRestaurant = makeRestaurant({ id: 'approved-dailyfix', status: 'approved' });
        const differentBranch = makeRestaurant({
            id: 'deleted-other-branch',
            road_address: '서울특별시 강남구 다른길 1',
            jibun_address: '서울특별시 강남구 다른동 1-1',
            status: 'deleted',
        });

        const countMap = buildRelatedVerifiedReviewCountMap(
            [approvedRestaurant],
            [approvedRestaurant, differentBranch],
            [{ restaurant_id: 'deleted-other-branch' }]
        );

        expect(countMap.get('approved-dailyfix')).toBe(0);
    });
});
