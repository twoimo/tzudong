import { describe, expect, test } from 'bun:test';

import {
    REGIONAL_CENTERS,
    SEOUL_DISTRICT_CENTERS,
    getDistance,
    getRegionalClusters,
    getSeoulDistrictClusters,
} from '../lib/clustering';
import type { Restaurant } from '../types/restaurant';

const makeRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
    id: overrides.id ?? 'restaurant-1',
    name: overrides.name ?? '테스트 식당',
    lat: overrides.lat ?? 37.5,
    lng: overrides.lng ?? 127.0,
    category: overrides.category ?? '한식',
    categories: overrides.categories ?? ['한식'],
    weekly_search_count: overrides.weekly_search_count ?? null,
    ...overrides,
} as Restaurant);

const 서울 = REGIONAL_CENTERS['서울특별시'];
const 부산 = REGIONAL_CENTERS['부산광역시'];
const 강남 = SEOUL_DISTRICT_CENTERS['강남구'];
const 마포 = SEOUL_DISTRICT_CENTERS['마포구'];
const 종로 = SEOUL_DISTRICT_CENTERS['종로구'];

const makeSeoulRow = (id: string, district: string, overrides: Partial<Restaurant> = {}) => {
    const center = SEOUL_DISTRICT_CENTERS[district];
    return makeRestaurant({
        id,
        road_address: `서울 ${district} 테스트로 1`,
        lat: center.lat,
        lng: center.lng,
        ...overrides,
    });
};

describe('getRegionalClusters', () => {
    test('빈 목록은 빈 배열을 돌려준다', () => {
        expect(getRegionalClusters([])).toEqual([]);
    });

    test('행정구역 키 순서대로 돌려주고 중심은 고정 중심 좌표를 쓴다', () => {
        const rows = [
            makeRestaurant({ id: 'busan-1', road_address: '부산광역시 해운대구 1', lat: 부산.lat, lng: 부산.lng }),
            makeRestaurant({ id: 'seoul-1', road_address: '서울특별시 강남구 테헤란로 1', lat: 강남.lat, lng: 강남.lng }),
        ];

        const clusters = getRegionalClusters(rows);

        expect(clusters.map((cluster) => cluster.region)).toEqual(['서울특별시', '부산광역시']);
        expect(clusters[0].center).toEqual(서울);
        expect(clusters[0].restaurantIds).toEqual(['seoul-1']);
        expect(clusters[1].restaurantIds).toEqual(['busan-1']);
    });

    test('주소에 정식 명칭이 있으면 그 행정구역으로 묶는다', () => {
        const clusters = getRegionalClusters([
            makeRestaurant({ id: 'a', road_address: '경기도 성남시 분당구 1', lat: 37.39, lng: 127.11 }),
        ]);

        expect(clusters.map((cluster) => cluster.region)).toEqual(['경기도']);
    });

    test('주소가 약어로 시작하면 정식 명칭으로 바꾼다', () => {
        const clusters = getRegionalClusters([
            makeRestaurant({ id: 'a', road_address: '경기 성남시 분당구 1', lat: 37.39, lng: 127.11 }),
        ]);

        expect(clusters.map((cluster) => cluster.region)).toEqual(['경기도']);
    });

    test('주소에서 행정구역을 못 찾으면 좌표상 가장 가까운 중심으로 묶는다', () => {
        const clusters = getRegionalClusters([
            makeRestaurant({ id: 'a', road_address: '알 수 없는 주소 1', lat: 부산.lat, lng: 부산.lng }),
        ]);

        expect(clusters.map((cluster) => cluster.region)).toEqual(['부산광역시']);
    });

    test('좌표가 없는 행정구역은 클러스터에서 빠진다', () => {
        const clusters = getRegionalClusters([
            makeRestaurant({ id: 'no-coords', road_address: '서울특별시 강남구 1', lat: null as never, lng: null as never }),
            makeRestaurant({ id: 'zero-lat', road_address: '서울특별시 강남구 1', lat: 0, lng: 127.0 }),
            makeRestaurant({ id: 'ok', road_address: '서울특별시 강남구 1', lat: 강남.lat, lng: 강남.lng }),
        ]);

        expect(clusters.map((cluster) => cluster.region)).toEqual(['서울특별시']);
        expect(clusters[0].restaurantIds).toEqual(['ok']);
    });

    test('restaurantIds 는 입력 순서를 유지한다', () => {
        const clusters = getRegionalClusters([
            makeRestaurant({ id: 'third', road_address: '서울특별시 강남구 3', lat: 강남.lat, lng: 강남.lng }),
            makeRestaurant({ id: 'first', road_address: '서울특별시 마포구 1', lat: 마포.lat, lng: 마포.lng }),
            makeRestaurant({ id: 'second', road_address: '서울특별시 종로구 2', lat: 종로.lat, lng: 종로.lng }),
        ]);

        expect(clusters[0].restaurantIds).toEqual(['third', 'first', 'second']);
    });

    test('카테고리는 빈도 내림차순 상위 3개이고 동률은 먼저 나온 순서를 따른다', () => {
        const rows = [
            makeRestaurant({ id: 'a', road_address: '서울특별시 강남구 1', lat: 강남.lat, lng: 강남.lng, categories: ['한식'] }),
            makeRestaurant({ id: 'b', road_address: '서울특별시 강남구 1', lat: 강남.lat, lng: 강남.lng, categories: ['분식'] }),
            makeRestaurant({ id: 'c', road_address: '서울특별시 강남구 1', lat: 강남.lat, lng: 강남.lng, categories: ['한식'] }),
            makeRestaurant({ id: 'd', road_address: '서울특별시 강남구 1', lat: 강남.lat, lng: 강남.lng, categories: ['중식'] }),
            makeRestaurant({ id: 'e', road_address: '서울특별시 강남구 1', lat: 강남.lat, lng: 강남.lng, categories: ['일식'] }),
        ];

        expect(getRegionalClusters(rows)[0].categories).toEqual(['한식', '분식', '중식']);
    });
});

