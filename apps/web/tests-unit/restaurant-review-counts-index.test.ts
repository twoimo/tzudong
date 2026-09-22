import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { buildRelatedVerifiedReviewCountMap } from '../lib/restaurant-review-counts';
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
    selectRelatedRestaurantReviewIds,
} from '../lib/restaurant-review-lookup';

// 색인 기반 리뷰 수 집계가 선형 집계(selectRelatedRestaurantReviewIds + 합산)와 맛집마다 같은 값을
// 내는지 확인합니다. 도장 카드의 승인 리뷰 수가 이 값으로 표시되므로 값이 하나라도 달라지면 화면이 달라집니다.
type Row = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
>;

type ReviewRow = { restaurant_id: string | null };

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

function referenceCountMap(restaurants: Row[], candidates: Row[], reviewRows: ReviewRow[] | null) {
    const directCountMap = new Map<string, number>();
    (reviewRows ?? []).forEach((reviewRow) => {
        if (!reviewRow.restaurant_id) return;
        directCountMap.set(reviewRow.restaurant_id, (directCountMap.get(reviewRow.restaurant_id) ?? 0) + 1);
    });

    return new Map(restaurants.map((restaurant) => {
        const relatedIds = selectRelatedRestaurantReviewIds(restaurant as never, candidates as never);
        const count = relatedIds.reduce((sum, id) => sum + (directCountMap.get(id) ?? 0), 0);
        return [restaurant.id, count];
    }));
}

function expectSameCountMap(restaurants: Row[], candidates: Row[], reviewRows: ReviewRow[] | null) {
    const indexed = [...buildRelatedVerifiedReviewCountMap(restaurants as never, candidates as never, reviewRows).entries()];
    const linear = [...referenceCountMap(restaurants, candidates, reviewRows).entries()];

    expect(indexed).toEqual(linear);
    return new Map(indexed);
}

