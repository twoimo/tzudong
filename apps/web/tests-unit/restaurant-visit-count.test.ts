import { describe, expect, test } from 'bun:test';

import { getTzuyangVisitCount, shouldShowTzuyangVisitBadge } from '../lib/restaurant-visit-count';
import type { Restaurant } from '../types/restaurant';

describe('restaurant visit count', () => {
    test('counts unique merged youtube links as Tzuyang visits', () => {
        const restaurant = {
            youtube_link: 'https://youtu.be/one',
            mergedYoutubeLinks: [
                'https://youtu.be/one',
                'https://youtu.be/two',
                ' https://youtu.be/two ',
                '',
            ],
        } as Partial<Restaurant>;

        expect(getTzuyangVisitCount(restaurant)).toBe(2);
        expect(shouldShowTzuyangVisitBadge(restaurant)).toBe(true);
    });

    test('falls back to review count when review history is richer than links', () => {
        const restaurant = {
            youtube_link: 'https://youtu.be/one',
            mergedTzuyangReviews: ['첫 번째 방문', '두 번째 방문', '두 번째 방문'],
        } as Partial<Restaurant>;

        expect(getTzuyangVisitCount(restaurant)).toBe(2);
    });

    test('counts compact merged restaurant rows when aggregate arrays are missing', () => {
        const restaurant = {
            mergedRestaurants: [
                { youtube_link: 'https://youtu.be/one', tzuyang_review: '첫 번째 방문' },
                { youtube_link: 'https://youtu.be/two', tzuyang_review: '두 번째 방문' },
            ],
        } as Partial<Restaurant>;

        expect(getTzuyangVisitCount(restaurant)).toBe(2);
    });

    test('does not show a badge for a single visit', () => {
        expect(shouldShowTzuyangVisitBadge({ youtube_link: 'https://youtu.be/one' })).toBe(false);
        expect(getTzuyangVisitCount(null)).toBe(0);
    });

    test('compact empty histories still reflect later edits and nested duplicate changes', () => {
        const row = { youtube_link: null, youtube_links: [], mergedYoutubeLinks: [],
            tzuyang_reviews: [], mergedTzuyangReviews: [], mergedRestaurants: [] } as Partial<Restaurant>;
        expect(getTzuyangVisitCount(row)).toBe(0);
        row.youtube_links!.push(' first ', 'first');
        expect(getTzuyangVisitCount(row)).toBe(1);
        row.mergedTzuyangReviews!.push('visit one', 'visit two');
        expect(getTzuyangVisitCount(row)).toBe(2);
        row.youtube_links!.length = 0;
        row.mergedTzuyangReviews!.length = 0;
        expect(getTzuyangVisitCount(row)).toBe(0);
        row.mergedRestaurants = [{ youtube_link: 'a' }, { youtube_link: 'b' }] as Restaurant['mergedRestaurants'];
        expect(getTzuyangVisitCount(row)).toBe(2);
        row.mergedRestaurants![1].youtube_link = 'a';
        expect(getTzuyangVisitCount(row)).toBe(1);
        row.mergedRestaurants!.length = 0;
        expect(getTzuyangVisitCount(row)).toBe(0);
    });
});
