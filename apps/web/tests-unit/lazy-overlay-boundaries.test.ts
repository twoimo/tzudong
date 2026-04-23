import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const overlayPagePanelSource = () =>
    readFileSync(join(import.meta.dir, '..', 'components/layout/OverlayPagePanel.tsx'), 'utf8');

describe('lazy overlay boundaries', () => {
    test('loads named overlay target modules used by dynamic boundaries', async () => {
        const [{ ReviewModal }, { RestaurantDetailPanel }, { UserProfilePanel }, { EditRestaurantModal }] = await Promise.all([
            import('../components/reviews/ReviewModal'),
            import('../components/restaurant/RestaurantDetailPanel'),
            import('../components/profile/UserProfilePanel'),
            import('../components/modals/EditRestaurantModal'),
        ]);

        expect(typeof ReviewModal).toBe('function');
        expect(typeof RestaurantDetailPanel).toBe('function');
        expect(typeof UserProfilePanel).toBe('object');
        expect(typeof EditRestaurantModal).toBe('object');
    });

    test('keeps overlay-only modules behind top-level next dynamic boundaries', () => {
        const source = overlayPagePanelSource();
        const forbiddenStaticImports = [
            "import { ReviewModal } from '@/components/reviews/ReviewModal'",
            "import FeedContent from '@/components/overlay-pages/FeedOverlay'",
            "import StampContent from '@/components/overlay-pages/StampOverlay'",
            "import LeaderboardContent from '@/components/overlay-pages/LeaderboardOverlay'",
            "import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel'",
            "import { UserProfilePanel } from '@/components/profile/UserProfilePanel'",
            "import { EditRestaurantModal } from '@/components/modals/EditRestaurantModal'",
        ];

        for (const staticImport of forbiddenStaticImports) {
            expect(source).not.toContain(staticImport);
        }

        expect(source).toContain("import dynamic from 'next/dynamic'");
        expect(source).toContain("const FeedContent = dynamic(() => import('@/components/overlay-pages/FeedOverlay')");
        expect(source).toContain("const StampContent = dynamic(() => import('@/components/overlay-pages/StampOverlay')");
        expect(source).toContain("const LeaderboardContent = dynamic(() => import('@/components/overlay-pages/LeaderboardOverlay')");
        expect(source).toContain("default: mod.ReviewModal");
        expect(source).toContain("default: mod.RestaurantDetailPanel");
        expect(source).toContain("default: mod.UserProfilePanel");
        expect(source).toContain("default: mod.EditRestaurantModal");
    });
});
