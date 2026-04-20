import { describe, expect, test } from 'bun:test';

import { resolveNaverTargetOffsets } from '../lib/naver-map-target-offset-helpers';

describe('naver map target offset helpers', () => {
    test('returns half viewport offset on desktop with zero vertical offset', () => {
        expect(resolveNaverTargetOffsets({
            effectiveOffset: 400,
            isMobileOrTablet: false,
            mobileVerticalOffset: 120,
        })).toEqual({
            targetOffsetX: 200,
            targetOffsetY: 0,
        });
    });

    test('returns half viewport offset and mobile vertical offset on mobile', () => {
        expect(resolveNaverTargetOffsets({
            effectiveOffset: 0,
            isMobileOrTablet: true,
            mobileVerticalOffset: 154,
        })).toEqual({
            targetOffsetX: 0,
            targetOffsetY: 154,
        });
    });
});