describe('related verified review count index', () => {
    test('삭제 중복 레코드에 붙은 리뷰를 승인 카드에 합산한다', () => {
        const approved = row('approved-1', '데일리픽스 강남본점', '서울 강남구 논현로 70');
        const duplicate = row('deleted-1', '데일리픽스 강남본점', '서울 강남구 논현로 70');

        const counts = expectSameCountMap(
            [approved],
            [approved, duplicate],
            [{ restaurant_id: 'deleted-1' }, { restaurant_id: 'deleted-1' }]
        );

        expect(counts.get('approved-1')).toBe(2);
    });

    test('이름이 같아도 주소가 다르면 합산하지 않는다', () => {
        const approved = row('approved-2', '데일리픽스 강남본점', '서울 강남구 논현로 70');
        const otherBranch = row('deleted-2', '데일리픽스 강남본점', '서울 강남구 다른길 1');

        const counts = expectSameCountMap([approved], [approved, otherBranch], [{ restaurant_id: 'deleted-2' }]);

        expect(counts.get('approved-2')).toBe(0);
    });

    test('병합 레코드의 리뷰도 합산한다', () => {
        const merged = row('merged-3', '쯔동분식 3', '서울 중구 쯔동로 3');
        const approved = row('approved-3', '쯔동분식 3', '서울 중구 쯔동로 3', '서울 중구 쯔동로 3', [merged]);

        const counts = expectSameCountMap([approved], [], [{ restaurant_id: 'merged-3' }]);

        expect(counts.get('approved-3')).toBe(1);
    });

    test('같은 id가 직접 id와 후보 양쪽에 있어도 한 번만 합산한다', () => {
        const approved = row('approved-4', '쯔동분식 4', '서울 중구 쯔동로 4');

        const counts = expectSameCountMap(
            [approved],
            [approved, approved],
            [{ restaurant_id: 'approved-4' }, { restaurant_id: 'approved-4' }]
        );

        expect(counts.get('approved-4')).toBe(2);
    });

    test('주소 없는 맛집은 주소 없는 후보의 리뷰만 합산한다', () => {
        const addressless = row('approved-5', '쯔동분식 5', null);
        const addresslessCandidate = row('deleted-5', '쯔동분식 5', null);
        const addressedCandidate = row('deleted-5b', '쯔동분식 5', '서울 중구 쯔동로 5');

        const counts = expectSameCountMap(
            [addressless],
            [addresslessCandidate, addressedCandidate],
            [{ restaurant_id: 'deleted-5' }, { restaurant_id: 'deleted-5b' }]
        );

        expect(counts.get('approved-5')).toBe(1);
    });

    test('이름이 비어 있으면 주소만 맞아도 합산한다', () => {
        const approved = row('approved-6', '', '서울 중구 쯔동로 6');
        const candidate = row('deleted-6', '', '서울 중구 쯔동로 6');

        const counts = expectSameCountMap([approved], [candidate], [{ restaurant_id: 'deleted-6' }]);

        expect(counts.get('approved-6')).toBe(1);
    });

    test('리뷰 행이 없으면 모두 0이다', () => {
        const approved = row('approved-7', '쯔동분식 7', '서울 중구 쯔동로 7');
        const duplicate = row('deleted-7', '쯔동분식 7 지점', '서울 중구 쯔동로 7');

        expect(expectSameCountMap([approved], [duplicate], null).get('approved-7')).toBe(0);
        expect(expectSameCountMap([approved], [duplicate], []).get('approved-7')).toBe(0);
        expect([...expectSameCountMap([], [], null).entries()]).toEqual([]);
    });

    test('restaurant_id가 없는 리뷰 행은 어느 맛집에도 합산하지 않는다', () => {
        const approved = row('approved-8', '쯔동분식 8', '서울 중구 쯔동로 8');

        expect(expectSameCountMap([approved], [approved], [{ restaurant_id: null }]).get('approved-8')).toBe(0);
    });

    test('무작위 조합에서 선형 집계와 항상 같은 값을 낸다', () => {
        const names = ['쯔동분식', '쯔동분식 1', '쯔동분식 1 지점', '다른집', '', '쯔양국밥'];
        const addresses = ['서울 중구 쯔동로 1', '서울 중구 쯔동로 2', '부산 해운대구 쯔동로 1', null];
        const pick = <T,>(values: T[], index: number) => values[index % values.length] as T;

        let seed = 20260922;
        const nextRandom = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };

        for (let round = 0; round < 200; round += 1) {
            const restaurants: Row[] = [];
            const restaurantCount = 1 + Math.floor(nextRandom() * 12);
            for (let index = 0; index < restaurantCount; index += 1) {
                const address = pick(addresses, Math.floor(nextRandom() * addresses.length));
                const merged = nextRandom() < 0.3
                    ? [row('merged-' + round + '-' + index, pick(names, Math.floor(nextRandom() * names.length)), address)]
                    : undefined;
                restaurants.push(row(
                    'approved-' + round + '-' + index,
                    pick(names, Math.floor(nextRandom() * names.length)),
                    address,
                    address,
                    merged
                ));
            }

            const candidates: Row[] = [];
            const candidateCount = Math.floor(nextRandom() * 10);
            for (let index = 0; index < candidateCount; index += 1) {
                const address = pick(addresses, Math.floor(nextRandom() * addresses.length));
                candidates.push(row(
                    'candidate-' + round + '-' + index,
                    pick(names, Math.floor(nextRandom() * names.length)),
                    address
                ));
            }
            if (candidates.length > 0 && nextRandom() < 0.5) {
                candidates.push(candidates[0] as Row);
            }
            if (restaurants.length > 0 && nextRandom() < 0.4) {
                candidates.push(restaurants[0] as Row);
            }

            const reviewRows: ReviewRow[] = [];
            const reviewCount = Math.floor(nextRandom() * 12);
            for (let index = 0; index < reviewCount; index += 1) {
                const pool = [...restaurants, ...candidates];
                if (pool.length === 0) break;
                const target = pool[Math.floor(nextRandom() * pool.length)] as Row;
                reviewRows.push({ restaurant_id: nextRandom() < 0.1 ? null : target.id });
            }

            expectSameCountMap(restaurants, candidates, reviewRows);
        }
    });

    test('색인 경로가 실제로 검사하는 후보 수가 선형 경로보다 훨씬 적다', () => {
        const restaurants: Row[] = [];
        const candidates: Row[] = [];
        for (let index = 0; index < 400; index += 1) {
            const address = '서울 중구 쯔동로 ' + index;
            restaurants.push(row('approved-' + index, '쯔동분식 ' + index, address));
            candidates.push(row('deleted-' + index, '쯔동분식 ' + index + ' 지점', address));
        }
        const reviewRows: ReviewRow[] = candidates.map((candidate) => ({ restaurant_id: candidate.id }));

        resetReviewLookupPerfCounters();
        const linear = referenceCountMap(restaurants, candidates, reviewRows);
        const linearVisits = getReviewLookupPerfCounters().candidateVisits;

        resetReviewLookupPerfCounters();
        const indexed = buildRelatedVerifiedReviewCountMap(restaurants as never, candidates as never, reviewRows);
        const indexedVisits = getReviewLookupPerfCounters().candidateVisits;

        expect([...indexed.entries()]).toEqual([...linear.entries()]);
        expect(indexed.get('approved-399')).toBe(1);
        expect(linearVisits).toBe(restaurants.length * candidates.length);
        expect(indexedVisits).toBeLessThan(linearVisits / 10);
    });
});

