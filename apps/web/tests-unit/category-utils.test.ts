import { describe, expect, test } from 'bun:test';

import { formatCategoryText, parseCategoryList } from '../lib/category-utils';

describe('parseCategoryList', () => {
    test('keeps array input order and drops non-string or blank entries', () => {
        expect(parseCategoryList(['한식', '분식'])).toEqual(['한식', '분식']);
        expect(parseCategoryList(['한식', '   ', '', 3, null, undefined, {}, '분식'])).toEqual([
            '한식',
            '분식',
        ]);
    });

    test('trims array entries and removes duplicates while preserving first occurrence', () => {
        expect(parseCategoryList(['  한식  ', '분식', '한식', '분식'])).toEqual(['한식', '분식']);
    });

    test('returns an empty list for empty, blank, or unsupported input', () => {
        expect(parseCategoryList([])).toEqual([]);
        expect(parseCategoryList('')).toEqual([]);
        expect(parseCategoryList('   ')).toEqual([]);
        expect(parseCategoryList(null)).toEqual([]);
        expect(parseCategoryList(undefined)).toEqual([]);
        expect(parseCategoryList(42)).toEqual([]);
        expect(parseCategoryList({ category: '한식' })).toEqual([]);
    });

    test('parses a JSON array string', () => {
        expect(parseCategoryList('["한식", "분식"]')).toEqual(['한식', '분식']);
        expect(parseCategoryList('["한식", "", 7, "한식"]')).toEqual(['한식']);
    });

    test('falls back without throwing when bracket-shaped text is not valid JSON', () => {
        const result = parseCategoryList('[한식, 분식');
        expect(Array.isArray(result)).toBe(true);
        expect(result.every((entry) => typeof entry === 'string')).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });

    test('splits on comma, semicolon, newline, pipe, and slash delimiters', () => {
        expect(parseCategoryList('한식, 분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('한식;분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('한식\n분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('한식|분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('한식/분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('한식\\분식')).toEqual(['한식', '분식']);
    });

    test('splits on whitespace only after delimiter splitting finds nothing', () => {
        expect(parseCategoryList('한식 분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('고기  카페·디저트')).toEqual(['고기', '카페·디저트']);
    });

    test('greedily recovers known categories packed without separators', () => {
        expect(parseCategoryList('한식분식')).toEqual(['한식', '분식']);
        expect(parseCategoryList('치킨피자')).toEqual(['치킨', '피자']);
        expect(parseCategoryList('카페·디저트한식')).toEqual(['카페·디저트', '한식']);
    });

    test('keeps the original text when packed text cannot be fully segmented', () => {
        expect(parseCategoryList('한식당')).toEqual(['한식당']);
        expect(parseCategoryList('푸드코트')).toEqual(['푸드코트']);
    });

    test('treats a single known category as one entry', () => {
        expect(parseCategoryList('한식')).toEqual(['한식']);
        expect(parseCategoryList('  돈까스·회  ')).toEqual(['돈까스·회']);
    });
});

describe('formatCategoryText', () => {
    test('joins parsed categories with a comma', () => {
        expect(formatCategoryText(['한식', '분식'])).toBe('한식, 분식');
        expect(formatCategoryText('한식, 분식')).toBe('한식, 분식');
    });

    test('uses a dash as the default fallback for empty input', () => {
        expect(formatCategoryText([])).toBe('-');
        expect(formatCategoryText('')).toBe('-');
        expect(formatCategoryText(null)).toBe('-');
    });

    test('honours a custom fallback', () => {
        expect(formatCategoryText(undefined, '미분류')).toBe('미분류');
        expect(formatCategoryText([], '')).toBe('');
    });
});
