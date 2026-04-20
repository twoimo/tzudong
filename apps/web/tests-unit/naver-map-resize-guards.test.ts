import { describe, expect, test } from 'bun:test';

import { shouldSkipNaverResizeRecenter } from '../lib/naver-map-resize-guards';

describe('naver map resize guards', () => {
    test('skips recenter in grid mode', () => {
        expect(shouldSkipNaverResizeRecenter({
            hasUserMoved: false,
            isGridMode: true,
            skipTarget: false,
        })).toBe(true);
    });

    test('skips recenter when user moved map or target says skip', () => {
        expect(shouldSkipNaverResizeRecenter({
            hasUserMoved: true,
            isGridMode: false,
            skipTarget: false,
        })).toBe(true);
        expect(shouldSkipNaverResizeRecenter({
            hasUserMoved: false,
            isGridMode: false,
            skipTarget: true,
        })).toBe(true);
    });

    test('allows recenter only when all guards are clear', () => {
        expect(shouldSkipNaverResizeRecenter({
            hasUserMoved: false,
            isGridMode: false,
            skipTarget: false,
        })).toBe(false);
    });
});
