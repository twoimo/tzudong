import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    buildCanonicalAdminEvaluationsHref,
    buildCanonicalAdminHrefFromSearchParams,
} from '../lib/admin/admin-module-routing';
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
        const adminLoadingSource = source('app/admin/loading.tsx');
        const adminBannersSource = source('app/admin/banners/page.tsx');
        const headerSource = source('components/layout/Header.tsx');
        const mobileControlOverlaySource = source('components/home/MobileControlOverlay.tsx');
        const homeEffectsSource = source('app/home-client-effects.tsx');

        expect(adminSubmissionsSource).toContain("redirect('/admin?module=submissions')");
        expect(adminSubmissionsSource).not.toContain('"use client"');
        expect(adminSubmissionsSource).not.toContain('useInfiniteQuery');
        expect(adminEvaluationsSource).toContain('buildCanonicalAdminEvaluationsHref');
        expect(adminEvaluationsSource).toContain("const routeView = embedded ? null : searchParams.get('view');");
        expect(adminEvaluationsSource).toContain("routeView === 'submissions'");
        expect(adminEvaluationsSource).toContain("const currentHref = `/admin/evaluations");
        expect(adminEvaluationsSource).toContain('router.replace(canonicalAdminHref, { scroll: false });');
        expect(adminEvaluationsSource).toContain("router.replace(buildCanonicalAdminEvaluationsHref({");
        expect(adminEvaluationsSource).toContain("@/components/admin/EvaluationTableNew");
        expect(adminEvaluationsSource).toContain('fallback={embedded ? null : <AdminEvaluationRouteSkeleton />}');
        expect(adminEvaluationsSource).toContain('return <AdminEvaluationRouteSkeleton />;');
        expect(adminEvaluationsSource).toContain('switchToEvaluationListView');
        expect(adminEvaluationsSource).toContain('switchToEvaluationSlideView');
        expect(adminEvaluationsSource).not.toContain('YouTube 자막 수집 실행');
        expect(adminEvaluationsSource).not.toContain('handleCollectTranscripts');
        expect(adminEvaluationsSource).not.toContain('EmbeddedEvaluationLoading');
        expect(adminEvaluationsSource).not.toContain('<GlobalLoader');
        expect(adminEvaluationsSource).not.toContain('제보 큐를 여는 중');
        expect(adminEvaluationsSource).not.toContain('리뷰 검수 큐를 여는 중');
        expect(adminEvaluationsSource).not.toContain('맛집 검수 화면을 여는 중');
        expect(adminEvaluationsSource).not.toContain('authLoading || (loading && allRecords.length === 0)');
        expect(adminEvaluationsSource).not.toContain('loading && allRecords.length === 0)) {');
        expect(adminLoadingSource).toContain('return null;');
        expect(adminLoadingSource).toContain('모듈별 스켈레톤만 한 번');
        expect(adminLoadingSource).not.toContain('AdminConsoleLoadingSkeleton');
        expect(adminLoadingSource).not.toContain('GlobalLoader');
        expect(adminBannersSource).toContain('<Suspense fallback={null}>');
        expect(adminBannersSource).toContain('if (!embedded && authLoading) {');
        expect(adminBannersSource).toContain('return null;');
        expect(adminBannersSource).not.toContain('EmbeddedBannerLoading');
        expect(adminBannersSource).not.toContain('배너 관리 준비 중');
        expect(adminBannersSource).not.toContain('GlobalLoader');
        expect(headerSource).toContain("관리자 콘솔");
        expect(headerSource).toContain("router.push('/admin')");
        expect(headerSource).toContain('data-admin-console-menu-item="true"');
        expect(headerSource).not.toContain("router.push('/admin?module=announcements')");
        expect(headerSource).not.toContain("/admin/evaluations?view=submissions");
        expect(headerSource).not.toContain("/admin/evaluations?view=submissions&tab=reviews");
        expect(mobileControlOverlaySource).toContain("관리자 콘솔");
        expect(mobileControlOverlaySource).toContain("router.push('/admin')");
        expect(mobileControlOverlaySource).toContain('data-admin-console-menu-item="true"');
        expect(mobileControlOverlaySource).not.toContain('맛집관리');
        expect(mobileControlOverlaySource).not.toContain('제보관리');
        expect(mobileControlOverlaySource).not.toContain('리뷰관리');
        expect(mobileControlOverlaySource).not.toContain('배너관리');
        expect(mobileControlOverlaySource).not.toContain("router.push('/admin/banners')");
        expect(mobileControlOverlaySource).not.toContain("openAdminSubmissions");
        expect(mobileControlOverlaySource).not.toContain("openAdminReviews");
        expect(homeEffectsSource).toContain("/admin?module=submissions");
        expect(homeEffectsSource).toContain("router.push('/mypage/profile')");
        expect(homeEffectsSource).not.toContain("router.push('/mypage')");
    });

    test('prefetches canonical admin routes instead of retired submissions route', () => {
        const adminRoutes = getNavigationPrefetchRoutes({ isLoggedIn: true, isAdmin: true });
        const userRoutes = getNavigationPrefetchRoutes({ isLoggedIn: true, isAdmin: false });

        expect(adminRoutes).toContain('/admin');
        expect(adminRoutes).toContain('/admin?module=restaurants');
        expect(adminRoutes).toContain('/admin?module=submissions');
        expect(adminRoutes).toContain('/admin?module=reviews');
        expect(adminRoutes).toContain('/admin?module=banners');
        expect(adminRoutes).toContain('/admin?module=insights');
        expect(adminRoutes).not.toContain('/admin/banners');
        expect(adminRoutes).not.toContain(RETIRED_ADMIN_COSTS_ROUTE);
        const retiredAiSettingsRoute = `/admin/${'ai-settings'}`;
        expect(adminRoutes).not.toContain(retiredAiSettingsRoute);
        expect(adminRoutes).not.toContain('/admin/submissions');
        expect(adminRoutes).not.toContain('/admin/evaluations');
        expect(userRoutes).not.toContain('/admin');
        expect(userRoutes).not.toContain('/admin?module=restaurants');
        expect(userRoutes).not.toContain('/admin?module=submissions');
        expect(userRoutes).not.toContain('/admin?module=reviews');
        expect(userRoutes).not.toContain('/admin?module=banners');
        expect(userRoutes).not.toContain('/admin?module=insights');
        expect(userRoutes).not.toContain('/admin/banners');
        expect(userRoutes).not.toContain('/admin/submissions');
        expect(userRoutes).not.toContain(retiredAiSettingsRoute);
    });

    test('normalizes legacy and mixed admin query states without loops', () => {
        expect(buildCanonicalAdminEvaluationsHref(new URLSearchParams())).toBe('/admin?module=restaurants');
        expect(buildCanonicalAdminEvaluationsHref(new URLSearchParams('view=submissions'))).toBe('/admin?module=submissions');
        expect(buildCanonicalAdminEvaluationsHref(new URLSearchParams('view=submissions&tab=reviews'))).toBe('/admin?module=reviews');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=restaurants'))).toBe('/admin?module=restaurants');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=submissions'))).toBe('/admin?module=submissions');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=reviews'))).toBe('/admin?module=reviews');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=unknown'))).toBe('/admin');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=reviews&view=submissions&tab=reviews'))).toBe('/admin?module=reviews');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=unknown&view=submissions'))).toBe('/admin?module=submissions');
        expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('view=legacy&tab=reviews'))).toBe('/admin');
    });

    test('keeps the unified admin console as the canonical embedded module hub', () => {
        const adminPageSource = source('app/admin/page.tsx');
        const adminConsoleSource = source('components/admin/AdminConsoleOverview.tsx');
        const insightsClientSource = source('app/insights/insights-client.tsx');

        expect(adminPageSource).toContain('<AdminConsoleOverview initialStoryboardResult={initialStoryboardResult} />');
        expect(adminConsoleSource).toContain('getAdminModuleIdFromSearchParams(searchParams)');
        expect(adminConsoleSource).toContain('buildCanonicalAdminModuleHref');
        expect(adminConsoleSource).toContain('buildCanonicalAdminHrefFromSearchParams(searchParams)');
        expect(adminConsoleSource).toContain('const nextHref = buildCanonicalAdminModuleHref(moduleId);');
        expect(adminConsoleSource).toContain('router.replace(nextHref, {');
        expect(adminConsoleSource).toContain('currentHref !== canonicalHref');
        expect(adminConsoleSource).toContain('router.replace(canonicalHref, { scroll: false });');
        expect(adminConsoleSource).toContain('router.replace');
        expect(adminConsoleSource).toContain('window.history.replaceState(window.history.state, "", nextHref)');
        expect(adminConsoleSource).not.toContain('검수 큐 작업 화면 연결 중');
        expect(adminConsoleSource).toContain('<AdminEvaluationModule');
        expect(adminConsoleSource).toContain('key="restaurants"');
        expect(adminConsoleSource).toContain('initialView="evaluations"');
        expect(adminConsoleSource).toContain('<AdminEvaluationModule');
        expect(adminConsoleSource).toContain('key="submissions"');
        expect(adminConsoleSource).toContain('initialView="submissions"');
        expect(adminConsoleSource).toContain('initialSubmissionTab="new"');
        expect(adminConsoleSource).toContain('<AdminEvaluationModule');
        expect(adminConsoleSource).toContain('key="reviews"');
        expect(adminConsoleSource).toContain('initialSubmissionTab="reviews"');
        expect(adminConsoleSource).not.toContain('AdminConsoleLoadingSkeleton');
        expect(adminConsoleSource).toContain('function AdminConsoleCanvasSkeleton({');
        expect(adminConsoleSource).toContain('data-admin-console-content-loading="true"');
        expect(adminConsoleSource).toContain(
            '{isAdminCanvasBootstrapping ? (',
        );
        expect(adminConsoleSource).not.toContain(
            '{isShellBootstrapping ? (',
        );
        expect(adminConsoleSource).toContain('return null;');
        expect(adminConsoleSource).not.toContain('<GlobalLoader');
        expect(adminConsoleSource).toContain('<AdminBannerModule key="admin-banners" embedded />');
        expect(adminConsoleSource).not.toContain('AdminAnnouncementModule');
        expect(adminConsoleSource).not.toContain('adminActionsMode="inline"');
        expect(adminConsoleSource).not.toContain('id: "announcements"');
        expect(adminConsoleSource).not.toContain('/admin?module=announcements');
        expect(adminConsoleSource).toContain('<InsightsModule key="admin-insights" embedded />');
        expect(adminConsoleSource).toContain("buildCanonicalAdminModuleHref");
        expect(adminConsoleSource).not.toContain('href: "/admin/banners"');
        expect(adminConsoleSource).not.toContain('href: "/insights"');
        expect(insightsClientSource).toContain('export default function InsightsClient({ embedded = false }: { embedded?: boolean } = {})');
        expect(insightsClientSource).toContain('if (!embedded && !isAuthLoading && !user) {');
        expect(insightsClientSource).toContain('enabled: embedded || (!isAuthLoading && !!user),');
        expect(insightsClientSource).toContain('{!embedded ? (');
        expect(adminConsoleSource).toContain('shouldRenderAdminShell');
        expect(adminConsoleSource).not.toContain('router.replace("/")');
        expect(adminConsoleSource).not.toContain('if (!user || !isAdmin)');
        expect(adminConsoleSource).not.toContain('router.push("/admin/evaluations")');
        expect(adminConsoleSource).not.toContain('router.push("/admin/banners")');
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
