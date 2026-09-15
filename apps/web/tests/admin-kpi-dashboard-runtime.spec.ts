import { expect, test, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    E2E_ADMIN_ROUTE_BYPASS_HEADER,
    E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup } from './helpers';

const ADMIN_DASHBOARD_WIDGET_IDS = [
    'subscribers',
    'views',
    'likes',
    'comments',
    'videos',
    'impact',
    'trend',
    'ops',
    'topContent',
    'engagementRate',
];
// Whole-page replacements and invented chart shapes are forbidden. Necessary
// skeletons inside real value/data slots remain part of the loading contract.
const LEGACY_DASHBOARD_TEMPLATE_SELECTOR = [
    '[data-admin-dashboard-management-skeleton]',
    ...['chart', 'bubble', 'line', 'stacked', 'diagnosis', 'table'].map(
        (variant) => `[data-admin-dashboard-dynamic-skeleton="${variant}"]`,
    ),
].join(', ');
const DASHBOARD_TITLE_SELECTOR = '[data-admin-dashboard-kpi-title-row], [data-admin-dashboard-card-title-row]';

async function expectActualDashboardFrame(page: Page) {
    const dashboard = page.locator('[data-admin-dashboard-management="true"]');
    await expect(dashboard).toBeVisible();
    for (const widgetId of ADMIN_DASHBOARD_WIDGET_IDS) {
        const card = dashboard.locator(`[data-admin-dashboard-widget-card="${widgetId}"]`);
        await expect(card).toBeVisible();
        const title = card.locator(DASHBOARD_TITLE_SELECTOR).first().locator('p').first();
        await expect(title).toBeVisible();
        await expect(title).toContainText(/\S/);
    }
    await expect(page.getByRole('button', { name: '전체', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '3개월', exact: true })).toBeEnabled();
    await expect(dashboard.locator('[data-admin-dashboard-widget-card="impact"] [data-admin-dashboard-card-view-toggle="true"]')).toBeVisible();
    await expect(page.locator(LEGACY_DASHBOARD_TEMPLATE_SELECTOR)).toHaveCount(0);
}

async function expectLocalizedDashboardSkeletons(page: Page) {
    const dashboard = page.locator('[data-admin-dashboard-management="true"]');
    const pending = dashboard.locator('[data-admin-dashboard-data-pending]').first();
    await expect(pending).toBeVisible();
    await expect(pending).toHaveAttribute('aria-busy', 'true');
    const status = pending.getByRole('status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(status.locator('[aria-hidden="true"] [data-slot="skeleton"]').first()).toBeVisible();
    for (const widgetId of ['subscribers', 'views', 'likes', 'comments', 'videos']) {
        const value = dashboard.locator(`[data-admin-dashboard-widget-card="${widgetId}"] p[data-admin-dashboard-kpi-value-size="bounded"]`);
        await expect(value).toBeVisible();
        await expect(value.locator('span[data-slot="skeleton"]')).toBeVisible();
        await expect(value).toContainText('값 확인 중');
    }
    // Headers and actions remain usable; only unresolved data receives shapes.
    await expect(dashboard.locator(DASHBOARD_TITLE_SELECTOR).locator('[data-slot="skeleton"]')).toHaveCount(0);
}

const RUNTIME_GUARD_LOCK_DIR = resolve(
    process.cwd(),
    'test-results',
    '.admin-kpi-dashboard-runtime.lock',
);
const RUNTIME_GUARD_LOCK_STALE_MS = 120_000;
const RUNTIME_GUARD_LOCK_TIMEOUT_MS = 90_000;
const RUNTIME_GUARD_LOCK_POLL_MS = 100;

function sleep(ms: number) {
    return new Promise((resolveSleep) => {
        setTimeout(resolveSleep, ms);
    });
}

function readRuntimeGuardLockCreatedAt() {
    try {
        const lockInfo = JSON.parse(
            readFileSync(resolve(RUNTIME_GUARD_LOCK_DIR, 'owner.json'), 'utf8'),
        ) as { createdAt?: number };

        return typeof lockInfo.createdAt === 'number' ? lockInfo.createdAt : 0;
    } catch {
        return 0;
    }
}

async function acquireRuntimeGuardLock(testInfo: TestInfo) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < RUNTIME_GUARD_LOCK_TIMEOUT_MS) {
        try {
            mkdirSync(resolve(process.cwd(), 'test-results'), { recursive: true });
            mkdirSync(RUNTIME_GUARD_LOCK_DIR);
            writeFileSync(
                resolve(RUNTIME_GUARD_LOCK_DIR, 'owner.json'),
                JSON.stringify({
                    createdAt: Date.now(),
                    title: testInfo.title,
                    project: testInfo.project.name,
                    workerIndex: testInfo.workerIndex,
                }),
            );
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }

            const createdAt = readRuntimeGuardLockCreatedAt();
            if (!createdAt || Date.now() - createdAt > RUNTIME_GUARD_LOCK_STALE_MS) {
                rmSync(RUNTIME_GUARD_LOCK_DIR, { recursive: true, force: true });
                continue;
            }

            await sleep(RUNTIME_GUARD_LOCK_POLL_MS);
        }
    }

    throw new Error('Timed out waiting for the admin KPI dashboard runtime guard lock.');
}

