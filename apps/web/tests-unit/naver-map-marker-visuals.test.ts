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

    test('marks user-submitted restaurants with a distinct marker wrapper without changing category asset', () => {
        const visual = getNaverIndividualMarkerVisual({
            id: 'user-rest-1',
            categories: ['분식'],
            category: [],
            source_type: 'user_submission_new',
        }, false);

        expect(visual.content).toContain('data-restaurant-marker-kind="user-submitted"');
        expect(visual.content).toContain('사용자 제보 맛집');
        expect(visual.content).toContain('>제보</span>');
        expect(visual.content).toContain('/images/maker-images/webp/user_submitted.webp');
        expect(visual.content).toContain('data-restaurant-marker-asset-version="restaurant-marker-assets-gpt-image-2-20260707"');
    });

    test('uses admin overlay marker assets for trend and seasonal marker kinds', () => {
        const trendVisual = getNaverIndividualMarkerVisual({
            id: 'trend-rest-1',
            categories: ['한식'],
            category: [],
        }, false, ['trend']);
        const seasonalVisual = getNaverIndividualMarkerVisual({
            id: 'seasonal-rest-1',
            categories: ['한식'],
            category: [],
        }, false, ['seasonal']);

        expect(trendVisual.content).toContain('data-restaurant-marker-kind="trend"');
        expect(trendVisual.content).toContain('/images/maker-images/webp/trend.webp');
        expect(seasonalVisual.content).toContain('data-restaurant-marker-kind="seasonal"');
        expect(seasonalVisual.content).toContain('/images/maker-images/webp/seasonal.webp');
    });


});
