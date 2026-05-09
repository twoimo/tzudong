import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getNavigationPrefetchRoutes } from '../components/layout/navigation-routes';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const exists = (relativePath: string) => existsSync(join(import.meta.dir, '..', relativePath));
const RETIRED_COSTS_ROUTE = '/' + 'costs';
const RETIRED_ADMIN_COSTS_ROUTE = '/admin/' + 'costs';

describe('frontend unused route compatibility', () => {
    test('keeps public submissions as a compatibility redirect and removes costs pages', () => {
        const nextConfigSource = source('next.config.mjs');
        const submissionsPageSource = source('app/submissions/page.tsx');

        expect(nextConfigSource).toContain("source: '/submissions'");
        expect(nextConfigSource).toContain("destination: '/mypage'");
        expect(nextConfigSource).not.toContain(`source: '${RETIRED_COSTS_ROUTE}'`);
        expect(nextConfigSource).not.toContain(`destination: '${RETIRED_ADMIN_COSTS_ROUTE}'`);
        expect(submissionsPageSource).toContain("redirect('/mypage')");
        expect(exists(join('app', 'costs', 'page.tsx'))).toBe(false);
        expect(exists(join('app', 'admin', 'costs', 'page.tsx'))).toBe(false);
    });

    test('moves admin submissions to the canonical evaluations view', () => {
        const adminSubmissionsSource = source('app/admin/submissions/page.tsx');
        const adminEvaluationsSource = source('app/admin/evaluations/page.tsx');
        const headerSource = source('components/layout/Header.tsx');
        const homeEffectsSource = source('app/home-client-effects.tsx');

        expect(adminSubmissionsSource).toContain("redirect('/admin/evaluations?view=submissions')");
        expect(adminSubmissionsSource).not.toContain('"use client"');
        expect(adminSubmissionsSource).not.toContain('useInfiniteQuery');
        expect(adminEvaluationsSource).toContain("searchParams.get('view') === 'submissions'");
        expect(adminEvaluationsSource).toContain("@/components/admin/EvaluationTableNew");
        expect(headerSource).toContain("/admin/evaluations?view=submissions");
        expect(headerSource).toContain("/admin/evaluations?view=submissions&tab=reviews");
        expect(homeEffectsSource).toContain("/admin/evaluations?view=submissions");
    });

    test('prefetches canonical admin routes instead of retired submissions route', () => {
        const adminRoutes = getNavigationPrefetchRoutes({ isLoggedIn: true, isAdmin: true });
        const userRoutes = getNavigationPrefetchRoutes({ isLoggedIn: true, isAdmin: false });

        expect(adminRoutes).toContain('/admin/evaluations');
        expect(adminRoutes).not.toContain(RETIRED_ADMIN_COSTS_ROUTE);
        const retiredAiSettingsRoute = `/admin/${'ai-settings'}`;
        expect(adminRoutes).not.toContain(retiredAiSettingsRoute);
        expect(adminRoutes).not.toContain('/admin/submissions');
        expect(userRoutes).not.toContain('/admin/evaluations');
        expect(userRoutes).not.toContain('/admin/submissions');
        expect(userRoutes).not.toContain(retiredAiSettingsRoute);
    });

    test('removes admin insight fallback while preserving public insights and global map', () => {
        const insightsClientSource = source('app/insights/insights-client.tsx');
        const recommendationPopupSource = source('components/recommendation/DailyRecommendationPopup.tsx');

        expect(exists(join('app', 'admin', 'insight', 'page.tsx'))).toBe(false);
        expect(exists(join('app', 'admin', 'insight', 'insight-client.tsx'))).toBe(false);
        expect(exists('app/global-map/page.tsx')).toBe(true);
        expect(insightsClientSource).not.toContain(`@/app/admin/${'insight'}/insight-client`);
        expect(recommendationPopupSource).toContain("'/global-map'");
    });

    test('removes only zero-reference stale primitives and helpers', () => {
        expect(exists('components/ui/drawer.tsx')).toBe(false);
        expect(exists('components/ui/breadcrumb.tsx')).toBe(false);
        expect(exists('components/ui/pagination.tsx')).toBe(false);
        expect(exists('components/ui/toaster.tsx')).toBe(false);
        expect(exists('lib/insight/keyword-label.ts')).toBe(false);
        expect(exists('lib/insight')).toBe(false);
        expect(exists('components/ui/scrollable-tag-container.tsx')).toBe(true);
        expect(exists('lib/ocr/dataset-allowlist.ts')).toBe(true);
    });
});
