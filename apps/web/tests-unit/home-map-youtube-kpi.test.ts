import { describe, expect, test } from 'bun:test';

import {
    chunkHomeMapYoutubeVideoIds,
    collectHomeMapYoutubeVideoIds,
    enrichRestaurantsWithHomeMapYoutubeKpiMetrics,
    HOME_MAP_YOUTUBE_KPI_REQUEST_CHUNK_SIZE,
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


    test('chunks video ids so home KPI requests stay under the bounded POST limit', () => {
        const videoIds = Array.from({ length: 250 }, (_, index) => `id${String(index).padStart(4, '0')}`);
        const chunks = chunkHomeMapYoutubeVideoIds(videoIds);
        expect(HOME_MAP_YOUTUBE_KPI_REQUEST_CHUNK_SIZE).toBe(100);
        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toHaveLength(100);
        expect(chunks[1]).toHaveLength(100);
        expect(chunks[2]).toHaveLength(50);
        expect(JSON.stringify({ videoIds: chunks[0] }).length).toBeLessThan(8 * 1024);
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

    test('returns the original restaurants when the KPI request fails', async () => {
        const restaurants = [restaurant('request-failure', {
            youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk',
        })];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;

        try {
            await expect(enrichRestaurantsWithHomeMapYoutubeKpiMetrics(restaurants, 'hot-view'))
                .resolves.toBe(restaurants);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('returns the original restaurants when the KPI response is invalid JSON', async () => {
        const restaurants = [restaurant('invalid-response', {
            youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk',
        })];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError('invalid JSON');
            },
        })) as typeof fetch;

        try {
            await expect(enrichRestaurantsWithHomeMapYoutubeKpiMetrics(restaurants, 'hot-view'))
                .resolves.toBe(restaurants);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
