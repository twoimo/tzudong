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

function readEnvWithFallback(key: string) {
    const value = process.env[key]?.trim();
    if (value) return value;

    const envPath = resolve(process.cwd(), '.env.local');
    try {
        const line = readFileSync(envPath, 'utf8')
            .split(/\r?\n/)
            .find((entry) => entry.trim().startsWith(`${key}=`));
        const rawValue = line?.slice(line.indexOf('=') + 1).trim() ?? '';
        return rawValue.replace(/^['"]|['"]$/g, '');
    } catch {
        return '';
    }
}

function toBase64Url(value: string) {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
    const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
    if (typeof token !== 'string' || !token.trim()) {
        throw new Error('playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.');
    }

    return token;
}

function createMockVideo(id: string, index: number) {
    const viewCount = 100_000 - index * 10_000;
    const likeCount = 5_000 - index * 400;
    const commentCount = 800 - index * 50;

    return {
        id,
        title: `KPI 회귀 테스트 영상 ${index + 1}`,
        category: '테스트',
        viewCount,
        likeCount,
        commentCount,
        duration: 900 + index * 30,
        previousViewCount: viewCount - 15_000,
        previousLikeCount: likeCount - 600,
        previousCommentCount: commentCount - 80,
        previousDuration: 900 + index * 30,
        publishedAt: `2026-05-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
    };
}

const MOCK_VIDEOS = [
    createMockVideo('kpi-runtime-1', 0),
    createMockVideo('kpi-runtime-2', 1),
    createMockVideo('kpi-runtime-3', 2),
];

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

async function installMockAdminSession(page: Page) {
    const supabaseUrl = readEnvWithFallback('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+/i.test(supabaseUrl)) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to build the mocked Supabase auth cookie name.');
    }

    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const session = {
        access_token: 'mock-admin-access-token',
        refresh_token: 'mock-admin-refresh-token',
        expires_in: 3600,
        expires_at: expiresAt,
        token_type: 'bearer',
        user: {
            id: '00000000-0000-4000-8000-000000000001',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'admin-runtime@example.test',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-05-27T00:00:00.000Z',
        },
    };
    const storageKey = `sb-${projectRef}-auth-token`;
    const serializedSession = JSON.stringify(session);

    await page.addInitScript(
        ({ key, value }) => {
            window.localStorage.setItem(key, value);
        },
        { key: storageKey, value: serializedSession },
    );

    await page.context().addCookies([
        {
            name: storageKey,
            value: `base64-${toBase64Url(serializedSession)}`,
            domain: 'localhost',
            path: '/',
            expires: expiresAt,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
        },
    ]);
}

async function mockAdminDashboardApis(page: Page) {
    await page.route('**/rest/v1/**', async (route) => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;
        const method = route.request().method();

        if (method === 'HEAD') {
            await route.fulfill({
                status: 200,
                headers: { 'content-range': '0-0/0' },
            });
            return;
        }

        if (pathname.includes('/user_roles')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ role: 'admin' }),
            });
            return;
        }

        if (pathname.includes('/profiles')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ nickname: 'KPI 런타임 관리자' }),
            });
            return;
        }

        if (pathname.includes('/ad_banners')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });

    await page.route('**/api/admin/pending-counts', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ submissions: 0, reviews: 0 }),
        });
    });

    await page.route('**/api/dashboard/summary', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                asOf: '2026-05-27T00:00:00.000Z',
                totals: {
                    restaurants: 10,
                    videos: 3,
                    categories: 2,
                    withCoordinates: 8,
                },
                topCategories: [{ name: '테스트', count: 3 }],
                videos: MOCK_VIDEOS.map((video) => ({
                    videoId: video.id,
                    youtubeLink: null,
                    title: video.title,
                    publishedAt: video.publishedAt,
                    restaurantCount: 1,
                    notSelectedCount: 0,
                    geocodingFailedCount: 0,
                    updatedAt: '2026-05-27T00:00:00.000Z',
                })),
            }),
        });
    });

    await page.route('**/api/admin/youtube-channel**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                channelId: 'mock-channel',
                title: 'Mock KPI Channel',
                handle: '@mock',
                subscriberCount: 1_000_000,
                viewCount: 50_000_000,
                videoCount: 3,
                hiddenSubscriberCount: false,
                fetchedAt: '2026-05-27T00:00:00.000Z',
                previousSubscriberCount: 990_000,
                previousViewCount: 49_000_000,
                previousVideoCount: 2,
                subscriberDelta: 10_000,
                viewDelta: 1_000_000,
                videoDelta: 1,
                comparisonFetchedAt: '2026-04-27T00:00:00.000Z',
            }),
        });
    });

type MockKpiQualityScenario = 'risk' | 'ok' | 'fallback' | 'live' | 'clamped' | 'overflow';

function createMockQualityFlag(
    reason:
        | 'dominates_total'
        | 'extreme_spike'
        | 'low_comparison_coverage'
        | 'fallback_source'
        | 'live_no_comparison'
        | 'clamped_metric',
    severity: 'info' | 'warning' | 'risk',
    source: string,
    index = 0,
) {
    return {
        reason,
        severity,
        metric: reason === 'fallback_source' || reason === 'live_no_comparison' ? undefined : 'views',
        source,
        videoId:
            reason === 'fallback_source' || reason === 'live_no_comparison'
                ? undefined
                : `kpi-runtime-${index + 1}`,
        value:
            reason === 'dominates_total'
                ? 0.75
                : reason === 'extreme_spike'
                  ? 24
                  : reason === 'low_comparison_coverage'
                    ? 0.33
                    : reason === 'clamped_metric'
                      ? 0
                      : undefined,
        threshold:
            reason === 'dominates_total'
                ? 0.7
                : reason === 'extreme_spike'
                  ? 20
                  : reason === 'low_comparison_coverage'
                    ? 0.9
                    : undefined,
        count: reason === 'low_comparison_coverage' ? 1 : undefined,
    };
}

function getMockKpiScenario(period: string): MockKpiQualityScenario {
    if (period === '3M') return 'ok';
    if (period === '6H') return 'live';
    if (period === '12H') return 'clamped';
    if (period === '6M') return 'fallback';
    if (period === '1Y') return 'overflow';
    return 'risk';
}

function getMockKpiSource(scenario: MockKpiQualityScenario) {
    if (scenario === 'live') return 'youtube-live';
    if (scenario === 'fallback') return 'public-treemap-fallback';
    return 'youtube-snapshot';
}

function createKpiQualityMeta(
    source = 'youtube-snapshot',
    scenario: MockKpiQualityScenario = 'risk',
) {
    if (scenario === 'ok') {
        return {
            dataSource: source,
            comparisonCoverage: {
                totalVideos: 3,
                comparedVideos: 3,
                newVideos: 0,
                missingPreviousVideos: 0,
                comparisonAvailable: true,
            },
            dataQuality: {
                status: 'ok',
                flags: [],
                reasonCounts: [],
                thresholds: {
                    highComparisonCoverageRatio: 0.9,
                    lowComparisonCoverageRatio: 0.5,
                    dominantContributionRatio: 0.7,
                    extremeMedianMultiple: 20,
                    staleSnapshotHours: 2,
                    rowCap: 500,
                },
            },
            anomalySummary: {
                totalFlags: 0,
                flags: [],
                reasonCounts: [],
            },
        };
    }

    const flags =
        scenario === 'fallback'
            ? [
                  createMockQualityFlag('fallback_source', 'warning', source),
                  createMockQualityFlag('low_comparison_coverage', 'warning', source),
              ]
            : scenario === 'live'
              ? [createMockQualityFlag('live_no_comparison', 'warning', source)]
              : scenario === 'clamped'
                ? [
                      createMockQualityFlag('clamped_metric', 'warning', source),
                      createMockQualityFlag('dominates_total', 'risk', source),
                  ]
                : scenario === 'overflow'
                  ? Array.from({ length: 6 }, (_, index) =>
                        createMockQualityFlag(
                            index % 2 === 0 ? 'dominates_total' : 'extreme_spike',
                            'risk',
                            source,
                            index,
                        ),
                    )
                  : [
                        createMockQualityFlag('dominates_total', 'risk', source),
                        createMockQualityFlag('low_comparison_coverage', 'warning', source),
                    ];
    const anomalyFlags = flags.filter(
        (flag) => flag.reason === 'dominates_total' || flag.reason === 'extreme_spike',
    );
    const warningCount = flags.filter((flag) => flag.severity === 'warning').length;
    const riskCount = flags.filter((flag) => flag.severity === 'risk').length;

    return {
        dataSource: source,
        fallbackReasonCode: scenario === 'fallback' ? 'runtime-fallback' : undefined,
        fallbackSource: scenario === 'fallback' ? 'supabase-treemap' : undefined,
        comparisonCoverage: {
            totalVideos: 3,
            comparedVideos: scenario === 'live' ? 0 : 1,
            newVideos: scenario === 'live' ? 3 : 2,
            missingPreviousVideos: 0,
            comparisonAvailable: scenario !== 'live',
        },
        dataQuality: {
            status: riskCount > 0 ? 'risk' : 'watch',
            flags,
            reasonCounts: [
                ...new Set(flags.map((flag) => flag.reason)),
            ].map((reason) => {
                const reasonFlags = flags.filter((flag) => flag.reason === reason);
                return {
                    reason,
                    severity: reasonFlags.some((flag) => flag.severity === 'risk')
                        ? 'risk'
                        : reasonFlags.some((flag) => flag.severity === 'warning')
                          ? 'warning'
                          : 'info',
                    count: reasonFlags.length,
                };
            }),
            thresholds: {
                highComparisonCoverageRatio: 0.9,
                lowComparisonCoverageRatio: 0.5,
                dominantContributionRatio: 0.7,
                extremeMedianMultiple: 20,
                staleSnapshotHours: 2,
                rowCap: 500,
            },
        },
        anomalySummary: {
            totalFlags: anomalyFlags.length,
            flags: anomalyFlags,
            reasonCounts: [
                ...(riskCount > 0
                    ? [{ reason: 'dominates_total', severity: 'risk', count: riskCount }]
                    : []),
                ...(warningCount > 0
                    ? [{ reason: 'low_comparison_coverage', severity: 'warning', count: warningCount }]
                    : []),
            ],
        },
    };
}

    await page.route('**/api/admin/youtube-kpis**', async (route) => {
        const period = new URL(route.request().url()).searchParams.get('period') ?? '1M';
        const qualityScenario = getMockKpiScenario(period);
        const source = getMockKpiSource(qualityScenario);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                asOf: '2026-05-27T00:00:00.000Z',
                period,
                totalVideos: MOCK_VIDEOS.length,
                videos: MOCK_VIDEOS.map((video, index) =>
                    qualityScenario !== 'ok' && index === 0
                        ? {
                              ...video,
                              viewCount: qualityScenario === 'clamped' ? 0 : video.viewCount,
                              anomalyFlags: createKpiQualityMeta(source, qualityScenario).anomalySummary
                                  .flags,
                              qualityFlags: createKpiQualityMeta(source, qualityScenario).dataQuality
                                  .flags,
                          }
                        : video,
                ),
                availablePeriods: ['1M', '3M', '6H', '12H', '6M', '1Y', 'ALL'],
                meta: createKpiQualityMeta(source, qualityScenario),
            }),
        });
    });

    await page.route('**/api/admin/preferences/dashboard-widget-order', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ order: ADMIN_DASHBOARD_WIDGET_IDS }),
        });
    });

    await page.route('**/api/admin/preferences/sidebar-order', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                order: {
                    sections: ['홈', '검수', '운영', '실험실'],
                    items: {},
                },
            }),
        });
    });
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

        await installMockAdminSession(page);
        await mockAdminDashboardApis(page);
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
        await installMockAdminSession(page);
        await mockAdminDashboardApis(page);
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

        const canvasPaddingBottom = await canvas.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).paddingBottom),
        );
        expect(canvasPaddingBottom).toBeLessThanOrEqual(16);

        await canvas.evaluate((element) => {
            const spacer = document.createElement('div');
            spacer.setAttribute('data-admin-scroll-spacer', 'runtime-guard');
            spacer.style.height = '900px';
            spacer.style.flex = '0 0 auto';
            element.appendChild(spacer);
        });
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();

        await page.mouse.move(
            (box?.x ?? 0) + Math.min(160, (box?.width ?? 320) / 2),
            (box?.y ?? 0) + Math.min(220, (box?.height ?? 440) / 2),
        );
        await page.mouse.wheel(0, 520);

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
            element.scrollTop = 0;
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
        });

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

        await installMockAdminSession(page);
        await mockAdminDashboardApis(page);
        const bypassToken = getE2EAdminRouteBypassToken(testInfo);

        await page.setExtraHTTPHeaders({
            [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
            [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: bypassToken,
        });
        await gotoAndHidePopup(page, '/admin');

        await expect(page.locator('[data-admin-dashboard-management="true"]')).toBeVisible({
            timeout: 20000,
        });

        const confidenceRail = page.locator('[data-admin-dashboard-data-confidence="true"]');
        await expect(confidenceRail).toBeVisible({
            timeout: 20000,
        });
        await expect(confidenceRail).toHaveAttribute(
            'data-admin-dashboard-data-confidence-status',
            'risk',
        );
        await expect(confidenceRail).toContainText('단일 지배');
        await expect(confidenceRail.locator('[data-admin-dashboard-anomaly-badges="true"]').first()).toBeVisible();
        await page.screenshot({
            path: testInfo.outputPath('kpi-dashboard-data-confidence.png'),
            fullPage: false,
        });
        const [reportPage] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('[data-admin-dashboard-kpi-pdf-export-trigger="true"]').click(),
        ]);
        await expect(reportPage.getByLabel('데이터 신뢰도와 이상치')).toContainText(
            '데이터 신뢰도: 위험',
        );
        await expect(reportPage.getByLabel('데이터 신뢰도와 이상치')).toContainText('단일 지배');
        await reportPage.close();

        for (const widgetId of ADMIN_DASHBOARD_WIDGET_IDS) {
            await expect(page.locator(`[data-admin-dashboard-widget-card="${widgetId}"]`)).toBeVisible({
                timeout: 20000,
            });
        }

        await page.getByRole('button', { name: '3개월' }).click();
        await expect(page.getByRole('button', { name: '3개월' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveAttribute(
            'data-admin-dashboard-data-confidence-status',
            'ok',
        );
        await expect(page.locator('[data-admin-dashboard-anomaly-badges="true"]')).toHaveCount(0);

        await page.getByRole('button', { name: '6시간' }).click();
        await expect(page.getByRole('button', { name: '6시간' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveAttribute(
            'data-admin-dashboard-data-confidence-status',
            'watch',
        );
        await expect(confidenceRail).toContainText('실시간 비교 없음');
        await expect(confidenceRail).not.toContainText('커버리지 낮음');

        await page.getByRole('button', { name: '12시간' }).click();
        await expect(page.getByRole('button', { name: '12시간' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveAttribute(
            'data-admin-dashboard-data-confidence-status',
            'risk',
        );
        await expect(confidenceRail).toContainText('정규화');

        await page.getByRole('button', { name: '6개월' }).click();
        await expect(page.getByRole('button', { name: '6개월' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveAttribute(
            'data-admin-dashboard-data-confidence-status',
            'watch',
        );
        await expect(confidenceRail).toContainText('폴백');

        await page.getByRole('button', { name: '1년' }).click();
        await expect(page.getByRole('button', { name: '1년' })).toHaveAttribute('aria-pressed', 'true');
        await expect(confidenceRail).toHaveAttribute(
            'data-admin-dashboard-data-confidence-status',
            'risk',
        );
        await expect(
            confidenceRail.locator(
                '[data-admin-dashboard-anomaly-badges="true"] [data-admin-dashboard-inline-tooltip="true"]',
            ),
        ).toHaveCount(4);

        const impactCard = page.locator('[data-admin-dashboard-widget-card="impact"]').first();
        const impactTableButton = impactCard
            .locator('[data-admin-dashboard-card-view-toggle="true"]')
            .getByRole('button', { name: '표' });
        await impactTableButton.click();
        await expect(impactTableButton).toHaveAttribute('aria-pressed', 'true');
        await expect(impactCard.locator('[data-admin-dashboard-table-view="true"]').first()).toBeVisible();

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
