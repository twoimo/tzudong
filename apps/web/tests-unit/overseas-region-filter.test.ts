import { describe, expect, test } from 'bun:test';
import {
    buildOverseasCountryAddressOrFilter,
    findOverseasRegionKeyForRestaurant,
    sanitizePostgrestOrTerm,
} from '../lib/overseas-region-matching';

describe('overseas country PostgREST filter', () => {
    test('keeps ordinary keywords unchanged inside ilike terms', () => {
        const filter = buildOverseasCountryAddressOrFilter('미국', '*');

        expect(filter).toContain('road_address.ilike.*Los Angeles*');
        expect(filter).toContain('jibun_address.ilike.*뉴욕*');
        expect(filter).toContain('english_address.ilike.*미국*');
        expect(filter).not.toContain('(');
        expect(filter).not.toContain(')');
    });

    test('removes parentheses from a parenthesized country label before it reaches or()', () => {
        const filter = buildOverseasCountryAddressOrFilter('헝가리(부다페스트)', '%');

        expect(filter).toContain('road_address.ilike.%부다페스트%');
        expect(filter).toContain('english_address.ilike.%Budapest%');
        expect(filter).toContain('road_address.ilike.%헝가리 부다페스트%');
        expect(filter).not.toContain('헝가리(부다페스트)');
        expect(filter).not.toContain('(');
        expect(filter).not.toContain(')');
    });

    test('returns null for an empty country, a non-string, or an unknown value', () => {
        expect(buildOverseasCountryAddressOrFilter(null)).toBeNull();
        expect(buildOverseasCountryAddressOrFilter(undefined)).toBeNull();
        expect(buildOverseasCountryAddressOrFilter('')).toBeNull();
        expect(buildOverseasCountryAddressOrFilter(12 as unknown as string)).toBeNull();
        expect(buildOverseasCountryAddressOrFilter('서울),id.eq.secret')).toBeNull();
    });

    test('resolves a restaurant to its city region instead of the first region of the same country', () => {
        expect(findOverseasRegionKeyForRestaurant({
            road_address: '1250 Broadway, New York, NY 10001 미국',
            jibun_address: null,
            english_address: null,
        })).toBe('미국(뉴욕)');
        expect(findOverseasRegionKeyForRestaurant({
            road_address: null,
            jibun_address: null,
            english_address: '1-2 Namba, Osaka, Japan',
        })).toBe('일본(오사카)');
        expect(findOverseasRegionKeyForRestaurant({
            road_address: '서울특별시 동대문구 장한로24길 7',
            jibun_address: null,
            english_address: null,
        })).toBeNull();
    });

    test('escapes like wildcards and drops or() separators', () => {
        expect(sanitizePostgrestOrTerm('100%_서울),id.eq.1')).toBe('100\\%\\_서울  id.eq.1');
        expect(sanitizePostgrestOrTerm('   ')).toBe('');
        expect(sanitizePostgrestOrTerm('서울특별시')).toBe('서울특별시');
    });
});
