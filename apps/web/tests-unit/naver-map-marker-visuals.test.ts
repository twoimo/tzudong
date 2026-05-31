import { describe, expect, test } from 'bun:test';

import { getNaverIndividualMarkerVisual } from '../lib/naver-map-marker-visuals';

describe('naver map marker visuals', () => {
    test('returns selected marker payload', () => {
        const visual = getNaverIndividualMarkerVisual({ categories: ['한식'], category: [] }, true);
        expect(visual.anchor).toEqual({ x: 18, y: 18 });
        expect(visual.zIndex).toBe(100);
        expect(visual.content).toContain('/images/maker-images/webp/korean.webp');
        expect(visual.content).toContain('/images/maker-images/korean.png');
        expect(visual.content).toContain('type="image/webp"');
    });

    test('returns unselected marker payload', () => {
        const visual = getNaverIndividualMarkerVisual({ categories: [], category: ['분식'] }, false);
        expect(visual.anchor).toEqual({ x: 14, y: 14 });
        expect(visual.zIndex).toBe(1);
        expect(visual.content).toContain('/images/maker-images/webp/snack_bar.webp');
        expect(visual.content).toContain('/images/maker-images/snack_bar.png');
        expect(visual.content).toContain('type="image/webp"');
    });

    test('shows red visit count badge for restaurants visited at least twice', () => {
        const visual = getNaverIndividualMarkerVisual({
            categories: ['한식'],
            category: [],
            mergedYoutubeLinks: ['https://youtu.be/one', 'https://youtu.be/two'],
        }, false);

        expect(visual.content).toContain('class="tzuyang-visit-count-badge"');
        expect(visual.content).toContain('data-tzuyang-visit-count-badge="true"');
        expect(visual.content).toContain('background-color: #dc2626');
        expect(visual.content).toContain('aria-label="쯔양 2회 방문"');
        expect(visual.content).toContain('>2</span>');
    });

    test('does not show visit count badge for single-visit restaurants', () => {
        const visual = getNaverIndividualMarkerVisual({
            categories: ['한식'],
            category: [],
            youtube_link: 'https://youtu.be/one',
        }, false);

        expect(visual.content).not.toContain('tzuyang-visit-count-badge');
    });


});
