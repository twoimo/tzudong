import { describe, expect, test } from 'bun:test';

import {
    applyHomeMapThemeFilter,
    HOME_MAP_THEME_FILTER_IDS,
    HOME_MAP_THEME_FILTERS,
    isHomeMapThemeFilterId,
    isYoutubeMetadataBackedHomeMapThemeFilterId,
} from '../lib/home-map-theme-filters';
import type { Restaurant, YoutubeMeta } from '../types/restaurant';

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

function meta(overrides: YoutubeMeta): YoutubeMeta {
    return overrides;
}

function ids(restaurants: Restaurant[]): string[] {
    return restaurants.map((item) => item.id);
}

describe('home map theme filters', () => {
    test('exposes the approved YouTube-first taxonomy and config', () => {
        expect(HOME_MAP_THEME_FILTER_IDS).toEqual([
            'hot-view',
            'comment-hot',
            'fresh-video',
            'repeat-video',
            'fan-signal',
        ]);
        expect(HOME_MAP_THEME_FILTERS.map((filter) => [filter.id, filter.label, filter.shortLabel])).toEqual([
            ['hot-view', '조회수 폭발', '조회수'],
            ['comment-hot', '댓글 폭주', '댓글'],
            ['fresh-video', '최근 영상', '최근'],
            ['repeat-video', '재등장 맛집', '재등장'],
            ['fan-signal', '반응 찐함', '반응'],
        ]);
        expect(HOME_MAP_THEME_FILTERS.find((filter) => filter.id === 'hot-view')?.ariaLabel).toBe(
            '조회수가 높은 쯔양 영상 맛집 필터',
        );
        expect(HOME_MAP_THEME_FILTERS.find((filter) => filter.id === 'comment-hot')?.description).toContain(
            '댓글 수가 현재 결과 상위권',
        );
        expect(HOME_MAP_THEME_FILTERS.find((filter) => filter.id === 'fresh-video')?.description).toContain('90일');
        expect(HOME_MAP_THEME_FILTERS.find((filter) => filter.id === 'repeat-video')?.description).toContain(
            '2개 이상',
        );
        expect(HOME_MAP_THEME_FILTERS.find((filter) => filter.id === 'fan-signal')?.description).toContain(
            '댓글 밀도',
        );

        for (const id of HOME_MAP_THEME_FILTER_IDS) {
            expect(isHomeMapThemeFilterId(id)).toBe(true);
        }
        expect(isHomeMapThemeFilterId('new')).toBe(false);
        expect(isHomeMapThemeFilterId('repeat')).toBe(false);
        expect(isHomeMapThemeFilterId('favorite')).toBe(false);
        expect(isHomeMapThemeFilterId('review-rich')).toBe(false);
        expect(isHomeMapThemeFilterId('video-rich')).toBe(false);
    });

    test('identifies only metadata-backed chips for compact youtube_meta projection', () => {
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId('hot-view')).toBe(true);
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId('comment-hot')).toBe(true);
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId('fresh-video')).toBe(true);
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId('fan-signal')).toBe(true);
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId('repeat-video')).toBe(false);
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId('new')).toBe(false);
        expect(isYoutubeMetadataBackedHomeMapThemeFilterId(null)).toBe(false);
    });

    test('accepts numeric strings and includes ties in the current-result top band', () => {
        const restaurants = [
            restaurant('top', { mergedYoutubeMetas: [meta({ viewCount: '1000' })] }),
            restaurant('tie-a', { youtube_meta: meta({ viewCount: 900 }) as Restaurant['youtube_meta'] }),
            restaurant('tie-b', { mergedYoutubeMetas: [meta({ viewCount: '900' })] }),
            restaurant('below-a', { mergedYoutubeMetas: [meta({ viewCount: 800 })] }),
            restaurant('below-b', { mergedYoutubeMetas: [meta({ viewCount: 700 })] }),
            restaurant('below-c', { mergedYoutubeMetas: [meta({ viewCount: 600 })] }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'hot-view'))).toEqual(['top', 'tie-a', 'tie-b']);
    });

    test('ignores invalid and missing metrics instead of treating them as zero', () => {
        const restaurants = [
            restaurant('valid', { mergedYoutubeMetas: [meta({ commentCount: '3' })] }),
            restaurant('empty', { mergedYoutubeMetas: [meta({ commentCount: '' })] }),
            restaurant('negative', { mergedYoutubeMetas: [meta({ commentCount: -1 })] }),
            restaurant('missing', { mergedYoutubeMetas: [meta({ title: 'no metric' })] }),
            restaurant('nan', { mergedYoutubeMetas: [meta({ commentCount: 'nope' })] }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'comment-hot'))).toEqual(['valid']);
    });

    test('keeps the single restaurant with a valid metric when valid data exists', () => {
        const restaurants = [
            restaurant('missing', { mergedYoutubeMetas: [meta({ title: 'no metric' })] }),
            restaurant('only-valid', { mergedYoutubeMetas: [meta({ viewCount: 1 })] }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'hot-view'))).toEqual(['only-valid']);
    });

    test('anchors fresh-video to the latest candidate publish date rather than wall clock', () => {
        const restaurants = [
            restaurant('latest', { mergedYoutubeMetas: [meta({ publishedAt: '2022-01-01T00:00:00.000Z' })] }),
            restaurant('within-window', { mergedYoutubeMetas: [meta({ publishedAt: '2021-10-03T00:00:00.000Z' })] }),
            restaurant('outside-window', { mergedYoutubeMetas: [meta({ publishedAt: '2021-10-02T23:59:59.000Z' })] }),
            restaurant('invalid', { mergedYoutubeMetas: [meta({ publishedAt: 'not a date' })] }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'fresh-video'))).toEqual(['latest', 'within-window']);
    });

    test('counts repeat-video from merged links without metadata and dedupes duplicate links', () => {
        const restaurants = [
            restaurant('merged-links', { mergedYoutubeLinks: ['https://youtu.be/a', 'https://youtu.be/b'] }),
            restaurant('deduped', {
                youtube_link: 'https://youtu.be/a',
                mergedYoutubeLinks: ['https://youtu.be/a'],
                mergedRestaurants: [{ youtube_link: 'https://youtu.be/a' } as Restaurant],
            }),
            restaurant('merged-records', {
                mergedRestaurants: [
                    { youtube_link: 'https://youtu.be/c' } as Restaurant,
                    { youtube_link: 'https://youtu.be/d' } as Restaurant,
                ],
            }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'repeat-video'))).toEqual(['merged-links', 'merged-records']);
    });

    test('uses merged metadata sources and dedupes conservatively', () => {
        const sharedMeta = meta({ title: 'same', publishedAt: '2024-01-01', viewCount: 1000, commentCount: 10 });
        const restaurants = [
            restaurant('merged', {
                youtube_meta: sharedMeta as Restaurant['youtube_meta'],
                mergedYoutubeMetas: [sharedMeta, meta({ title: 'newer', publishedAt: '2024-02-01', viewCount: 1200 })],
                mergedRestaurants: [{ youtube_meta: meta({ title: 'child', publishedAt: '2024-03-01', viewCount: 900 }) } as Restaurant],
            }),
            restaurant('below', { mergedYoutubeMetas: [meta({ viewCount: 1 })] }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'hot-view'))).toEqual(['merged']);
    });

    test('fan-signal excludes tiny high-ratio videos by requiring median view baseline', () => {
        const restaurants = [
            restaurant('tiny-loud', { mergedYoutubeMetas: [meta({ viewCount: 10, commentCount: 5 })] }),
            restaurant('baseline-winner', { mergedYoutubeMetas: [meta({ viewCount: 1000, commentCount: 100 })] }),
            restaurant('baseline-lower', { mergedYoutubeMetas: [meta({ viewCount: 900, commentCount: 45 })] }),
        ];

        expect(ids(applyHomeMapThemeFilter(restaurants, 'fan-signal'))).toEqual(['baseline-winner']);
    });
});