function releaseRuntimeGuardLock() {
    rmSync(RUNTIME_GUARD_LOCK_DIR, { recursive: true, force: true });
}

const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = 'tzudong:e2e-admin-shell-bypass';

type KpiApiVideo = {
    id?: unknown;
    title?: unknown;
};

type KpiApiPayload = {
    totalVideos?: unknown;
    videos?: KpiApiVideo[];
    meta?: {
        dataSource?: unknown;
        fallbackSource?: unknown;
        fallbackReasonCode?: unknown;
    };
};

async function installE2EAdminShellBypass(page: Page) {
    await page.addInitScript((storageKey) => {
        window.localStorage.setItem(storageKey, '1');
    }, E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY);
}
function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
    const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
    if (typeof token !== 'string' || !token.trim()) {
        throw new Error('playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.');
    }

    return token;
}

function getOperationalVideoTitle(payload: KpiApiPayload) {
    const videos = Array.isArray(payload.videos) ? payload.videos : [];
    const title = videos.find((video) => typeof video.title === 'string' && video.title.trim())
        ?.title;

    return typeof title === 'string' ? title.trim() : '';
}

function expectOperationalKpiPayload(payload: KpiApiPayload) {
    expect(Array.isArray(payload.videos)).toBe(true);
    const videos = payload.videos ?? [];
    expect(videos.length).toBeGreaterThan(0);
    expect(payload.totalVideos).toBe(videos.length);
    expect(String(payload.meta?.dataSource ?? '')).not.toMatch(/mock/i);
    expect(String(payload.meta?.fallbackSource ?? '')).not.toMatch(/mock/i);
    expect(String(payload.meta?.fallbackReasonCode ?? '')).not.toMatch(/mock/i);

    for (const video of videos) {
        expect(String(video.id ?? '')).not.toMatch(/^kpi-runtime-/i);
        expect(String(video.title ?? '')).not.toContain('KPI 회귀 테스트 영상');
        expect(String(video.title ?? '')).not.toContain('회귀 테스트 영상');
    }

    return getOperationalVideoTitle(payload);
}
function isInitialKpiResponse(responseUrl: string) {
    const url = new URL(responseUrl);
    return (
        url.pathname === '/api/admin/youtube-kpis' &&
        url.searchParams.get('period') === 'ALL' &&
        url.searchParams.get('scope') === 'channel-growth'
    );
}


function isBenignBrowserInfraConsoleError(message: ConsoleMessage) {
    const text = message.text();
    const locationUrl = message.location().url;

    return (
        text.includes('Cookie “__cf_bm” has been rejected for invalid domain.') &&
        (locationUrl.includes('supabase.co/realtime/v1/websocket') ||
            text.includes('supabase.co/realtime/v1/websocket'))
    );
}

