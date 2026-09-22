import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    createVisitedRestaurantMatcher,
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
} from '../lib/restaurant-review-lookup';
import { hasRelatedVerifiedUserReview } from '../lib/restaurant-visit-matching';

// 색인 기반 방문 판정기(createVisitedRestaurantMatcher)가 선형 판정(hasRelatedVerifiedUserReview)과
// 맛집마다 같은 참/거짓을 돌려주는지 확인합니다. 도장/미방문 목록은 이 판정 결과로 갈리므로,
// 판정이 하나라도 달라지면 화면이 달라집니다.
type Row = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
>;

function row(
    id: string,
    name: string,
    roadAddress: string | null,
    jibunAddress: string | null = roadAddress,
    mergedRestaurants?: Row[]
): Row {
    return {
        id,
        name,
        approved_name: name,
        road_address: roadAddress,
        jibun_address: jibunAddress,
        mergedRestaurants,
    } as Row;
}

function linearVisited(restaurant: Row | null, candidates: Row[], visitedIds: Set<string>): boolean {
    return hasRelatedVerifiedUserReview({
        restaurant: restaurant as never,
        reviewedRestaurantIds: visitedIds,
        reviewedRestaurants: candidates as never,
    });
}

function matcherVisited(restaurant: Row | null, candidates: Row[], visitedIds: Set<string>): boolean {
    const isVisited = createVisitedRestaurantMatcher(candidates as never, visitedIds) as unknown as (
        restaurant: Row | null
    ) => boolean;

    return isVisited(restaurant);
}

function expectSameVerdict(
    restaurant: Row | null,
    candidates: Row[],
    visitedIds: Set<string>
): boolean {
    const linear = linearVisited(restaurant, candidates, visitedIds);
    const indexed = matcherVisited(restaurant, candidates, visitedIds);

    expect(indexed).toBe(linear);
    return linear;
}

