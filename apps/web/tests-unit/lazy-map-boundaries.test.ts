import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const naverMapSidepanelsSource = () =>
    readFileSync(join(import.meta.dir, '..', 'components/map/naver-map-sidepanels.tsx'), 'utf8');

const deferredPanelsSource = () =>
    readFileSync(join(import.meta.dir, '..', 'components/map/map-view-deferred-panels.tsx'), 'utf8');

describe('lazy map panel boundaries', () => {
    test('keeps the restaurant detail panel behind the on-demand Naver map loader', () => {
        const source = naverMapSidepanelsSource();

        // The lazy import must go through the deferred-panel barrel so the panel's
        // dedicated Tailwind entry (app/home-detail-globals.css) travels with the
        // chunk. Importing the panel module directly drops that stylesheet on the
        // home route.
        expect(source).toContain("const mod = await import('@/components/map/map-view-deferred-panels')");
        expect(source).toContain('return mod.RestaurantDetailPanel as ComponentType<RestaurantDetailPanelProps>;');
        expect(source).not.toContain("import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel'");
        expect(source).not.toContain("import { ReviewModal } from '@/components/reviews/ReviewModal'");
    });

    test('defers the panel stylesheet together with the barrel it re-exports', () => {
        const barrel = deferredPanelsSource();

        expect(barrel).toContain("import '@/app/home-detail-globals.css';");
        expect(barrel).toContain("import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';");
        expect(barrel).toContain("import { ReviewModal } from '@/components/reviews/ReviewModal';");
        expect(barrel).toContain('export { RestaurantDetailPanel, ReviewModal };');
    });

    test('loads the review modal module used by the on-demand Naver map review modal', async () => {
        const mod = await import('../components/reviews/ReviewModal');

        expect(typeof mod.ReviewModal).toBe('function');
    });
});
