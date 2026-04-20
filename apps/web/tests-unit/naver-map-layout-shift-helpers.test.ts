import { describe, expect, test } from 'bun:test';

import { resolveNaverLayoutShiftDelta } from '../lib/naver-map-layout-shift-helpers';

describe('naver map layout shift helpers', () => {
    test('derives half-width pan delta from offset change', () => {
        expect(resolveNaverLayoutShiftDelta({
            effectiveOffset: 400,
            previousOffset: 0,
        })).toEqual({
            deltaOffset: 400,
            deltaX: 200,
            shouldPan: true,
        });
    });

    test('does not pan when offset is unchanged', () => {
        expect(resolveNaverLayoutShiftDelta({
            effectiveOffset: 200,
            previousOffset: 200,
        })).toEqual({
            deltaOffset: 0,
            deltaX: 0,
            shouldPan: false,
        });
    });
});
