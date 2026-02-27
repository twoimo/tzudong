import { describe, expect, test } from 'bun:test';

import { chatTreemapCalcChange } from '@/components/insight/InsightChatSection';

describe('insight treemap negative change handling', () => {
    test('keeps negative ratio for drops', () => {
        expect(chatTreemapCalcChange(80, 200)).toBe(-60);
        expect(chatTreemapCalcChange(20, 50)).toBe(-60);
        expect(chatTreemapCalcChange(0, 123)).toBe(-100);
    });

    test('returns 0 when previous metric is unavailable or non-positive', () => {
        expect(chatTreemapCalcChange(120, null)).toBe(0);
        expect(chatTreemapCalcChange(120, 0)).toBe(0);
        expect(chatTreemapCalcChange(120, -10)).toBe(0);
    });
});
