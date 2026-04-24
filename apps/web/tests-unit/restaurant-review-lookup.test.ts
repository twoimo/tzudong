import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    collectDirectRestaurantReviewIds,
    getRestaurantReviewLookupName,
    normalizeReviewLookupAddress,
    selectRelatedRestaurantReviewIds,
} from '../lib/restaurant-review-lookup';

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

describe('restaurant review lookup helpers', () => {
    test('normalizes addresses consistently for duplicate review lookup', () => {
        expect(normalizeReviewLookupAddress('서울특별시 강남구 논현로85길 70 2층'))
            .toBe(normalizeReviewLookupAddress('서울특별시  강남구 논현로85길 70'));
    });

    test('collects direct ids from selected restaurant and already merged records', () => {
        const restaurant = makeRestaurant({
            id: 'approved-id',
            mergedRestaurants: [
                makeRestaurant({ id: 'merged-id' }),
                makeRestaurant({ id: 'approved-id' }),
            ],
        });

        expect(collectDirectRestaurantReviewIds(restaurant)).toEqual(['approved-id', 'merged-id']);
    });

    test('includes deleted same-name same-address duplicate ids for Dailyfix review lookup', () => {
        const approvedMarkerRestaurant = makeRestaurant({
            id: 'e9d13f38-517a-48f1-a5a5-d5d07b525ae1',
            status: 'approved',
        });
        const deletedDuplicateWithReviews = makeRestaurant({
            id: 'bece1c59-f3b4-4b37-b69b-c3911fcf8791',
            status: 'deleted',
        });
        const sameNameDifferentAddress = makeRestaurant({
            id: 'different-branch',
            road_address: '서울특별시 강남구 다른길 1',
            jibun_address: '서울특별시 강남구 다른동 1-1',
        });
        const sameNameMissingAddress = makeRestaurant({
            id: 'missing-address',
            road_address: null,
            jibun_address: null,
        });

        expect(selectRelatedRestaurantReviewIds(approvedMarkerRestaurant, [
            deletedDuplicateWithReviews,
            sameNameDifferentAddress,
            sameNameMissingAddress,
        ])).toEqual([
            'e9d13f38-517a-48f1-a5a5-d5d07b525ae1',
            'bece1c59-f3b4-4b37-b69b-c3911fcf8791',
        ]);
    });

    test('uses approved_name as lookup fallback when name alias is absent', () => {
        expect(getRestaurantReviewLookupName(makeRestaurant({ name: undefined }))).toBe('데일리픽스 강남본점');
    });
});
