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

describe('related review count 빈 값/실패 처리', () => {
    test('식당 목록이 비면 빈 맵을 돌려준다', () => {
        expect([...buildRelatedVerifiedReviewCountMap([], [], null).entries()]).toEqual([]);
    });

    test('리뷰 행이 null이거나 비어 있어도 0으로 계산한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });

        expect(buildRelatedVerifiedReviewCountMap([restaurant], [restaurant], null).get('approved-id')).toBe(0);
        expect(buildRelatedVerifiedReviewCountMap([restaurant], [restaurant], []).get('approved-id')).toBe(0);
    });

    test('restaurant_id가 없는 리뷰 행은 어느 식당에도 합산하지 않는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });

        const countMap = buildRelatedVerifiedReviewCountMap(
            [restaurant],
            [restaurant],
            [{ restaurant_id: null }],
        );

        expect(countMap.get('approved-id')).toBe(0);
    });

    test('같은 식당에 달린 여러 리뷰를 합산한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const deletedDuplicate = makeRestaurant({ id: 'deleted-dailyfix', status: 'deleted' });

        const countMap = buildRelatedVerifiedReviewCountMap(
            [restaurant],
            [restaurant, deletedDuplicate],
            [
                { restaurant_id: 'approved-id' },
                { restaurant_id: 'deleted-dailyfix' },
                { restaurant_id: 'deleted-dailyfix' },
            ],
        );

        expect(countMap.get('approved-id')).toBe(3);
    });

    test('후보 목록에 없는 리뷰는 합산하지 않는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });

        const countMap = buildRelatedVerifiedReviewCountMap(
            [restaurant],
            [],
            [{ restaurant_id: 'unknown-restaurant' }],
        );

        expect(countMap.get('approved-id')).toBe(0);
    });
});
