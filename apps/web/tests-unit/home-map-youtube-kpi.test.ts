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

test('enrichment requests every video beyond the first 120 in bounded batches', async () => {
    const { enrichRestaurantsWithHomeMapYoutubeKpiMetrics } = await import('../lib/home-map-youtube-kpi');
    const originalFetch = globalThis.fetch;
    const batches: string[][] = [];
    globalThis.fetch = (async (_url, init) => {
        const ids = JSON.parse(String(init?.body)).videoIds as string[];
        batches.push(ids);
        return Response.json({ metrics: ids.map(videoId => ({ videoId, viewCount: 123, likeCount: 1, commentCount: 2, duration: 60, title: null, publishedAt: null })) });
    }) as typeof fetch;
    try {
        const rows = Array.from({ length: 241 }, (_, i) => restaurant(String(i), { youtube_link: `https://youtu.be/${String(i).padStart(11, '0')}` }));
        const result = await enrichRestaurantsWithHomeMapYoutubeKpiMetrics(rows, 'hot-view');
        expect(batches.map(batch => batch.length)).toEqual([120, 120, 1]);
        expect(result.at(-1)?.youtube_meta).toMatchObject({ viewCount: 123 });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('a newer snapshot replaces stale merged metrics instead of keeping both', () => {
    const oldRow = restaurant('a', { youtube_link: 'https://youtu.be/abcdefghijk', youtube_meta: { viewCount: 9999, commentCount: 999 } });
    const result = mergeHomeMapYoutubeKpiMetrics([{ ...oldRow, mergedRestaurants: [oldRow], mergedYoutubeMetas: [{ viewCount: 9999 }] }], new Map([
        ['abcdefghijk', { videoId: 'abcdefghijk', viewCount: 1000, likeCount: 10, commentCount: 3, duration: 60, title: null, publishedAt: null }],
    ]));
    expect(result[0].mergedRestaurants?.[0].youtube_meta).toMatchObject({ viewCount: 1000 });
    expect(result[0].mergedYoutubeMetas?.map(meta => meta.viewCount)).toEqual([1000]);
});
