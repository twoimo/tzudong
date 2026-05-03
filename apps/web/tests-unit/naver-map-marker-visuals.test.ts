import { describe, expect, test } from 'bun:test';

import { getNaverIndividualMarkerVisual } from '../lib/naver-map-marker-visuals';

describe('naver map marker visuals', () => {
    test('returns selected marker payload', () => {
        const visual = getNaverIndividualMarkerVisual({ categories: ['한식'], category: [] }, true);
        expect(visual.anchor).toEqual({ x: 18, y: 18 });
        expect(visual.zIndex).toBe(100);
        expect(visual.content).toContain('/images/maker-images/korean.png');
    });

    test('returns unselected marker payload', () => {
        const visual = getNaverIndividualMarkerVisual({ categories: [], category: ['분식'] }, false);
        expect(visual.anchor).toEqual({ x: 14, y: 14 });
        expect(visual.zIndex).toBe(1);
        expect(visual.content).toContain('/images/maker-images/snack_bar.png');
    });
});
