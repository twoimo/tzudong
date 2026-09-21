import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
    selectRelatedRestaurantReviewIds,
} from '../lib/restaurant-review-lookup';

type LookupRow = Partial<Restaurant> & { id?: string | null };

// 최적화 이전 스캔(이름 게이트 우선 + 주소 집합 배열 전개)을 테스트 안에 그대로 둔다.
function normalizeName(name: string | null | undefined) {
    return (name || '').replace(/\s+/g, '').replace(/[^\w가-힣]/g, '').toLowerCase();
}

function normalizeAddress(address: string | null | undefined) {
    return (address || '')
        .replace(/지하\s*\d+\s*층/g, '')
        .replace(/지상\s*\d+\s*층/g, '')
        .replace(/\d+\s*층/g, '')
        .replace(/\d+\s*호/g, '')
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '')
        .toLowerCase();
}

function collectNames(restaurant: LookupRow) {
    return [...new Set([
        restaurant.name,
        restaurant.approved_name,
        restaurant.naver_name,
        restaurant.origin_name,
        restaurant.google_name,
    ].map((name) => name?.trim()).filter((name): name is string => Boolean(name)))];
}

function collectAddresses(restaurants: LookupRow[]) {
    const addresses = new Set<string>();
    restaurants.forEach((restaurant) => {
        const road = normalizeAddress(restaurant.road_address);
        const jibun = normalizeAddress(restaurant.jibun_address);
        if (road) addresses.add(road);
        if (jibun) addresses.add(jibun);
    });
    return addresses;
}

function areNamesCompatible(sourceName: string, candidateName: string) {
    if (sourceName === candidateName) return true;
    const source = normalizeName(sourceName);
    const candidate = normalizeName(candidateName);
    if (!source || !candidate) return false;
    if (source === candidate) return true;
    const shorter = source.length <= candidate.length ? source : candidate;
    const longer = source.length > candidate.length ? source : candidate;
    return shorter.length >= 3 && longer.includes(shorter);
}

function referenceSelectRelatedRestaurantReviewIds(
    restaurant: LookupRow | null,
    candidates: LookupRow[] | null | undefined,
) {
    if (!restaurant || !restaurant.id) return restaurant ? referenceWithoutId(restaurant) : [];
    const ids = new Set([restaurant.id]);
    restaurant.mergedRestaurants?.forEach((merged) => { if (merged.id) ids.add(merged.id); });
    if (!Array.isArray(candidates) || candidates.length === 0) return [...ids];

    const lookupNames = collectNames(restaurant);
    const lookupAddresses = collectAddresses([restaurant, ...(restaurant.mergedRestaurants || [])]);

    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return;
        const candidateNames = collectNames(candidate);
        if (lookupNames.length > 0 && candidateNames.length > 0 &&
            !lookupNames.some((lookupName) => candidateNames.some((candidateName) => areNamesCompatible(lookupName, candidateName)))) {
            return;
        }
        const candidateAddresses = collectAddresses([candidate]);
        const hasAddressMatch = lookupAddresses.size === 0
            ? candidateAddresses.size === 0
            : [...candidateAddresses].some((address) => lookupAddresses.has(address));
        if (hasAddressMatch) ids.add(candidate.id);
    });

    return [...ids];
}

function referenceWithoutId(restaurant: LookupRow) {
    const ids: string[] = [];
    restaurant.mergedRestaurants?.forEach((merged) => { if (merged.id) ids.push(merged.id); });
    return ids;
}

