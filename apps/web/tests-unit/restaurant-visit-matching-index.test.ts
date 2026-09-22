import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    createCanonicalVisitedLookup,
    findCanonicalVisitedRestaurant,
} from '../lib/restaurant-visit-matching';

// 색인 기반 해석기(createCanonicalVisitedLookup)가 선형 탐색(findCanonicalVisitedRestaurant)과
// 완전히 같은 맛집을 고르는지 확인합니다. 결과는 배열 안의 같은 객체여야 하므로 참조 비교로 검사합니다.
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

function resolveLinear(approved: Row[], candidate: Row | null, reviewedRestaurantId?: string | null): Row | null {
    return findCanonicalVisitedRestaurant({
        reviewedRestaurant: candidate as never,
        reviewedRestaurantId,
        approvedRestaurants: approved as never,
    }) as Row | null;
}

function resolveIndexed(approved: Row[], candidate: Row | null, reviewedRestaurantId?: string | null): Row | null {
    const resolve = createCanonicalVisitedLookup(approved as never) as unknown as (
        candidate: Row | null,
        reviewedRestaurantId?: string | null
    ) => Row | null;

    return resolve(candidate, reviewedRestaurantId);
}

function expectSameResolution(
    approved: Row[],
    candidate: Row | null,
    reviewedRestaurantId?: string | null
): Row | null {
    const linear = resolveLinear(approved, candidate, reviewedRestaurantId);
    const indexed = resolveIndexed(approved, candidate, reviewedRestaurantId);

    // 같은 객체를 골라야 합니다(개수가 아니라 선택 자체가 같아야 함).
    expect(indexed).toBe(linear);
    return linear;
}