function captureRuntimeErrors(page: Page) {
    const runtimeErrors: string[] = [];

    page.on('pageerror', (error) => {
        runtimeErrors.push(error.stack || error.message);
    });

    page.on('console', (message) => {
        if (message.type() === 'error') {
            if (!isBenignBrowserInfraConsoleError(message)) {
                runtimeErrors.push(message.text());
            }
        }
    });

    return runtimeErrors;
}

async function expectNoRuntimeErrorsAfterHydration(page: Page, runtimeErrors: string[]) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    expect(runtimeErrors).toEqual([]);
}



test.describe('Admin KPI dashboard runtime guard', () => {
    test.describe.configure({ mode: 'serial', timeout: 120000 });

    test.beforeEach(async ({}, testInfo) => {
        // This spec intentionally starts a clean dev server. Browser projects still
        // run in separate Playwright workers, so serialize page entry to avoid
        // Turbopack dev chunk races that can surface as transient RootError pages.
        await acquireRuntimeGuardLock(testInfo);
    });

    test.afterEach(() => {
        releaseRuntimeGuardLock();
    });

    test('관리자 라우트는 비인증 상태에서도 브라우저 런타임 오류를 내지 않는다', async ({ page }) => {
        const runtimeErrors = captureRuntimeErrors(page);

        await gotoAndHidePopup(page, '/admin');
        await expect(page.locator('[data-admin-dashboard-management="true"]')).toHaveCount(0);
        await expectNoRuntimeErrorsAfterHydration(page, runtimeErrors);
    });

    test('관리자 세션 쿠키가 있어도 우회 토큰이 틀리면 대시보드를 렌더링하지 않는다', async ({ page }) => {
        const runtimeErrors = captureRuntimeErrors(page);


        await page.setExtraHTTPHeaders({
            [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
            [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: 'wrong-token',
        });
        await gotoAndHidePopup(page, '/admin');

        await expect(page.locator('[data-admin-dashboard-management="true"]')).toHaveCount(0);
        await expectNoRuntimeErrorsAfterHydration(page, runtimeErrors);
    });

    test('모바일 KPI 대시보드는 스크롤 시 관리자 헤더와 바텀 네비게이션을 함께 숨긴다', async ({ page }, testInfo) => {
        const runtimeErrors = captureRuntimeErrors(page);

        await page.setViewportSize({ width: 390, height: 844 });
        await installE2EAdminShellBypass(page);
        const bypassToken = getE2EAdminRouteBypassToken(testInfo);

        await page.setExtraHTTPHeaders({
            [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
            [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: bypassToken,
        });
        await gotoAndHidePopup(page, '/admin');

        await expect(page.locator('[data-admin-dashboard-management="true"]')).toBeVisible({
            timeout: 20000,
        });
        const layout = page.locator('[data-admin-console-layout="sidebar-content"]');
        const mobileHeader = page.locator('[data-admin-console-mobile-header="true"]');
        const canvas = page.locator('#admin-console-canvas');
        const bottomNav = page.getByTestId('bottom-nav');
        await expect(bottomNav).toBeVisible({ timeout: 20000 });
        await expect(canvas).toBeVisible({ timeout: 20000 });

        const compactCardViewToggle = page.locator('[data-admin-dashboard-card-view-toggle="true"]').first();
        await expect(compactCardViewToggle).toBeVisible({ timeout: 20000 });
        await expect
            .poll(async () => Math.round((await compactCardViewToggle.boundingBox())?.height ?? 0))
            .toBeLessThanOrEqual(32);
        await expect
            .poll(async () =>
                Math.round((await compactCardViewToggle.getByRole('button').first().boundingBox())?.height ?? 0),
            )
            .toBeLessThanOrEqual(30);

        const compactSeriesToggle = page.locator('[data-admin-dashboard-series-toggle="true"]').first();
        await expect(compactSeriesToggle).toBeVisible({ timeout: 20000 });
        await expect
            .poll(async () => Math.round((await compactSeriesToggle.boundingBox())?.height ?? 0))
            .toBeLessThanOrEqual(32);

        const compactKpiTitleActions = page.locator('[data-admin-dashboard-kpi-title-actions="single-line-scroll"]').first();
        await expect(compactKpiTitleActions).toBeVisible({ timeout: 20000 });
        await expect
            .poll(async () => Math.round((await compactKpiTitleActions.boundingBox())?.height ?? 0))
            .toBeLessThanOrEqual(32);

        const compactMetricTooltip = page.locator('[data-admin-dashboard-metric-tooltip="beginner-plain"]').first();
        await expect(compactMetricTooltip).toBeVisible({ timeout: 20000 });
        await expect
            .poll(async () => Math.round((await compactMetricTooltip.boundingBox())?.height ?? 0))
            .toBeLessThanOrEqual(24);
        await expect
            .poll(async () => Math.round((await compactMetricTooltip.boundingBox())?.width ?? 0))
            .toBeLessThanOrEqual(24);

        const lowerMobileCards = [
            page.locator('[data-admin-dashboard-widget-card="ops"]').first(),
            page.locator('[data-admin-dashboard-widget-card="topContent"]').first(),
            page.locator('[data-admin-dashboard-widget-card="engagementRate"]').first(),
        ];
        for (const card of lowerMobileCards) {
            await expect(card).toBeVisible({ timeout: 20000 });
            await expect
                .poll(async () => Math.round((await card.boundingBox())?.height ?? 0))
                .toBeGreaterThanOrEqual(315);
        }

        await expect(mobileHeader).toHaveAttribute('data-admin-console-mobile-header-visible', 'true');
        await expect(layout).toHaveAttribute('data-admin-console-mobile-header-visible', 'true');
        await expect
            .poll(() =>
                page.evaluate(() =>
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--mobile-sheet-hide-bottom-nav')
                        .trim() || '0',
                ),
            )
            .toBe('0');

        await expect
            .poll(() =>
                canvas.evaluate((element) =>
                    Number.parseFloat(getComputedStyle(element).paddingBottom),
                ),
            )
            .toBeGreaterThanOrEqual(60);

        await canvas.evaluate((element) => {
            const spacer = document.createElement('div');
            spacer.setAttribute('data-admin-scroll-spacer', 'runtime-guard');
            spacer.style.height = '900px';
            spacer.style.flex = '0 0 auto';
            element.appendChild(spacer);
        });
        await canvas.evaluate((element) => {
            element.scrollTop = 360;
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
        });

        await expect(layout).toHaveAttribute('data-admin-console-mobile-header-visible', 'false');
        await expect(mobileHeader).toHaveAttribute('data-admin-console-mobile-header-visible', 'false');
        await expect
            .poll(() =>
                page.evaluate(() =>
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--mobile-sheet-hide-bottom-nav')
                        .trim(),
                ),
            )
            .toBe('1');
        await canvas.evaluate((element) => {
            element.scrollTop = 20;
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
            element.scrollTop = 0;
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
        });
        await page.waitForTimeout(300);

        await expect(layout).toHaveAttribute('data-admin-console-mobile-header-visible', 'true');
        await expect(mobileHeader).toHaveAttribute('data-admin-console-mobile-header-visible', 'true');
        await expect
            .poll(() =>
                page.evaluate(() =>
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--mobile-sheet-hide-bottom-nav')
                        .trim(),
                ),
            )
            .toBe('0');

        await expectNoRuntimeErrorsAfterHydration(page, runtimeErrors);
    });

    test('KPI 대시보드는 관리자 세션에서 브라우저 런타임 오류 없이 렌더링된다', async ({ page }, testInfo) => {
        const runtimeErrors = captureRuntimeErrors(page);

        await page.setViewportSize({ width: 1920, height: 1080 });
        await installE2EAdminShellBypass(page);
        // Hold genuine data requests so frame assertions cannot race a fast response.
        // No payloads or authentication behavior are replaced.
        let releaseInitialData!: () => void;
        const initialDataGate = new Promise<void>((resolveGate) => {
            releaseInitialData = resolveGate;
        });
        const initialDataPattern = /\/api\/(?:admin\/youtube-(?:kpis|channel)|dashboard\/summary)(?:\?|$)/;
        await page.route(initialDataPattern, async (route) => {
            await initialDataGate;
            await route.continue();
        });
        const firstKpiResponsePromise = page.waitForResponse(
            (response) =>
                isInitialKpiResponse(response.url()) &&
                response.request().method() === 'GET' &&
                response.status() === 200,
            { timeout: 90000 },
        );
        const channelResponsePromise = page.waitForResponse(
            (response) =>
                response.url().includes('/api/admin/youtube-channel') &&
                response.request().method() === 'GET' &&
                response.status() === 200,
            { timeout: 90000 },
        );
        const summaryResponsePromise = page.waitForResponse(
            (response) =>
                response.url().includes('/api/dashboard/summary') &&
                response.request().method() === 'GET' &&
                response.status() === 200,
            { timeout: 90000 },
        );
        const bypassToken = getE2EAdminRouteBypassToken(testInfo);

        await page.setExtraHTTPHeaders({
            [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
            [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: bypassToken,
        });
        const dashboard = page.locator('[data-admin-dashboard-management="true"]');
        try {
            await gotoAndHidePopup(page, '/admin');
            await expect(dashboard).toBeVisible({ timeout: 20000 });
            await expectActualDashboardFrame(page);
            await expectLocalizedDashboardSkeletons(page);
            // A marker on the real node proves it survives the data transition.
            await dashboard.evaluate((element) => element.setAttribute('data-runtime-frame-retained', 'true'));
        } finally {
            releaseInitialData();
        }

        const firstKpiPayload = (await (await firstKpiResponsePromise).json()) as KpiApiPayload;
        const operationalVideoTitle = expectOperationalKpiPayload(firstKpiPayload);
        await expect(channelResponsePromise).resolves.toBeTruthy();
        await expect(summaryResponsePromise).resolves.toBeTruthy();
        await page.unroute(initialDataPattern);
        await expect(dashboard).toHaveAttribute('data-runtime-frame-retained', 'true');
        await expectActualDashboardFrame(page);
        await expect(dashboard.locator('[data-admin-dashboard-data-pending]')).toHaveCount(0);
        const confidenceRail = page.locator('[data-admin-dashboard-data-confidence="true"]');
        await expect(confidenceRail).toHaveCount(0);
        expect(operationalVideoTitle).not.toBe('');
        await expect(page.getByText(operationalVideoTitle, { exact: false }).first()).toBeVisible({
            timeout: 20000,
        });
        await expect(page.locator('body')).not.toContainText('KPI 회귀 테스트 영상');
        await expect(page.locator('body')).not.toContainText('회귀 테스트 영상');
        await expect(page.locator('[data-admin-dashboard-diagnosis-visual="signal-bar"]')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('구독자 기여 후보');
        await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true');
        const dashboardBox = await page
            .locator('[data-admin-dashboard-management="true"]')
            .boundingBox();
        expect(dashboardBox?.height ?? 0).toBeGreaterThanOrEqual(1000);
        await page.screenshot({
            path: testInfo.outputPath('kpi-dashboard-real-data-fhd.png'),
            fullPage: false,
        });
        const [reportPage] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('[data-admin-dashboard-kpi-pdf-export-trigger="true"]').click(),
        ]);
        await expect(reportPage.locator('body')).not.toContainText('데이터 신뢰도');
        await expect(reportPage.locator('body')).not.toContainText('단일 지배');
        await expect(reportPage.locator('body')).not.toContainText('구독자 기여 후보');
        await expect(reportPage.getByLabel('핵심 KPI')).toBeVisible();
        await reportPage.close();

        for (const widgetId of ADMIN_DASHBOARD_WIDGET_IDS) {
            await expect(page.locator(`[data-admin-dashboard-widget-card="${widgetId}"]`)).toBeVisible({
                timeout: 20000,
            });
        }

        let releasePeriodData!: () => void;
        const periodDataGate = new Promise<void>((resolveGate) => {
            releasePeriodData = resolveGate;
        });
        const periodPattern = /\/api\/admin\/youtube-(?:kpis|channel)\?/;
        await page.route(periodPattern, async (route) => {
            if (new URL(route.request().url()).searchParams.get('period') === '3M') {
                await periodDataGate;
            }
            await route.continue();
        });
        try {
            await page.getByRole('button', { name: '3개월' }).click();
            await expect(page.getByRole('button', { name: '3개월' })).toHaveAttribute('aria-pressed', 'true');
            await expect(dashboard).toHaveAttribute('data-runtime-frame-retained', 'true');
            await expectLocalizedDashboardSkeletons(page);
            await expectActualDashboardFrame(page);
            await expect(confidenceRail).toHaveCount(0);
            // Returning to a fresh cached period must not impose another loading phase.
            await page.getByRole('button', { name: '전체', exact: true }).click();
            await expect(page.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true');
            await expect(dashboard.locator('[data-admin-dashboard-data-pending]')).toHaveCount(0);
            await expect(dashboard).toHaveAttribute('data-runtime-frame-retained', 'true');
        } finally {
            releasePeriodData();
            await page.unroute(periodPattern);
        }

        await page.getByRole('button', { name: '6시간' }).click();
        await expect(page.getByRole('button', { name: '6시간' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveCount(0);

        await page.getByRole('button', { name: '12시간' }).click();
        await expect(page.getByRole('button', { name: '12시간' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveCount(0);

        await page.getByRole('button', { name: '6개월' }).click();
        await expect(page.getByRole('button', { name: '6개월' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveCount(0);

        await page.getByRole('button', { name: '1년' }).click();
        await expect(page.getByRole('button', { name: '1년' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveCount(0);

        const impactCard = page.locator('[data-admin-dashboard-widget-card="impact"]').first();
        const impactTableButton = impactCard
            .locator('[data-admin-dashboard-card-view-toggle="true"]')
            .getByRole('button', { name: '표' });
        await impactTableButton.click();
        await expect(impactTableButton).toHaveAttribute('aria-pressed', 'true');
        await expect(impactCard.locator('[data-admin-dashboard-table-view="true"]').first()).toBeVisible();
        const boundedTable = impactCard.locator('[data-admin-dashboard-table-pagination="bounded"]');
        await expect(boundedTable).toBeVisible();
        const table = boundedTable.getByRole('table', { name: '대시보드 데이터 표' });
        const totalRows = Number(await table.getAttribute('aria-rowcount')) - 1;
        expect(Number.isSafeInteger(totalRows)).toBe(true);
        expect(totalRows).toBeGreaterThan(0);
        expect(totalRows).toBeLessThanOrEqual(10000);
        const pageSize = 50;
        const pageCount = Math.ceil(totalRows / pageSize);
        const previousPage = boundedTable.getByRole('button', { name: '표 이전 페이지' });
        const nextPage = boundedTable.getByRole('button', { name: '표 다음 페이지' });
        const visibleRows = table.locator('tbody tr');
        // Check every page by absolute row indices, without retaining row content.
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
            const start = pageIndex * pageSize;
            const count = Math.min(pageSize, totalRows - start);
            await expect(visibleRows).toHaveCount(count);
            await expect(visibleRows.first()).toHaveAttribute('aria-rowindex', String(start + 2));
            await expect(visibleRows.last()).toHaveAttribute('aria-rowindex', String(start + count + 1));
            if (pageCount > 1) {
                if (pageIndex === 0) await expect(previousPage).toBeDisabled();
                else await expect(previousPage).toBeEnabled();
                if (pageIndex + 1 < pageCount) {
                    await expect(nextPage).toBeEnabled();
                    await nextPage.click();
                } else await expect(nextPage).toBeDisabled();
            }
        }
        if (pageCount > 1) {
            await previousPage.click();
            await expect(visibleRows.first()).toHaveAttribute('aria-rowindex', String((pageCount - 2) * pageSize + 2));
        } else {
            await expect(previousPage).toHaveCount(0);
            await expect(nextPage).toHaveCount(0);
        }


        await gotoAndHidePopup(page, '/admin/?module=overview');
        await expect(page.locator('[data-admin-dashboard-management="true"]')).toBeVisible({
            timeout: 20000,
        });
        await expect(page.getByRole('button', { name: '대시보드 (KPI)' })).toHaveAttribute(
            'aria-current',
            'page',
        );

        await expectNoRuntimeErrorsAfterHydration(page, runtimeErrors);
    });
});
