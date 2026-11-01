import { describe, expect, test } from 'bun:test';

import { getNaverIndividualMarkerVisual } from '../lib/naver-map-marker-visuals';
import type { Restaurant } from '../types/restaurant';

describe('naver map marker visuals', () => {
    test('refreshes a renamed restaurant in both cache layers and escapes its accessible name', () => {
        const restaurant = { id: 'renamed-marker', name: '기존 식당', categories: ['한식'] };
        for (const selected of [false, true]) {
            expect(getNaverIndividualMarkerVisual(restaurant, selected).content).toContain('aria-label="기존 식당 상세 보기"');
        }
        restaurant.name = '새 식당 "<본점>"';
        for (const selected of [false, true]) {
            for (const row of [restaurant, { ...restaurant }]) {
                const visual = getNaverIndividualMarkerVisual(row, selected);
                expect(visual.content).toContain('aria-label="새 식당 &quot;&lt;본점&gt;&quot; 상세 보기"');
                expect(visual.content).not.toContain('기존 식당');
                expect(visual.content).toContain('<button type="button"');
                expect(visual.content).not.toContain('alt="marker"');
            }
        }
    });

    test('refreshes both cached selection states when the public popularity tier changes in place', () => {
        const restaurant: Pick<Restaurant, 'id' | 'categories' | 'popularity_tier'> = {
            id: 'tier-mutation-marker',
            categories: ['한식'],
            popularity_tier: 'standard',
        };
        for (const tier of ['standard', 'fire', 'rainbow', null] as const) {
            restaurant.popularity_tier = tier;
            for (const selected of [false, true]) {
                const visual = getNaverIndividualMarkerVisual(restaurant, selected);
                expect(visual.content).toContain(`class="tz-popularity-marker" data-popularity-tier="${tier ?? 'standard'}"`);
                expect(getNaverIndividualMarkerVisual(restaurant, selected)).toBe(visual);
            }
        }
    });

    test('keeps shared visual cache entries distinct across refreshed rows and overlay markers', () => {
        const restaurant = { id: 'tier-refetch-marker', categories: ['분식'] };
        for (const overlay of [[], ['trend']] as const) {
            for (const tier of ['fire', 'rainbow', 'standard', null] as const) {
                for (const selected of [false, true]) {
                    const visual = getNaverIndividualMarkerVisual({ ...restaurant, popularity_tier: tier }, selected, overlay);
                    expect(visual.content).toContain(`class="tz-popularity-marker" data-popularity-tier="${tier ?? 'standard'}"`);
                    expect(visual.content).toContain(`data-restaurant-marker-kind="${overlay.length ? 'trend' : 'category'}"`);
                }
            }
        }
    });

    test('reuses the visual for the same restaurant until a displayed field changes', () => {
        const restaurant = { categories: ['한식'], category: [] as string[] };
        const first = getNaverIndividualMarkerVisual(restaurant, false);
        expect(getNaverIndividualMarkerVisual(restaurant, false)).toBe(first);
        restaurant.categories = ['분식'];
        expect(getNaverIndividualMarkerVisual(restaurant, false).content).toContain('snack_bar');
    });

    test('returns selected marker payload', () => {
        const visual = getNaverIndividualMarkerVisual({ categories: ['한식'], category: [] }, true);
        expect(visual.anchor).toEqual({ x: 18, y: 18 });
        expect(visual.zIndex).toBe(100);
        expect(visual.content).toContain('data-restaurant-marker-kind="category"');
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
        expect(visual.content).toContain('data-restaurant-marker-provenance="source_type:user_submission_new"');
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
        expect(trendVisual.content).toContain('data-restaurant-marker-provenance="overlay:trend"');
        expect(trendVisual.content).toContain('/images/maker-images/webp/trend.webp');
        expect(seasonalVisual.content).toContain('data-restaurant-marker-kind="seasonal"');
        expect(seasonalVisual.content).toContain('data-restaurant-marker-provenance="overlay:seasonal"');
        expect(seasonalVisual.content).toContain('/images/maker-images/webp/seasonal.webp');
    });


});
