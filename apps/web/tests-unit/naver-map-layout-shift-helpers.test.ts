import { describe, expect, test } from 'bun:test';

import {
    resolveNaverCenteringTransitionResizePlan,
    resolveNaverLayoutShiftDelta,
    shouldPreserveNaverVisualCenterOnLayoutShift,
} from '../lib/naver-map-layout-shift-helpers';

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

    test('preserves visual center only for user-moved layout-only changes', () => {
        expect(shouldPreserveNaverVisualCenterOnLayoutShift({
            hasUserMovedMap: true,
            isSelectionChanged: false,
        })).toBe(true);

        expect(shouldPreserveNaverVisualCenterOnLayoutShift({
            hasUserMovedMap: true,
            isSelectionChanged: true,
        })).toBe(false);

        expect(shouldPreserveNaverVisualCenterOnLayoutShift({
            hasUserMovedMap: false,
            isSelectionChanged: false,
        })).toBe(false);
    });

    test('uses stable resize timing around centering transitions', () => {
        expect(resolveNaverCenteringTransitionResizePlan()).toEqual({
            initialResizeEvent: 'resize',
            followupResizeDelayMs: 320,
            followupResizeEvent: 'resize',
        });

        expect(resolveNaverCenteringTransitionResizePlan({ delayMs: 150 })).toEqual({
            initialResizeEvent: 'resize',
            followupResizeDelayMs: 150,
            followupResizeEvent: 'resize',
        });
    });
});
