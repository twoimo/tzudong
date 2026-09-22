import { describe, expect, test } from 'bun:test';
import { selectVisibleMarkerReviewBubbleTargets } from '../lib/visible-marker-review-bubbles';

function referenceHash(input: string): number {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function referenceRelatedIds(restaurant: { id?: string; mergedRestaurants?: Array<{ id?: string }> }) {
    const ids = new Set<string>();
    if (restaurant.id) ids.add(restaurant.id);
    restaurant.mergedRestaurants?.forEach((merged) => {
        if (merged.id) ids.add(merged.id);
    });
    return [...ids];
}

function referenceSelect(
    restaurants: Array<{ id?: string; review_count?: number; mergedRestaurants?: Array<{ id?: string }> }>,
    options: { limit: number; seed: string },
) {
    const candidates = restaurants.filter((restaurant) => Boolean(restaurant?.id));
    const reviewed = candidates.filter((restaurant) => (restaurant.review_count ?? 0) > 0);
    const source = reviewed.length > 0 ? reviewed : candidates;
    const limit = options.limit === Number.POSITIVE_INFINITY ? source.length : Math.trunc(options.limit);
    return source
        .map((restaurant, index) => ({ restaurant, index, rank: referenceHash(`${options.seed}:${restaurant.id}`) }))
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .slice(0, limit)
        .map(({ restaurant }) => ({
            restaurantId: restaurant.id,
            relatedRestaurantIds: referenceRelatedIds(restaurant),
        }));
}

describe('visible marker review bubble selection', () => {
    test('matches a full stable sort for reviewed restaurants and keeps merged ids', () => {
        const restaurants = Array.from({ length: 40 }, (_, index) => ({
            id: `restaurant-${index}`,
            review_count: index % 4 === 0 ? 0 : 1,
            mergedRestaurants: index % 7 === 0 ? [{ id: `merged-${index}` }, { id: '' }] : undefined,
        }));
        const options = { limit: 5, seed: 'zoom:15:bounds' };

        expect(selectVisibleMarkerReviewBubbleTargets(restaurants as never, options)).toEqual(
            referenceSelect(restaurants, options),
        );
    });

    test('uses every identified restaurant when none has a review count', () => {
        const restaurants = [
            { id: 'a', review_count: 0 },
            { id: 'b', review_count: 0 },
            { id: 'c' },
        ];

        expect(selectVisibleMarkerReviewBubbleTargets(restaurants as never, { limit: 10, seed: 'empty-reviews' }))
            .toEqual(referenceSelect(restaurants, { limit: 10, seed: 'empty-reviews' }));
    });

    test('returns an empty list for an empty candidate list, a non-positive limit, or rows without ids', () => {
        expect(selectVisibleMarkerReviewBubbleTargets([], { limit: 3, seed: 'empty' })).toEqual([]);
        expect(selectVisibleMarkerReviewBubbleTargets([{ id: 'a', review_count: 2 }] as never, { limit: 0, seed: 'zero' })).toEqual([]);
        expect(selectVisibleMarkerReviewBubbleTargets([{ id: 'a', review_count: 2 }] as never, { limit: -2, seed: 'negative' })).toEqual([]);
        expect(selectVisibleMarkerReviewBubbleTargets([{ review_count: 4 }] as never, { limit: 3, seed: 'no-id' })).toEqual([]);
    });

    test('rejects a missing list or options without throwing', () => {
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (message?: unknown) => {
            warnings.push(String(message));
        };

        try {
            expect(selectVisibleMarkerReviewBubbleTargets(null as never, { limit: 3, seed: 'x' })).toEqual([]);
            expect(selectVisibleMarkerReviewBubbleTargets([{ id: 'a' }] as never, null as never)).toEqual([]);
            expect(selectVisibleMarkerReviewBubbleTargets([{ id: 'a', review_count: 1 }] as never, { limit: Number.NaN, seed: 'nan' })).toEqual([]);
        } finally {
            console.warn = originalWarn;
        }

        expect(warnings).toEqual([
            '[visible-marker-review-bubbles] candidate selection rejected (invalid-input)',
            '[visible-marker-review-bubbles] candidate selection rejected (invalid-input)',
        ]);
    });

    test('truncates a fractional limit the same way a stable slice does', () => {
        const restaurants = [
            { id: 'a', review_count: 1 },
            { id: 'b', review_count: 1 },
            { id: 'c', review_count: 1 },
            { id: 'd', review_count: 1 },
        ];

        expect(selectVisibleMarkerReviewBubbleTargets(restaurants as never, { limit: 2.9, seed: 'fraction' }))
            .toEqual(referenceSelect(restaurants, { limit: 2.9 }));
    });
});
