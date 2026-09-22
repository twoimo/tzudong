import { describe, expect, test } from 'bun:test';
import {
    buildOverseasCountryAddressOrFilter,
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

    test('escapes like wildcards and drops or() separators', () => {
        expect(sanitizePostgrestOrTerm('100%_서울),id.eq.1')).toBe('100\\%\\_서울  id.eq.1');
        expect(sanitizePostgrestOrTerm('   ')).toBe('');
        expect(sanitizePostgrestOrTerm('서울특별시')).toBe('서울특별시');
    });
});
