import { describe, expect, test } from 'bun:test';

import {
    collectHomeMapYoutubeVideoIds,
    mergeHomeMapYoutubeKpiMetrics,
} from '../lib/home-map-youtube-kpi';
import type { Restaurant } from '../types/restaurant';

function restaurant(id: string, overrides: Partial<Restaurant> = {}): Restaurant {
    return {
        id,
        approved_name: id,
        youtube_link: null,
        youtube_meta: null,
        mergedRestaurants: [],
        mergedYoutubeLinks: [],
        mergedYoutubeMetas: [],
        ...overrides,
    } as Restaurant;
}

describe('home map youtube KPI enrichment', () => {
    test('collects direct, merged link, and merged restaurant video ids', () => {
        expect(collectHomeMapYoutubeVideoIds([
            restaurant('a', {
                youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk',
                mergedYoutubeLinks: ['https://youtu.be/lmnopqrstuv'],
                mergedRestaurants: [
                    { youtube_link: 'https://www.youtube.com/shorts/wxyzABCDE12' } as Restaurant,
                ],
            }),
        ])).toEqual(['abcdefghijk', 'lmnopqrstuv', 'wxyzABCDE12']);
    });

    test('merges latest KPI metrics into metadata used by theme filters', () => {
        const merged = mergeHomeMapYoutubeKpiMetrics([
            restaurant('a', {
                youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk',
                youtube_meta: { title: '원본 제목' } as Restaurant['youtube_meta'],
            }),
        ], new Map([
            ['abcdefghijk', {
                videoId: 'abcdefghijk',
                title: '최신 제목',
                publishedAt: '2026-01-01T00:00:00.000Z',
                duration: 600,
                viewCount: 1234,
                likeCount: 56,
                commentCount: 78,
            }],
        ]));

        expect(merged[0].youtube_meta).toMatchObject({
            title: '최신 제목',
            publishedAt: '2026-01-01T00:00:00.000Z',
            viewCount: 1234,
            commentCount: 78,
        });
        expect(merged[0].mergedYoutubeMetas).toContainEqual(expect.objectContaining({
            viewCount: 1234,
            commentCount: 78,
        }));
    });
});
