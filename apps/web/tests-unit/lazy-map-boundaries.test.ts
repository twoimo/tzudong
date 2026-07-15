import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const naverMapSidepanelsSource = () =>
    readFileSync(join(import.meta.dir, '..', 'components/map/naver-map-sidepanels.tsx'), 'utf8');

describe('lazy map panel boundaries', () => {
    test('keeps the restaurant detail panel behind the on-demand Naver map loader', () => {
        const source = naverMapSidepanelsSource();

        expect(source).toContain("const mod = await import('@/components/restaurant/RestaurantDetailPanel')");
        expect(source).toContain('return mod.RestaurantDetailPanel as ComponentType<RestaurantDetailPanelProps>;');
        expect(source).not.toContain("import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel'");
    });

    test('loads the review modal module used by the on-demand Naver map review modal', async () => {
        const mod = await import('../components/reviews/ReviewModal');

        expect(typeof mod.ReviewModal).toBe('function');
    });
});
