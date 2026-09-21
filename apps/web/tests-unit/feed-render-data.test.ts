import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, useMemo, useState } from 'react';
import { renderToString } from 'react-dom/server';
import type { FeedReview } from '../components/feed/FeedContent';

const source = readFileSync(join(import.meta.dir, '../components/feed/FeedContent.tsx'), 'utf8');
const start = source.indexOf('    const feedReviews = useMemo(');
const end = source.indexOf('    const isLoopRepeatMode =', start);
if (start < 0 || end < 0) throw new Error('Feed projection boundary missing');

type RenderedReview = FeedReview & { cardPhotos: { url: string; type: string }[] };
interface Frame {
    feedPages?: { pages: { reviews: FeedReview[] }[] };
    showMyReviewsOnly?: boolean;
    user?: { id: string };
    debouncedQuery?: string;
}

// Exercise the component's actual projection with React's own memo lifecycle,
// without loading its network, modal or browser dependencies.
const project = new Function('useMemo', 'feedPages', 'showMyReviewsOnly', 'user', 'debouncedQuery',
    `${source.slice(start, end)}\nreturn allReviews;`,
) as (memo: typeof useMemo, pages: Frame['feedPages'], mine: boolean, user: Frame['user'], query: string) => RenderedReview[];

function renderFrames(frames: Frame[]): RenderedReview[][] {
    const results: RenderedReview[][] = [];
    function Harness() {
        const [index, setIndex] = useState(0);
        const frame = frames[index];
        results.push(project(useMemo, frame.feedPages, frame.showMyReviewsOnly ?? false, frame.user, frame.debouncedQuery ?? ''));
        if (index + 1 < frames.length) setIndex(index + 1);
        return null;
    }
    renderToString(createElement(Harness));
    return results;
}

function review(id: string, overrides: Partial<FeedReview> = {}): FeedReview {
    return {
        id, userId: 'user-a', restaurantId: 'restaurant-a', restaurantName: '맛집',
        userName: 'Reviewer', visitedAt: '2026-09-20', createdAt: '2026-09-20T01:00:00Z',
        content: 'Tasty food', photos: ['first.jpg', 'second.jpg'], categories: ['한식'],
        likeCount: 2, isLikedByUser: false, restaurant: null, ...overrides,
    };
}

describe('feed render data', () => {
    test('preserves page order, duplicate rows, photo order and every review field without mutating cached data', () => {
        const first = review('first');
        const second = review('second', { photos: [] });
        Object.freeze(first.photos);
        Object.freeze(first);
        const feedPages = { pages: [{ reviews: [first, second] }, { reviews: [first] }] };
        const [rows] = renderFrames([{ feedPages }]);

        expect(rows.map(row => row.id)).toEqual(['first', 'second', 'first']);
        expect(rows[0]).toEqual({ ...first, cardPhotos: [{ url: 'first.jpg', type: 'image' }, { url: 'second.jpg', type: 'image' }] });
        expect(rows[1].cardPhotos).toEqual([]);
        expect(first).not.toHaveProperty('cardPhotos');
        expect(rows[0].photos).toBe(first.photos);
    });

    test('reuses photo arrays across rerenders, query-result wrapper changes and filter changes', () => {
        const feedPages = { pages: [{ reviews: [review('first'), review('second', { userId: 'user-b' })] }] };
        const frames = renderFrames([
            { feedPages },
            { feedPages: { pages: feedPages.pages } },
            { feedPages, debouncedQuery: '  TASTY  ' },
            { feedPages, user: { id: 'user-a' }, showMyReviewsOnly: true },
            { feedPages },
        ]);

        expect(frames[1]).toBe(frames[0]);
        expect(frames[2].map(row => row.id)).toEqual(['first', 'second']);
        expect(frames[3].map(row => row.id)).toEqual(['first']);
        expect(frames[4].map(row => row.id)).toEqual(['first', 'second']);
        for (const rows of frames) expect(rows[0].cardPhotos).toBe(frames[0][0].cardPhotos);
        expect(source).toContain('photos: review.cardPhotos,');
    });

    test('applies mine and search filters together while anonymous mine-only stays unchanged', () => {
        const feedPages = { pages: [{ reviews: [
            review('restaurant', { restaurantName: 'SEOUL', userName: 'A', content: '' }),
            review('author', { userId: 'user-b', userName: 'Seoul', content: '' }),
            review('content', { userName: 'C', content: 'seoul noodles' }),
        ] }] };
        const rows = renderFrames([
            { feedPages, debouncedQuery: ' seoul ' },
            { feedPages, debouncedQuery: ' seoul ', showMyReviewsOnly: true, user: { id: 'user-a' } },
            { feedPages, debouncedQuery: ' seoul ', showMyReviewsOnly: true },
            { feedPages, debouncedQuery: 'no match' },
            { feedPages, debouncedQuery: '   ' },
        ]);

        expect(rows.map(result => result.map(row => row.id))).toEqual([
            ['restaurant', 'author', 'content'], ['restaurant', 'content'],
            ['restaurant', 'author', 'content'], [], ['restaurant', 'author', 'content'],
        ]);
    });

    test('updates photos and review values when pages change instead of returning stale cached projections', () => {
        const first = review('first');
        const updated = review('first', { photos: ['replacement.jpg'], content: 'Updated', likeCount: 3, isLikedByUser: true });
        const rows = renderFrames([
            { feedPages: { pages: [{ reviews: [first] }] } },
            { feedPages: { pages: [{ reviews: [updated] }, { reviews: [review('next')] }] } },
        ]);

        expect(rows[1].map(row => row.id)).toEqual(['first', 'next']);
        expect(rows[1][0]).toEqual({ ...updated, cardPhotos: [{ url: 'replacement.jpg', type: 'image' }] });
        expect(rows[1][0].cardPhotos).not.toBe(rows[0][0].cardPhotos);
    });

    test('keeps unavailable, confirmed empty and empty filtered data safe', () => {
        const rows = renderFrames([
            {}, { feedPages: { pages: [] } }, { feedPages: { pages: [{ reviews: [] }] } },
            { feedPages: { pages: [{ reviews: [review('first')] }] }, showMyReviewsOnly: true, user: { id: 'other' } },
        ]);
        expect(rows).toEqual([[], [], [], []]);
    });
});