describe('canonical visited lookup index', () => {
    test('같은 주소에 이름이 맞는 맛집을 고른다', () => {
        const approved = [row('approved-1', '쯔동분식 12', '서울 중구 쯔동로 12')];
        const candidate = row('deleted-1', '쯔동분식 12 지점', '서울 중구 쯔동로 12');

        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-1');
    });

    test('주소가 다르면 같은 이름이라도 고르지 않는다', () => {
        const approved = [row('approved-1', '쯔동분식 12', '서울 중구 쯔동로 12')];
        const candidate = row('deleted-1', '쯔동분식 12', '서울 중구 다른로 99');

        expect(expectSameResolution(approved, candidate)).toBeNull();
    });

    test('주소는 같지만 이름이 맞지 않으면 건너뛴다', () => {
        const approved = [row('approved-1', '쯔동분식 12', '서울 중구 쯔동로 12')];
        const candidate = row('deleted-1', '완전히다른집', '서울 중구 쯔동로 12');

        expect(expectSameResolution(approved, candidate)).toBeNull();
    });

    test('이름 게이트를 통과하는 맛집이 뒤에 있어도 가장 앞선 맛집을 고른다', () => {
        const approved = [
            row('approved-address-only', '완전히다른집', '서울 중구 쯔동로 12'),
            row('approved-name-match', '쯔동분식 12', '서울 중구 쯔동로 12'),
        ];
        const candidate = row('deleted-1', '쯔동분식 12 지점', '서울 중구 쯔동로 12');

        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-name-match');
    });

    test('주소+이름으로 찾은 맛집이 직접 ID로 찾은 맛집보다 앞서면 앞선 맛집을 고른다', () => {
        const approved = [
            row('approved-address-match', '쯔동분식 12', '서울 중구 쯔동로 12'),
            row('approved-direct-id', '다른이름집', '서울 중구 다른로 7', undefined, [
                row('deleted-1', '다른이름집', '서울 중구 다른로 7'),
            ]),
        ];
        const candidate = row('deleted-1', '쯔동분식 12 지점', '서울 중구 쯔동로 12');

        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-address-match');
    });

    test('직접 ID로 찾은 맛집이 앞서면 그 맛집을 고른다', () => {
        const approved = [
            row('approved-direct-id', '다른이름집', '서울 중구 다른로 7', undefined, [
                row('deleted-1', '다른이름집', '서울 중구 다른로 7'),
            ]),
            row('approved-address-match', '쯔동분식 12', '서울 중구 쯔동로 12'),
        ];
        const candidate = row('deleted-1', '쯔동분식 12 지점', '서울 중구 쯔동로 12');

        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-direct-id');
    });

    test('병합된 레코드의 주소도 후보 주소와 맞으면 고른다', () => {
        const approved = [
            row('approved-merged', '쯔동분식 12', '서울 중구 쯔동로 12', undefined, [
                row('approved-merged-old', '쯔동분식 12', '서울 중구 옛주소 3'),
            ]),
        ];
        const candidate = row('deleted-1', '쯔동분식 12 지점', '서울 중구 옛주소 3');

        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-merged');
    });

    test('주소가 없는 후보는 주소가 없는 맛집에만 붙는다', () => {
        const approved = [
            row('approved-with-address', '쯔동분식 12', '서울 중구 쯔동로 12'),
            row('approved-addressless', '쯔동분식 13', null),
        ];
        const addresslessCandidate = row('deleted-13', '쯔동분식 13 지점', null);

        expect(expectSameResolution(approved, addresslessCandidate)?.id).toBe('approved-addressless');

        const candidateWithAddress = row('deleted-13b', '쯔동분식 13 지점', '서울 중구 쯔동로 14');
        expect(expectSameResolution(approved, candidateWithAddress)).toBeNull();
    });

    test('리뷰 ID만 있고 후보 레코드가 없으면 직접 ID로만 찾는다', () => {
        const approved = [
            row('approved-1', '쯔동분식 12', '서울 중구 쯔동로 12', undefined, [
                row('deleted-1', '쯔동분식 12', '서울 중구 쯔동로 12'),
            ]),
        ];

        expect(expectSameResolution(approved, null, 'deleted-1')?.id).toBe('approved-1');
        expect(expectSameResolution(approved, null, 'unknown-id')).toBeNull();
        expect(expectSameResolution(approved, null, null)).toBeNull();
    });

    test('찾는 리뷰 ID와 후보 ID가 다르면 후보 경로는 결과를 만들지 않는다', () => {
        const approved = [row('approved-1', '쯔동분식 12', '서울 중구 쯔동로 12')];
        const candidate = row('deleted-1', '쯔동분식 12 지점', '서울 중구 쯔동로 12');

        expect(expectSameResolution(approved, candidate, 'other-id')).toBeNull();
    });

    test('후보의 두 주소가 같은 맛집에 걸려도 한 번만 보고 고른다', () => {
        const approved = [row('approved-0', '쯔동분식 1', '주소A', '주소B')];
        const candidate = row('deleted-1', '쯔동분식 1 지점', '주소B', '주소A');

        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-0');
    });

    test('서로 다른 주소 버킷에 걸린 두 맛집 중 앞선 맛집을 고른다', () => {
        const approved = [
            row('approved-0', '쯔동분식 1', '주소A', '주소X'),
            row('approved-1', '쯔동분식 1', '주소B', '주소Y'),
        ];
        const candidate = row('deleted-1', '쯔동분식 1 지점', '주소B', '주소X');

        // approved-0은 지번 주소로, approved-1은 도로명 주소로 걸린다. 앞선 색인이 이겨야 한다.
        expect(expectSameResolution(approved, candidate)?.id).toBe('approved-0');

        const reversed = [
            row('approved-0', '쯔동분식 1', '주소A', '주소Y'),
            row('approved-1', '쯔동분식 1', '주소B', '주소X'),
        ];
        expect(expectSameResolution(reversed, candidate)?.id).toBe('approved-1');
    });

    test('무작위 워크로드에서 두 경로의 선택이 모두 같다', () => {
        let state = 20260922;
        const random = () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const pick = <T,>(values: T[]): T => values[Math.floor(random() * values.length)];
        const addresses = ['서울 중구 쯔동로 1', '서울 중구 쯔동로 2', '서울 중구 쯔동로 3', null];
        const names = ['쯔동분식 1', '쯔동분식 2', '쯔동분식 3', '완전히다른집'];

        const approved: Row[] = [];
        for (let index = 0; index < 60; index += 1) {
            const address = pick(addresses);
            const merged = random() < 0.25
                ? [row('merged-' + index, pick(names), pick(addresses))]
                : undefined;
            approved.push(row('approved-' + index, pick(names), address, address, merged));
        }

        const candidates: Row[] = [];
        for (let index = 0; index < 60; index += 1) {
            const address = pick(addresses);
            candidates.push(row('deleted-' + index, pick(names), address, address));
        }
        candidates.push(row('approved-7', '쯔동분식 1', '서울 중구 쯔동로 1'));
        candidates.push(row('merged-3', '쯔동분식 2', '서울 중구 쯔동로 2'));
        candidates.push(row('deleted-noaddr', '쯔동분식 1', null));

        let comparisons = 0;
        for (const candidate of candidates) {
            for (const reviewedRestaurantId of [undefined, candidate.id, 'approved-7', 'merged-3', 'missing-id']) {
                expectSameResolution(approved, candidate, reviewedRestaurantId);
                comparisons += 1;
            }
        }

        expect(comparisons).toBe(candidates.length * 5);
    });
});
