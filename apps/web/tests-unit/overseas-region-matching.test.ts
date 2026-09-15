import { describe, expect, test } from 'bun:test';

import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
import {
    buildOverseasCountryAddressOrFilter,
    getOverseasSearchTermsForCountry,
    quotePostgrestValue,
    restaurantMatchesOverseasCountry,
} from '@/lib/overseas-region-matching';

const DQ = String.fromCharCode(34);
const BS = String.fromCharCode(92);
const quoted = (value: string) => DQ + value + DQ;

describe('quotePostgrestValue', () => {
    test('wraps plain operands in double quotes', () => {
        expect(quotePostgrestValue('%Sydney%')).toBe(quoted('%Sydney%'));
    });

    test('escapes embedded double quotes and backslashes', () => {
        expect(quotePostgrestValue('%a' + DQ + 'b%')).toBe(quoted('%a' + BS + DQ + 'b%'));
        expect(quotePostgrestValue('%a' + BS + 'b%')).toBe(quoted('%a' + BS + BS + 'b%'));
    });
});

describe('buildOverseasCountryAddressOrFilter', () => {
    test('returns null for unknown or empty countries', () => {
        expect(buildOverseasCountryAddressOrFilter(null)).toBeNull();
        expect(buildOverseasCountryAddressOrFilter('')).toBeNull();
        expect(buildOverseasCountryAddressOrFilter('없는국가')).toBeNull();
    });

    test('quotes every operand so region labels with parentheses stay parseable', () => {
        const filter = buildOverseasCountryAddressOrFilter('오스트레일리아', '%');
        expect(filter).not.toBeNull();
        const clauses = (filter ?? '').split(',');
        expect(clauses.length).toBeGreaterThan(0);
        clauses.forEach((clause) => {
            const operand = clause.slice(clause.indexOf('.ilike.') + '.ilike.'.length);
            expect(operand.startsWith(DQ) && operand.endsWith(DQ)).toBe(true);
        });
        expect(filter).toContain(quoted('%NSW%'));
    });

    test('covers every configured overseas region with at least one keyword per address field', () => {
        const countries = [...new Set(Object.values(OVERSEAS_REGIONS).map((c) => c.country))];
        countries.forEach((country) => {
            const terms = getOverseasSearchTermsForCountry(country);
            expect(terms.length).toBeGreaterThan(1);
            expect(terms).toContain(country);
        });
    });
});

describe('restaurantMatchesOverseasCountry', () => {
    const restaurant = {
        road_address: '248 Palmer St, Darlinghurst NSW 2010',
        jibun_address: null,
        english_address: null,
    };
    test('matches australia via NSW keyword', () => {
        expect(restaurantMatchesOverseasCountry(restaurant as any, '오스트레일리아')).toBe(true);
        expect(restaurantMatchesOverseasCountry(restaurant as any, '헝가리')).toBe(false);
    });
});
