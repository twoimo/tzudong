import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Restaurant } from '../types/restaurant';
import { compareStampRestaurants, createVisitedLookup } from '../lib/stamp-restaurant-order';

const webRoot = path.resolve(import.meta.dir, '..');

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

// 정렬 순서를 흔들어 두어 비교 정렬이 실제로 여러 번 비교하도록 만든다.
const makeMixedList = (count: number) => Array.from({ length: count }, (_, index) => makeRestaurant({
    id: 'visited-lookup-' + index,
    name: '맛집 ' + index,
    review_count: (index * 37) % count,
}));

describe('stamp visited lookup memoization', () => {
    test('asks the visit predicate once per restaurant even though the comparator repeats', () => {
        const restaurants = makeMixedList(64);
        const visitedIds = new Set(['visited-lookup-3', 'visited-lookup-40']);
        let calls = 0;
        const isVisited = createVisitedLookup((restaurant: Restaurant) => {
            calls += 1;
            return visitedIds.has(restaurant.id);
        });

        const sorted = [...restaurants].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited,
            sortColumn: 'fanVisits',
            sortDirection: 'desc',
        }));

        expect(sorted).toHaveLength(restaurants.length);
        expect(calls).toBe(restaurants.length);
    });

    test('produces the same order as the unmemoized comparator', () => {
        const restaurants = makeMixedList(48);
        const visitedIds = new Set(restaurants
            .filter((_, index) => index % 3 === 0)
            .map((restaurant) => restaurant.id));
        const isVisited = (restaurant: Restaurant) => visitedIds.has(restaurant.id);

        const direct = [...restaurants].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited,
            sortColumn: 'fanVisits',
            sortDirection: 'desc',
        }));
        const memoized = [...restaurants].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited: createVisitedLookup(isVisited),
            sortColumn: 'fanVisits',
            sortDirection: 'desc',
        }));

        expect(memoized.map((restaurant) => restaurant.id)).toEqual(direct.map((restaurant) => restaurant.id));
        expect(memoized.slice(0, 16).every((restaurant) => visitedIds.has(restaurant.id))).toBe(true);
    });

    test('caches a false verdict too, so unvisited restaurants are not recomputed', () => {
        const restaurants = makeMixedList(32);
        let calls = 0;
        const isVisited = createVisitedLookup(() => {
            calls += 1;
            return false;
        });

        const sorted = [...restaurants].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited,
            sortColumn: 'name',
            sortDirection: 'asc',
        }));

        expect(sorted).toHaveLength(restaurants.length);
        expect(calls).toBe(restaurants.length);
    });

    test('judges distinct objects that share an id separately', () => {
        const first = makeRestaurant({ id: 'shared-id', name: '가게', approved_name: '가게' });
        const second = makeRestaurant({ id: 'shared-id', name: '다른 가게', approved_name: '다른 가게' });
        let calls = 0;
        const lookup = createVisitedLookup((restaurant) => {
            calls += 1;
            return restaurant.name === '가게';
        });

        expect(lookup(first)).toBe(true);
        expect(lookup(second)).toBe(false);
        expect(lookup(first)).toBe(true);
        expect(calls).toBe(2);
    });

    test('wires the memoized lookup into the stamp page comparator', () => {
        const pageSource = readFileSync(path.join(webRoot, 'app/stamp/page.tsx'), 'utf8');
        const comparatorCall = pageSource.match(/compareStampRestaurants\(a, b, \{[^}]*\}/);

        expect(pageSource).toContain('const isVisitedForList = createVisitedLookup(isVisited);');
        expect(pageSource).toContain('result.filter(r => !isVisitedForList(r))');
        expect(comparatorCall?.[0]).toContain('isVisited: isVisitedForList');
    });

    test('wires the memoized lookup into the stamp overlay comparator', () => {
        const overlaySource = readFileSync(
            path.join(webRoot, 'components/overlay-pages/StampOverlay.tsx'),
            'utf8',
        );
        const comparatorCall = overlaySource.match(/compareStampRestaurants\(a, b, \{[^}]*\}/);

        expect(overlaySource).toContain('const isVisitedForList = createVisitedLookup(isVisited);');
        expect(overlaySource).toContain('result.filter(r => !isVisitedForList(r))');
        expect(comparatorCall?.[0]).toContain('isVisited: isVisitedForList');
    });
});
