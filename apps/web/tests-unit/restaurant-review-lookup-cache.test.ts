import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { selectRelatedRestaurantReviewIds } from '../lib/restaurant-review-lookup';

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

describe('restaurant review lookup 정규화 캐시', () => {
    test('후보 목록이 비면 직접 id만 돌려준다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });

        expect(selectRelatedRestaurantReviewIds(restaurant, [])).toEqual(['approved-id']);
    });

    test('후보 목록이 배열이 아니면 예외를 던지지 않고 직접 id만 돌려준다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });

        expect(selectRelatedRestaurantReviewIds(restaurant, undefined as unknown as Restaurant[])).toEqual(['approved-id']);
        expect(selectRelatedRestaurantReviewIds(null, undefined as unknown as Restaurant[])).toEqual([]);
    });

    test('같은 객체를 반복 조회해도 결과가 동일하다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = [
            makeRestaurant({ id: 'deleted-same', status: 'deleted' }),
            makeRestaurant({ id: 'deleted-other-address', status: 'deleted', road_address: '서울특별시 강남구 다른길 1', jibun_address: '서울특별시 강남구 다른동 1-1' }),
        ];

        const first = selectRelatedRestaurantReviewIds(restaurant, candidates);
        const second = selectRelatedRestaurantReviewIds(restaurant, candidates);

        expect(first).toEqual(['approved-id', 'deleted-same']);
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
    });

    test('후보의 주소가 바뀌면 캐시를 버리고 다시 계산한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidate = makeRestaurant({
            id: 'deleted-moved',
            status: 'deleted',
            road_address: '서울특별시 강남구 다른길 1',
            jibun_address: '서울특별시 강남구 다른동 1-1',
        });

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id']);

        candidate.road_address = '서울특별시 강남구 논현로85길 70';
        candidate.jibun_address = '서울특별시 강남구 역삼동 823-16';

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id', 'deleted-moved']);
    });

    test('후보의 이름이 승인 이름과 같아지면 다시 포함한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidate = makeRestaurant({
            id: 'deleted-renamed',
            status: 'deleted',
            name: '전혀다른가게',
            approved_name: null,
        });

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id']);

        candidate.approved_name = '데일리픽스 강남본점';

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id', 'deleted-renamed']);
    });

    test('승인 식당에 병합 레코드가 추가되면 주소 매칭 집합을 다시 계산한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidate = makeRestaurant({
            id: 'deleted-merged-address',
            status: 'deleted',
            road_address: '서울특별시 강남구 병합길 1',
            jibun_address: null,
        });

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id']);

        restaurant.mergedRestaurants = [
            makeRestaurant({ id: 'merged-1', road_address: '서울특별시 강남구 병합길 1', jibun_address: null }),
        ];

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate]))
            .toEqual(['approved-id', 'merged-1', 'deleted-merged-address']);
    });

    test('id가 없거나 목록에 null이 섞여도 건너뛴다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = [
            null,
            makeRestaurant({ id: '', status: 'deleted' }),
            makeRestaurant({ id: 'deleted-valid', status: 'deleted' }),
        ];

        expect(selectRelatedRestaurantReviewIds(restaurant, candidates as unknown as Restaurant[]))
            .toEqual(['approved-id', 'deleted-valid']);
    });

    test('후보 순서를 유지하고 중복 id는 한 번만 넣는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = [
            makeRestaurant({ id: 'deleted-b', status: 'deleted' }),
            makeRestaurant({ id: 'deleted-a', status: 'deleted' }),
            makeRestaurant({ id: 'deleted-b', status: 'deleted' }),
            makeRestaurant({ id: 'approved-id' }),
        ];

        expect(selectRelatedRestaurantReviewIds(restaurant, candidates))
            .toEqual(['approved-id', 'deleted-b', 'deleted-a']);
    });

    test('이름과 주소가 모두 비어 있는 후보는 주소 있는 승인 식당에 붙지 않는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const emptyCandidate = makeRestaurant({
            id: 'deleted-empty',
            status: 'deleted',
            name: null,
            approved_name: null,
            road_address: null,
            jibun_address: null,
        });

        expect(selectRelatedRestaurantReviewIds(restaurant, [emptyCandidate])).toEqual(['approved-id']);
    });
});
