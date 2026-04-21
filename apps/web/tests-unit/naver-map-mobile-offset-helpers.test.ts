import { describe, expect, test } from 'bun:test';

import {
    calculateNaverMobileVerticalOffset,
    resolveNaverMobileVerticalOffset,
} from '../lib/naver-map-mobile-offset-helpers';

describe('naver map mobile offset helpers', () => {
    test('calculates centered vertical offset from sheet and nav heights', () => {
        expect(calculateNaverMobileVerticalOffset({
            fineTunePx: -6,
            navHeight: 60,
            sheetHeightPercent: 50,
            viewportHeight: 800,
        })).toBe(224);
    });

    test('clamps sheet percent between 0 and 100', () => {
        expect(calculateNaverMobileVerticalOffset({
            fineTunePx: 0,
            navHeight: 40,
            sheetHeightPercent: -20,
            viewportHeight: 700,
        })).toBe(20);

        expect(calculateNaverMobileVerticalOffset({
            fineTunePx: 0,
            navHeight: 40,
            sheetHeightPercent: 140,
            viewportHeight: 700,
        })).toBe(370);
    });

    test('resolves zero vertical offset outside mobile and tablet layouts', () => {
        expect(resolveNaverMobileVerticalOffset({
            fineTunePx: -6,
            isMobileOrTablet: false,
            navHeight: 60,
            sheetHeightPercent: 50,
            viewportHeight: 800,
        })).toBe(0);
    });

    test('resolves calculated vertical offset for mobile and tablet layouts', () => {
        expect(resolveNaverMobileVerticalOffset({
            fineTunePx: -6,
            isMobileOrTablet: true,
            navHeight: 60,
            sheetHeightPercent: 50,
            viewportHeight: 800,
        })).toBe(224);
    });
});