describe('getSeoulDistrictClusters', () => {
    test('빈 목록은 빈 결과를 돌려준다', () => {
        expect(getSeoulDistrictClusters([], 1)).toEqual({ clusters: [], individualRestaurantIds: [] });
    });

    test('자치구 키 순서대로 돌려주고 중심은 소속 맛집들의 평균 좌표다', () => {
        const rows = [
            makeSeoulRow('mapo-1', '마포구'),
            makeSeoulRow('gangnam-1', '강남구'),
            makeSeoulRow('gangnam-2', '강남구', { lat: 강남.lat + 0.02, lng: 강남.lng + 0.04 }),
        ];

        const result = getSeoulDistrictClusters(rows, 1);

        expect(result.clusters.map((cluster) => cluster.region)).toEqual(['강남구', '마포구']);
        expect(result.clusters[0].count).toBe(2);
        expect(result.clusters[0].center.lat).toBeCloseTo(강남.lat + 0.01, 10);
        expect(result.clusters[0].center.lng).toBeCloseTo(강남.lng + 0.02, 10);
        expect(result.clusters[1].center).toEqual({ lat: 마포.lat, lng: 마포.lng });
        expect(result.individualRestaurantIds).toEqual([]);
    });

    test('주소에 서울이 없으면 자치구 클러스터에서 빠진다', () => {
        const result = getSeoulDistrictClusters(
            [makeRestaurant({ id: 'busan', road_address: '부산광역시 해운대구 1', lat: 부산.lat, lng: 부산.lng })],
            1,
        );

        expect(result.clusters).toEqual([]);
        expect(result.individualRestaurantIds).toEqual([]);
    });

    test('주소가 비어 있으면 자치구 클러스터에서 빠진다', () => {
        const result = getSeoulDistrictClusters(
            [makeRestaurant({ id: 'blank', road_address: null, jibun_address: null, lat: 강남.lat, lng: 강남.lng })],
            1,
        );

        expect(result.clusters).toEqual([]);
        expect(result.individualRestaurantIds).toEqual([]);
    });

    test('주소에 구 이름이 없으면 좌표상 가장 가까운 구로 묶는다', () => {
        const result = getSeoulDistrictClusters(
            [makeRestaurant({ id: 'a', road_address: '서울 어딘가로 1', lat: 강남.lat, lng: 강남.lng })],
            1,
        );

        expect(result.clusters.map((cluster) => cluster.region)).toEqual(['강남구']);
    });

    test('좌표가 없는 맛집은 빠진다', () => {
        const result = getSeoulDistrictClusters(
            [
                makeSeoulRow('no-coords', '강남구', { lat: null as never, lng: null as never }),
                makeSeoulRow('ok', '강남구'),
            ],
            1,
        );

        expect(result.clusters[0].restaurantIds).toEqual(['ok']);
    });

    test('minClusterSize=1 은 맛집이 있는 구를 모두 클러스터로 돌려준다', () => {
        const rows = [makeSeoulRow('a', '강남구'), makeSeoulRow('b', '마포구')];

        const result = getSeoulDistrictClusters(rows, 1);

        expect(result.clusters.map((cluster) => cluster.region)).toEqual(['강남구', '마포구']);
        expect(result.individualRestaurantIds).toEqual([]);
    });

    test('minClusterSize=3 은 3개 미만 구를 개별 마커로 내보낸다', () => {
        const rows = [
            makeSeoulRow('g1', '강남구'),
            makeSeoulRow('g2', '강남구'),
            makeSeoulRow('g3', '강남구'),
            makeSeoulRow('m1', '마포구'),
            makeSeoulRow('m2', '마포구'),
            makeSeoulRow('j1', '종로구'),
        ];

        const result = getSeoulDistrictClusters(rows, 3);

        expect(result.clusters.map((cluster) => cluster.region)).toEqual(['강남구']);
        expect(result.clusters[0].count).toBe(3);
        // 개별 마커는 자치구 키 순서를 따르고, 같은 구 안에서는 입력 순서를 유지한다.
        expect(result.individualRestaurantIds).toEqual(['m1', 'm2', 'j1']);
    });
});

