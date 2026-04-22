import { describe, expect, test } from 'bun:test';

describe('lazy map panel boundaries', () => {
    test('loads the restaurant detail panel module used by on-demand map detail panels', async () => {
        const mod = await import('../components/restaurant/RestaurantDetailPanel');

        expect(typeof mod.RestaurantDetailPanel).toBe('function');
    });

    test('loads the review modal module used by the on-demand Naver map review modal', async () => {
        const mod = await import('../components/reviews/ReviewModal');

        expect(typeof mod.ReviewModal).toBe('function');
    });
});