const makeRestaurant = (overrides: LookupRow): Restaurant => ({
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

describe('restaurant review lookup 후보 스캔 순서', () => {
    test('주소 게이트를 먼저 통과한 후보에만 이름 호환 검사를 실행한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = Array.from({ length: 60 }, (_, index) => makeRestaurant({
            id: `deleted-${index}`,
            status: 'deleted',
            road_address: `서울특별시 강남구 다른로${index + 1}길 ${index + 1}`,
            jibun_address: null,
            name: `다른가게${index}`,
            approved_name: null,
        }));
        candidates.push(makeRestaurant({ id: 'deleted-same-address', status: 'deleted' }));

        resetReviewLookupPerfCounters();
        const ids = selectRelatedRestaurantReviewIds(restaurant, candidates);
        const counters = getReviewLookupPerfCounters();

        expect(ids).toEqual(['approved-id', 'deleted-same-address']);
        // 후보 61건을 모두 방문하지만 이름 검사는 주소가 겹친 1건에서만 실행된다.
        expect(counters.candidateVisits).toBe(61);
        expect(counters.nameGates).toBe(1);
        expect(counters.addressGates).toBe(61);
    });

    test('같은 id 후보가 서로 다른 이름과 주소를 가지면 후보별로 판정한다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = [
            // 주소는 다르지만 이름이 호환되는 후보
            makeRestaurant({
                id: 'duplicated-id',
                status: 'deleted',
                road_address: '서울특별시 강남구 전혀다른로 1',
                jibun_address: null,
            }),
            // 주소는 같지만 이름이 호환되지 않는 후보(같은 id)
            makeRestaurant({
                id: 'duplicated-id',
                status: 'deleted',
                name: '완전히다른이름',
                approved_name: null,
                road_address: '서울특별시 강남구 논현로85길 70',
                jibun_address: null,
            }),
        ];

        expect(selectRelatedRestaurantReviewIds(restaurant, candidates)).toEqual(['approved-id']);
        expect(referenceSelectRelatedRestaurantReviewIds(restaurant, candidates)).toEqual(['approved-id']);
    });

    test('주소가 겹치지 않으면 이름이 같아도 포함하지 않는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidate = makeRestaurant({
            id: 'deleted-other-address',
            status: 'deleted',
            road_address: '부산광역시 해운대구 다른로 9',
            jibun_address: null,
        });

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id']);
        expect(referenceSelectRelatedRestaurantReviewIds(restaurant, [candidate])).toEqual(['approved-id']);
    });

    test('승인 식당 주소가 비면 주소 없는 후보만 붙는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id', road_address: null, jibun_address: null });
        const addressless = makeRestaurant({
            id: 'deleted-addressless',
            status: 'deleted',
            road_address: null,
            jibun_address: null,
        });
        const withAddress = makeRestaurant({ id: 'deleted-with-address', status: 'deleted' });

        expect(selectRelatedRestaurantReviewIds(restaurant, [addressless, withAddress]))
            .toEqual(['approved-id', 'deleted-addressless']);
        expect(referenceSelectRelatedRestaurantReviewIds(restaurant, [addressless, withAddress]))
            .toEqual(['approved-id', 'deleted-addressless']);
    });

    test('병합 레코드 주소도 조회 주소 집합에 포함한다', () => {
        const restaurant = makeRestaurant({
            id: 'approved-id',
            mergedRestaurants: [makeRestaurant({
                id: 'merged-id',
                road_address: '서울특별시 강남구 병합로 7',
                jibun_address: null,
            })],
        });
        const candidate = makeRestaurant({
            id: 'deleted-merged-address',
            status: 'deleted',
            road_address: '서울특별시 강남구 병합로 7',
            jibun_address: null,
        });

        expect(selectRelatedRestaurantReviewIds(restaurant, [candidate]))
            .toEqual(['approved-id', 'merged-id', 'deleted-merged-address']);
    });

    test('이미 직접 id로 포함된 후보는 다시 이름 검사하지 않는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = [makeRestaurant({ id: 'approved-id' })];

        resetReviewLookupPerfCounters();
        expect(selectRelatedRestaurantReviewIds(restaurant, candidates)).toEqual(['approved-id']);
        const counters = getReviewLookupPerfCounters();

        expect(counters.candidateVisits).toBe(1);
        expect(counters.addressGates).toBe(0);
        expect(counters.nameGates).toBe(0);
    });

    test('후보 목록이 비었거나 배열이 아니면 카운터 없이 직접 id만 돌려준다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });

        resetReviewLookupPerfCounters();
        expect(selectRelatedRestaurantReviewIds(restaurant, [])).toEqual(['approved-id']);
        expect(selectRelatedRestaurantReviewIds(restaurant, undefined as unknown as Restaurant[])).toEqual(['approved-id']);
        expect(selectRelatedRestaurantReviewIds(null, undefined as unknown as Restaurant[])).toEqual([]);
        expect(getReviewLookupPerfCounters().candidateVisits).toBe(0);
    });

    test('null과 id 없는 후보는 후보 방문 수에 포함하지 않는다', () => {
        const restaurant = makeRestaurant({ id: 'approved-id' });
        const candidates = [
            null,
            makeRestaurant({ id: '' }),
            makeRestaurant({ id: null }),
            makeRestaurant({ id: 'deleted-valid', status: 'deleted' }),
        ];

        resetReviewLookupPerfCounters();
        expect(selectRelatedRestaurantReviewIds(restaurant, candidates as unknown as Restaurant[]))
            .toEqual(['approved-id', 'deleted-valid']);
        expect(getReviewLookupPerfCounters().candidateVisits).toBe(1);
    });

    test('무작위 입력에서 이전 구현과 결과가 항상 같다', () => {
        let state = 987654321;
        const random = () => {
            state = (state * 1103515245 + 12345) >>> 0;
            return state / 0x100000000;
        };
        const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)] ?? list[0];
        const NAME_POOL = ['정원분식', '스시린', ' 귀일만두 ', 'A', 'ab', '데일리픽스', '데일리픽스 강남본점', '', '1500회전초밥', '하동관'];
        const ADDRESS_POOL = [
            '서울특별시 강남구 논현로85길 70',
            '서울특별시 강남구 논현로85길 70 2층',
            null,
            '서울 강남구 역삼동 823-16',
            '부산광역시 해운대구 센텀중앙로 97',
            '',
        ];

        const randomRow = (index: number): LookupRow => ({
            id: random() < 0.12 ? null : random() < 0.2 ? `dup-${index % 3}` : `row-${index}`,
            name: pick(NAME_POOL),
            approved_name: random() < 0.5 ? pick(NAME_POOL) : null,
            naver_name: random() < 0.2 ? pick(NAME_POOL) : null,
            origin_name: null,
            google_name: random() < 0.1 ? pick(NAME_POOL) : null,
            road_address: pick(ADDRESS_POOL),
            jibun_address: pick(ADDRESS_POOL),
        });

        for (let iteration = 0; iteration < 300; iteration += 1) {
            const source: LookupRow = {
                ...randomRow(iteration),
                id: `source-${iteration}`,
                mergedRestaurants: random() < 0.3
                    ? [randomRow(iteration + 1000), randomRow(iteration + 2000)]
                    : [],
            };
            const candidates: LookupRow[] = Array.from(
                { length: Math.floor(random() * 14) },
                (_, index) => randomRow(index),
            );
            if (random() < 0.15) candidates.push(null as unknown as LookupRow);

            expect(selectRelatedRestaurantReviewIds(
                source as unknown as Restaurant,
                candidates as unknown as Restaurant[],
            )).toEqual(referenceSelectRelatedRestaurantReviewIds(source, candidates));
        }
    });
});
