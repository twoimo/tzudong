import { describe, expect, test } from 'bun:test';

import { buildRestaurantAddressDisplayEntries } from '@/lib/restaurant-address-presenter';

describe('buildRestaurantAddressDisplayEntries', () => {
    test('suppresses duplicate overseas address rows into one local entry', () => {
        expect(buildRestaurantAddressDisplayEntries({
            road_address: '123 Main St, New York, NY',
            jibun_address: '123 Main St, New York, NY',
            english_address: '123 Main St, New York, NY',
        })).toEqual([
            {
                type: 'local',
                label: '현지 주소',
                address: '123 Main St, New York, NY',
            },
        ]);
    });

    test('preserves distinct domestic road, jibun, and English fields', () => {
        expect(buildRestaurantAddressDisplayEntries({
            road_address: '서울특별시 강남구 테헤란로 123',
            jibun_address: '서울특별시 강남구 역삼동 123-45',
            english_address: '123, Teheran-ro, Gangnam-gu, Seoul',
        })).toEqual([
            {
                type: 'road',
                label: '도로명 주소',
                address: '서울특별시 강남구 테헤란로 123',
            },
            {
                type: 'jibun',
                label: '지번 주소',
                address: '서울특별시 강남구 역삼동 123-45',
            },
            {
                type: 'english',
                label: '영어 주소',
                address: '123, Teheran-ro, Gangnam-gu, Seoul',
            },
        ]);
    });

    test('dedupes repeated values after trim, case, and whitespace normalization', () => {
        expect(buildRestaurantAddressDisplayEntries({
            road_address: '  123 Main   St  ',
            jibun_address: '123 main st',
            english_address: '456 Side St',
        })).toEqual([
            {
                type: 'road',
                label: '도로명 주소',
                address: '123 Main   St',
            },
            {
                type: 'english',
                label: '영어 주소',
                address: '456 Side St',
            },
        ]);
    });

    test('returns no entries when address fields are empty', () => {
        expect(buildRestaurantAddressDisplayEntries({
            road_address: '   ',
            jibun_address: null,
            english_address: undefined,
        })).toEqual([]);
    });
});