describe('visited restaurant matcher', () => {
    test('맛집 자신의 id가 방문 집합에 있으면 후보 없이 방문으로 본다', () => {
        const restaurant = row('approved-1', '쯔동분식 1', '서울 중구 쯔동로 1');

        expect(expectSameVerdict(restaurant, [], new Set(['approved-1']))).toBe(true);
    });

    test('병합 레코드의 id가 방문 집합에 있으면 방문으로 본다', () => {
        const restaurant = row('approved-2', '쯔동분식 2', '서울 중구 쯔동로 2', '서울 중구 쯔동로 2', [
            row('merged-2', '쯔동분식 2', '서울 중구 쯔동로 2'),
        ]);

        expect(expectSameVerdict(restaurant, [], new Set(['merged-2']))).toBe(true);
        expect(expectSameVerdict(restaurant, [], new Set(['merged-2-x']))).toBe(false);
    });

    test('주소와 이름이 모두 맞는 후보가 방문 집합에 있으면 방문으로 본다', () => {
        const restaurant = row('approved-3', '쯔동분식 3', '서울 중구 쯔동로 3');
        const candidate = row('reviewed-3', '쯔동분식 3', '서울 중구 쯔동로 3');

        expect(expectSameVerdict(restaurant, [candidate], new Set(['reviewed-3']))).toBe(true);
    });

    test('주소는 같아도 이름이 호환되지 않으면 방문으로 보지 않는다', () => {
        const restaurant = row('approved-4', '쯔동분식 4', '서울 중구 쯔동로 4');
        const candidate = row('reviewed-4', '다른집 4', '서울 중구 쯔동로 4');

        expect(expectSameVerdict(restaurant, [candidate], new Set(['reviewed-4']))).toBe(false);
    });

    test('이름이 같아도 주소가 다르면 방문으로 보지 않는다', () => {
        const restaurant = row('approved-5', '쯔동분식 5', '서울 중구 쯔동로 5');
        const candidate = row('reviewed-5', '쯔동분식 5', '부산 해운대구 쯔동로 5');

        expect(expectSameVerdict(restaurant, [candidate], new Set(['reviewed-5']))).toBe(false);
    });

    test('주소 없는 맛집은 주소 없는 후보와만 맞춘다', () => {
        const addressless = row('approved-6', '쯔동분식 6', null);
        const addresslessCandidate = row('reviewed-6', '쯔동분식 6', null);
        const addressedCandidate = row('reviewed-6b', '쯔동분식 6', '서울 중구 쯔동로 6');

        expect(expectSameVerdict(addressless, [addresslessCandidate], new Set(['reviewed-6']))).toBe(true);
        expect(expectSameVerdict(addressless, [addressedCandidate], new Set(['reviewed-6b']))).toBe(false);
    });

    test('주소가 있는 맛집은 주소 없는 후보를 받지 않는다', () => {
        const restaurant = row('approved-7', '쯔동분식 7', '서울 중구 쯔동로 7');
        const addresslessCandidate = row('reviewed-7', '쯔동분식 7', null);

        expect(expectSameVerdict(restaurant, [addresslessCandidate], new Set(['reviewed-7']))).toBe(false);
    });

    test('이름이 비어 있으면 주소만 맞으면 방문으로 본다', () => {
        const restaurant = row('approved-8', '', '서울 중구 쯔동로 8');
        const candidate = row('reviewed-8', '', '서울 중구 쯔동로 8');

        expect(expectSameVerdict(restaurant, [candidate], new Set(['reviewed-8']))).toBe(true);
    });

    test('후보 id가 방문 집합에 없으면 주소와 이름이 맞아도 방문으로 보지 않는다', () => {
        const restaurant = row('approved-9', '쯔동분식 9', '서울 중구 쯔동로 9');
        const candidate = row('reviewed-9', '쯔동분식 9', '서울 중구 쯔동로 9');

        expect(expectSameVerdict(restaurant, [candidate], new Set())).toBe(false);
        expect(expectSameVerdict(restaurant, [candidate], new Set(['다른-id']))).toBe(false);
    });

    test('맛집이 null이거나 후보가 비면 방문으로 보지 않는다', () => {
        expect(expectSameVerdict(null, [row('reviewed-10', '쯔동분식 10', '서울 중구 쯔동로 10')], new Set(['reviewed-10']))).toBe(false);
        expect(expectSameVerdict(row('approved-10', '쯔동분식 10', '서울 중구 쯔동로 10'), [], new Set(['approved-x']))).toBe(false);
    });

    test('여러 후보 중 마지막 하나만 맞아도 방문으로 본다', () => {
        const restaurant = row('approved-11', '쯔동분식 11', '서울 중구 쯔동로 11');
        const candidates = [
            row('reviewed-11a', '다른집 11', '부산 해운대구 쯔동로 11'),
            row('reviewed-11b', '또다른집 11', '서울 중구 쯔동로 11'),
            row('reviewed-11c', '쯔동분식 11', '서울 중구 쯔동로 11'),
        ];
        const visitedIds = new Set(candidates.map((candidate) => candidate.id));

        expect(expectSameVerdict(restaurant, candidates, visitedIds)).toBe(true);
    });

    test('병합 레코드의 주소도 후보를 맞출 때 함께 본다', () => {
        const restaurant = row('approved-12', '쯔동분식 12', '서울 중구 쯔동로 12', '서울 중구 쯔동로 12', [
            row('merged-12', '쯔동분식 12', '서울 중구 쯔동로 99'),
        ]);
        const candidate = row('reviewed-12', '쯔동분식 12', '서울 중구 쯔동로 99');

        expect(expectSameVerdict(restaurant, [candidate], new Set(['reviewed-12']))).toBe(true);
    });

    test('같은 후보를 여러 번 물어도 판정이 바뀌지 않는다', () => {
        const restaurant = row('approved-13', '쯔동분식 13', '서울 중구 쯔동로 13');
        const candidate = row('reviewed-13', '쯔동분식 13', '서울 중구 쯔동로 13');
        const isVisited = createVisitedRestaurantMatcher([candidate] as never, new Set(['reviewed-13'])) as unknown as (
            restaurant: Row | null
        ) => boolean;

        const verdicts = [isVisited(restaurant), isVisited(restaurant), isVisited(restaurant)];

        expect(verdicts).toEqual([true, true, true]);
        expect(linearVisited(restaurant, [candidate], new Set(['reviewed-13']))).toBe(true);
    });

    test('무작위 조합에서 선형 판정과 항상 같은 결과를 낸다', () => {
        const names = ['쯔동분식', '쯔동분식 1', '쯔동분식 1 지점', '다른집', '', '쯔양국밥'];
        const addresses = ['서울 중구 쯔동로 1', '서울 중구 쯔동로 2', '부산 해운대구 쯔동로 1', null];
        const pick = <T,>(values: T[], index: number) => values[index % values.length] as T;

        let seed = 20260922;
        const nextRandom = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };

        const candidates: Row[] = [];
        for (let index = 0; index < 40; index += 1) {
            const address = pick(addresses, Math.floor(nextRandom() * addresses.length));
            candidates.push(row('reviewed-' + index, pick(names, Math.floor(nextRandom() * names.length)), address));
        }

        const visitedIds = new Set(candidates.map((candidate) => candidate.id));
        for (const id of ['approved-3', 'merged-7', 'reviewed-0']) visitedIds.add(id);

        let comparisons = 0;
        for (let index = 0; index < 300; index += 1) {
            const address = pick(addresses, Math.floor(nextRandom() * addresses.length));
            const merged = index % 5 === 0
                ? [row('merged-' + index, pick(names, Math.floor(nextRandom() * names.length)), address)]
                : undefined;
            const restaurant = row(
                'approved-' + (index % 12),
                pick(names, Math.floor(nextRandom() * names.length)),
                address,
                address,
                merged
            );

            expectSameVerdict(restaurant, candidates, visitedIds);
            comparisons += 1;
        }

        expect(comparisons).toBe(300);
    });

    test('색인 경로가 실제로 검사하는 후보 수가 선형 경로보다 훨씬 적다', () => {
        const restaurants: Row[] = [];
        for (let index = 0; index < 400; index += 1) {
            restaurants.push(row('approved-' + index, '쯔동분식 ' + index, '서울 중구 쯔동로 ' + index));
        }

        const candidates: Row[] = [];
        for (let index = 0; index < 40; index += 1) {
            candidates.push(row('reviewed-' + index, '쯔동분식 ' + index * 10, '서울 중구 쯔동로 ' + index * 10));
        }
        const visitedIds = new Set(candidates.map((candidate) => candidate.id));

        resetReviewLookupPerfCounters();
        const linearVerdicts = restaurants.map((restaurant) => linearVisited(restaurant, candidates, visitedIds));
        const linearVisits = getReviewLookupPerfCounters().candidateVisits;

        resetReviewLookupPerfCounters();
        const isVisited = createVisitedRestaurantMatcher(candidates as never, visitedIds) as unknown as (
            restaurant: Row | null
        ) => boolean;
        const indexedVerdicts = restaurants.map((restaurant) => isVisited(restaurant));
        const indexedVisits = getReviewLookupPerfCounters().candidateVisits;

        expect(indexedVerdicts).toEqual(linearVerdicts);
        expect(linearVisits).toBe(restaurants.length * candidates.length);
        expect(indexedVisits).toBeLessThan(linearVisits / 10);
    });
});
