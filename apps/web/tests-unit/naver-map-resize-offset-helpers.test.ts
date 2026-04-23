import { describe, expect, test } from 'bun:test';

import { resolveNaverResizeOffsets } from '../lib/naver-map-resize-offset-helpers';

describe('naver map resize offset helpers', () => {
    test('returns half panel offset on desktop with zero vertical shift', () => {
        expect(resolveNaverResizeOffsets({
            effectivePanelOffset: 400,
            isMobileOrTablet: false,
            mobileVerticalOffset: 120,
        })).toEqual({
            targetOffsetX: 200,
            targetOffsetY: 0,
        });
    });

    test('returns mobile vertical shift when on mobile', () => {
        expect(resolveNaverResizeOffsets({
            effectivePanelOffset: 0,
            isMobileOrTablet: true,
            mobileVerticalOffset: 154,
        })).toEqual({
            targetOffsetX: 0,
            targetOffsetY: 154,
        });
    });
});
