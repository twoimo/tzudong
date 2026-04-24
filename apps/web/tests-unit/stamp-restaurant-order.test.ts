import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { compareStampRestaurants } from '../lib/stamp-restaurant-order';

const makeRestaurant = (overrides: Partial<Restaurant>): Restaurant => ({
    id: 'restaurant-id',
    name: '맛집',
    approved_name: '맛집',
    road_address: '서울특별시 강남구 테스트로 1',
    jibun_address: '서울특별시 강남구 테스트동 1-1',
    status: 'approved',
    lat: 37,
    lng: 127,
    categories: ['한식'],
    category: ['한식'],
    review_count: 0,
    weekly_search_count: null,
    ...overrides,
} as Restaurant);

describe('stamp restaurant ordering', () => {
    test('puts stamped restaurants before higher-review unvisited restaurants', () => {
        const dailyfix = makeRestaurant({ id: 'dailyfix', name: '데일리픽스 강남본점', review_count: 0 });
        const popularUnvisited = makeRestaurant({ id: 'popular', name: '인기 미방문 맛집', review_count: 999 });
        const visitedIds = new Set(['dailyfix']);

        const sorted = [popularUnvisited, dailyfix].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited: (restaurant) => visitedIds.has(restaurant.id),
            sortColumn: 'fanVisits',
            sortDirection: 'desc',
        }));

        expect(sorted.map((restaurant) => restaurant.id)).toEqual(['dailyfix', 'popular']);
    });

    test('keeps the selected sort order inside the stamped group', () => {
        const lowReviewVisited = makeRestaurant({ id: 'visited-low', review_count: 1 });
        const highReviewVisited = makeRestaurant({ id: 'visited-high', review_count: 5 });
        const visitedIds = new Set(['visited-low', 'visited-high']);

        const sorted = [lowReviewVisited, highReviewVisited].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited: (restaurant) => visitedIds.has(restaurant.id),
            sortColumn: 'fanVisits',
            sortDirection: 'desc',
        }));

        expect(sorted.map((restaurant) => restaurant.id)).toEqual(['visited-high', 'visited-low']);
    });
});