describe('clustering 캐시 동작', () => {
    test('같은 목록을 다시 넘기면 같은 결과를 돌려준다', () => {
        const rows = [makeSeoulRow('a', '강남구'), makeSeoulRow('b', '마포구')];

        const first = getSeoulDistrictClusters(rows, 1);
        getRegionalClusters(rows);
        const second = getSeoulDistrictClusters(rows, 1);

        expect(second).toEqual(first);
    });

    test('맛집 필드를 제자리에서 바꾸면 결과가 따라 바뀐다', () => {
        const rows = [makeSeoulRow('a', '강남구')];
        const before = getRegionalClusters(rows);

        rows[0].road_address = '부산광역시 해운대구 1';
        rows[0].lat = 부산.lat;
        rows[0].lng = 부산.lng;

        const after = getRegionalClusters(rows);

        expect(before.map((cluster) => cluster.region)).toEqual(['서울특별시']);
        expect(after.map((cluster) => cluster.region)).toEqual(['부산광역시']);
    });

    test('목록에 항목을 추가하거나 제거하면 결과가 따라 바뀐다', () => {
        const rows = [makeSeoulRow('a', '강남구')];
        getRegionalClusters(rows);

        rows.push(makeSeoulRow('b', '강남구'));
        expect(getRegionalClusters(rows)[0].count).toBe(2);

        rows.splice(0, 2);
        rows.push(makeSeoulRow('c', '마포구'));
        expect(getRegionalClusters(rows).map((cluster) => cluster.region)).toEqual(['서울특별시']);
        expect(getSeoulDistrictClusters(rows, 1).clusters.map((cluster) => cluster.region)).toEqual(['마포구']);
    });

    test('돌려준 restaurantIds 를 수정해도 다음 호출 결과가 오염되지 않는다', () => {
        const rows = [makeSeoulRow('a', '강남구')];

        // 캐시가 비어 있는 단발 호출
        const alone = getSeoulDistrictClusters(rows, 1);
        alone.clusters[0].restaurantIds.push('오염');
        expect(getSeoulDistrictClusters(rows, 1).clusters[0].restaurantIds).toEqual(['a']);

        // getRegionalClusters 가 먼저 만든 캐시를 재사용하는 호출
        getRegionalClusters(rows);
        const shared = getSeoulDistrictClusters(rows, 1);
        shared.clusters[0].restaurantIds.push('오염');
        expect(getSeoulDistrictClusters(rows, 1).clusters[0].restaurantIds).toEqual(['a']);
    });
});

describe('getDistance', () => {
    test('같은 좌표는 0 이고 3-4-5 삼각형을 따른다', () => {
        expect(getDistance(37.5, 127.0, 37.5, 127.0)).toBe(0);
        expect(getDistance(0, 0, 3, 4)).toBe(5);
    });
});

