import { expect, test, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';


import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup } from './helpers';
import { ADMIN_SIDEBAR_ITEM_IDS } from '../lib/admin/sidebar-order';
import { getAdminModuleTitle } from '../lib/admin/admin-module-metadata';

const ADMIN_MODULE_SMOKE_TARGETS = [
  {
    path: '/admin',
    moduleId: 'overview',
    headerSelector: '[data-admin-dashboard-management="true"] [data-admin-page-header]',
    readySelector: '[data-admin-dashboard-management="true"]',
  },
  {
    path: '/admin?module=routes',
    moduleId: 'routes',
    headerSelector: '[data-admin-module-header-module="routes"]',
    readySelector: '[aria-label="관리자 지도 운영 개요 2분할"]',
  },
  {
    path: '/admin?module=restaurants',
    moduleId: 'restaurants',
    headerSelector: '[data-admin-restaurant-primary-header="true"]',
    readySelector: '#scroll-container',
  },
  {
    path: '/admin?module=restaurant-refresh-history',
    moduleId: 'restaurant-refresh-history',
    activeModuleId: 'restaurants',
    headerSelector: '[data-admin-restaurant-primary-header="true"]',
    readySelector: '[data-admin-restaurant-refresh-history="true"]',
  },
  {
    path: '/admin?module=submissions',
    moduleId: 'submissions',
    headerSelector: '[data-admin-module-header-module="submissions"]',
    readySelector: '#scroll-container',
  },
  {
    path: '/admin?module=reviews',
    moduleId: 'reviews',
    headerSelector: '[data-admin-module-header-module="reviews"]',
    readySelector: '#scroll-container',
  },
  {
    path: '/admin?module=storyboard',
    moduleId: 'storyboard',
    headerSelector: '[data-local-storyboard-workspace="true"] [data-admin-page-header]',
    readySelector: '[data-local-storyboard-workspace="true"]',
  },
  {
    path: '/admin?module=banners',
    moduleId: 'banners',
    headerSelector: '[data-admin-module-header-module="banners"]',
    readySelector: '[aria-labelledby="banner-list-title"]',
  },
  {
    path: '/admin?module=users',
    moduleId: 'users',
    headerSelector: '[data-admin-module-header-module="users"]',
    readySelector: '[data-admin-users-summary]',
  },
  {
    path: '/admin?module=insights',
    moduleId: 'insights',
    headerSelector: '[data-admin-module-header-module="insights"]',
    readySelector: '[data-admin-embedded-module-id="insights"]',
  },
  {
    path: '/admin?module=audit',
    moduleId: 'audit',
    headerSelector: '[data-admin-module-header-module="audit"]',
    readySelector: '[data-admin-audit-coverage="partial-domain-specific"]',
  },
  {
    path: '/admin?module=youtube-thumbnail-generator',
    moduleId: 'youtube-thumbnail-generator',
    headerSelector: '[data-admin-module-header-module="youtube-thumbnail-generator"]',
    readySelector: '[data-admin-youtube-thumbnail-generator="true"]',
  },
  {
    path: '/admin?module=llm',
    moduleId: 'llm',
    headerSelector: '[data-admin-module-header-module="llm"]',
    readySelector: '[data-admin-operations-panel]',
  },
  {
    path: '/admin?module=pipeline',
    moduleId: 'pipeline',
    headerSelector: '[data-admin-module-header-module="pipeline"]',
    readySelector: '[data-admin-pipeline-dashboard="true"]',
  },
  {
    path: '/admin?module=knowledge-graph',
    moduleId: 'knowledge-graph',
    headerSelector: '[data-admin-knowledge-graph-panel] [data-admin-page-header]',
    readySelector: '[data-knowledge-canvas]',
  },
  {
    path: '/admin?module=sentry',
    moduleId: 'sentry',
    headerSelector: '[data-admin-sentry-panel] [data-admin-page-header]',
    readySelector: '[data-admin-sentry-panel]',
  },
] as const;

const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = 'tzudong:e2e-admin-shell-bypass';
const HYDRATION_SMOKE_ARTIFACT_DIR = process.env.ADMIN_HYDRATION_ARTIFACT_DIR
  ? resolve(process.env.ADMIN_HYDRATION_ARTIFACT_DIR)
  : resolve(process.cwd(), '..', '..', 'artifacts', 'ultragoal');
const HYDRATION_SMOKE_SCREENSHOT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-admin-console-modules-final.png');
const HYDRATION_SMOKE_TRANSCRIPT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-admin-console-modules-transcript.json');
const MOBILE_MENU_SCREENSHOT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-mobile-admin-menu-final.jpg');
const MOBILE_MENU_TRANSCRIPT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-mobile-admin-menu-transcript.json');
const STORYBOARD_RESPONSIVE_SCREENSHOT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g002-storyboard-responsive-final.png');
const STORYBOARD_RESPONSIVE_TRANSCRIPT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g002-storyboard-responsive-transcript.json');
const INSIGHTS_STATE_SCREENSHOT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g002-insights-error-final.png');
const INSIGHTS_STATE_TRANSCRIPT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g002-insights-state-transcript.json');
const ADMIN_DASHBOARD_ZERO_VALUE_FIXTURE = {
  asOf: '2026-07-01T00:00:00.000Z',
  period: '1M',
  totalVideos: 3,
  videos: [
    {
      id: 'dashboard-chart-high',
      title: '차트 최대값 영상',
      category: '한식',
      viewCount: 1000,
      likeCount: 100,
      commentCount: 20,
      duration: 600,
      previousViewCount: 900,
      previousLikeCount: 90,
      previousCommentCount: 18,
      previousDuration: 580,
      publishedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'dashboard-chart-zero',
      title: '차트 영값 영상',
      category: '한식',
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      duration: 0,
      previousViewCount: 0,
      previousLikeCount: 0,
      previousCommentCount: 0,
      previousDuration: 0,
      publishedAt: '2026-06-15T00:00:00.000Z',
    },
    {
      id: 'dashboard-chart-middle',
      title: '차트 중간값 영상',
      category: '한식',
      viewCount: 500,
      likeCount: 50,
      commentCount: 10,
      duration: 300,
      previousViewCount: 400,
      previousLikeCount: 40,
      previousCommentCount: 8,
      previousDuration: 290,
      publishedAt: '2026-06-30T00:00:00.000Z',
    },
  ],
} as const;


function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
  const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.');
  }
  return token;
}

async function installE2EAdminShellBypass(page: Page) {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, '1');
  }, E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY);
}

function attachRuntimeErrorCollectors(page: Page, runtimeErrors: string[]) {
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/hydration|error #418|minified react error|react[^\n]*hydration/i.test(text)) {
      runtimeErrors.push(text);
    }
  });

  page.on('pageerror', (error) => {
    runtimeErrors.push(error.message);
  });
}

test.describe('admin console module hydration smoke', () => {
  test('loads core admin modules without hydration/runtime errors', async ({ page, context }, testInfo) => {
    test.setTimeout(300_000);

    const runtimeErrors: string[] = [];
    const visited: Array<{ path: string; moduleId: string; headerSelector: string; readySelector: string }> = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);
    const targetIds = ADMIN_MODULE_SMOKE_TARGETS.map(target => target.moduleId);
    expect(new Set(targetIds).size).toBe(targetIds.length);
    expect(targetIds.filter(id => id !== 'restaurant-refresh-history').sort()).toEqual([...ADMIN_SIDEBAR_ITEM_IDS].sort());
    const blockedMutations: string[] = [];
    // Optional isolated shell smoke: bounded failures are rendered content too,
    // but this mode provides no successful hosted-data or mutation evidence.
    if (process.env.ADMIN_HYDRATION_READ_ONLY === '1') {
      const origin = new URL(testInfo.project.use.baseURL as string).origin;
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['GET', 'HEAD'].includes(request.method())) {
          blockedMutations.push(url.pathname);
          return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } });
        }
        if (url.origin !== origin) return route.fulfill({ status: 503, body: '' });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } });
        return route.continue();
      });
    }

    await installE2EAdminShellBypass(page);

    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    for (const target of ADMIN_MODULE_SMOKE_TARGETS) {
      await gotoAndHidePopup(page, target.path);
      await expect(page.locator('#admin-console-canvas')).toHaveAttribute(
        'data-admin-console-active-module',
        'activeModuleId' in target ? target.activeModuleId : target.moduleId,
        { timeout: 30_000 },
      );
      const headerSelector = target.headerSelector;
      await expect(page.locator(headerSelector)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(target.readySelector)).toBeVisible({ timeout: 30_000 });
      const rootHeadings = page.locator('#admin-console-canvas h1:visible');
      await expect(rootHeadings).toHaveCount(1);
      await expect(rootHeadings).toHaveText(getAdminModuleTitle(target.moduleId));
      if (target.moduleId === 'restaurant-refresh-history') {
        await expect(page).toHaveURL(/module=restaurants.*restaurantView=refresh/);
        await expect(page.getByRole('tab', { name: '최신화·이력' })).toHaveAttribute('aria-selected', 'true');
      }
      visited.push({ path: target.path, moduleId: target.moduleId, headerSelector, readySelector: target.readySelector });
      await page.waitForTimeout(300);
    }

    expect(runtimeErrors).toEqual([]);
    expect(blockedMutations).toEqual([]);
    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: HYDRATION_SMOKE_SCREENSHOT, fullPage: false });
    writeFileSync(
      HYDRATION_SMOKE_TRANSCRIPT,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        scope: process.env.ADMIN_HYDRATION_READ_ONLY === '1' ? 'local-read-only-synthetic-failure-states' : 'configured-runtime',
        sidebarModuleCount: ADMIN_SIDEBAR_ITEM_IDS.length,
        blockedMutationCount: blockedMutations.length,
        visited,
        runtimeErrors,
        screenshot: HYDRATION_SMOKE_SCREENSHOT,
      }, null, 2)}\n`,
    );
  });

  test('renders the production Recharts series, legend, and zero-value tooltip', async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const runtimeErrors: string[] = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);
    await page.route('**/api/admin/youtube-kpis**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ADMIN_DASHBOARD_ZERO_VALUE_FIXTURE),
      });
    });
    await page.route('**/api/admin/youtube-channel**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          channelId: 'dashboard-chart-channel',
          title: '차트 검증 채널',
          handle: '@chart-test',
          subscriberCount: 100,
          previousSubscriberCount: 100,
          subscriberDelta: 0,
          videoCount: 3,
          previousVideoCount: 3,
          videoDelta: 0,
          deltaSource: 'snapshot-delta',
        }),
      });
    });

    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });
    await gotoAndHidePopup(page, '/admin');

    const trendCard = page.locator('[data-admin-dashboard-widget-card="trend"]');
    const trendChart = trendCard.locator('[data-admin-dashboard-line-chart="recharts"]');
    const bubbleChart = page.locator('[data-admin-dashboard-bubble-chart="recharts"]');
    const trendChartSizeGate = trendChart.locator(
      '[data-admin-dashboard-chart-size-ready="true"]',
    );
    const bubbleChartSizeGate = bubbleChart.locator(
      '[data-admin-dashboard-chart-size-ready="true"]',
    );
    const legend = page.getByLabel('영상별 성과 분포 지표 숨김/보임');
    await expect(trendChart).toBeVisible({ timeout: 30_000 });
    await expect(bubbleChart).toBeVisible({ timeout: 30_000 });
    await expect(trendChartSizeGate).toBeVisible();
    await expect(bubbleChartSizeGate).toBeVisible();
    await expect(legend).toBeVisible();
    await expect(legend.getByRole('button', { name: '조회수 숨기기' })).toBeVisible();
    await expect(trendChart.locator('.recharts-line-curve')).toHaveCount(3);
    await expect(trendChart.locator('.recharts-line-dots circle')).toHaveCount(9);

    const initialTrendHeight = await trendChartSizeGate.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    const initialBubbleHeight = await bubbleChartSizeGate.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    expect(initialTrendHeight).toBeGreaterThan(0);
    expect(initialBubbleHeight).toBeGreaterThan(0);

    const zeroValueDot = trendChart.locator('.recharts-line-dots').last().locator('circle').nth(1);
    await zeroValueDot.hover();
    const tooltip = page.locator('[data-admin-dashboard-tooltip-kind="trend-simple"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('0점');

    await legend.getByRole('button', { name: '조회수 숨기기' }).click();
    await expect(legend.getByRole('button', { name: '조회수 보이기' })).toBeVisible();
    await expect(trendChart.locator('.recharts-line-curve')).toHaveCount(2);

    const trendViewToggle = trendCard.locator(
      '[data-admin-dashboard-card-view-toggle="true"]',
    );
    await trendViewToggle.getByRole('button', { name: '표' }).click();
    await expect(trendCard.locator('[data-admin-dashboard-table-view="true"]')).toBeVisible();
    await expect(trendChart).toHaveCount(0);
    await expect(bubbleChart).toBeVisible();

    await trendViewToggle.getByRole('button', { name: '그래프' }).click();
    await expect(trendChart).toBeVisible();
    await expect(trendChart.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(legend.getByRole('button', { name: '조회수 보이기' })).toBeVisible();
    await expect
      .poll(async () => {
        const recoveredHeight = await trendChartSizeGate.evaluate(
          (element) => element.getBoundingClientRect().height,
        );
        return Math.abs(recoveredHeight - initialTrendHeight);
      })
      .toBeLessThanOrEqual(2);
    await expect
      .poll(async () => {
        const recoveredHeight = await bubbleChartSizeGate.evaluate(
          (element) => element.getBoundingClientRect().height,
        );
        return Math.abs(recoveredHeight - initialBubbleHeight);
      })
      .toBeLessThanOrEqual(2);
    expect(runtimeErrors).toEqual([]);
  });

  test('mobile hamburger menu selects a module with active state and closes the dropdown', async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const runtimeErrors: string[] = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);

    await page.setViewportSize({ width: 390, height: 844 });
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    const gotoAt = new Date().toISOString();
    await gotoAndHidePopup(page, '/admin');
    const canvas = page.locator('#admin-console-canvas');
    const dropdown = page.locator('[data-admin-console-menu-dropdown="true"]');
    const mobileHeader = page.locator('[data-admin-console-mobile-header="true"]');
    const menuTrigger = page.locator('[data-admin-console-menu-trigger="hamburger"]');
    const routeMenuItem = page.locator(
      '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
    );

    await expect(page.locator('[data-admin-dashboard-management="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(mobileHeader).toHaveAttribute(
      'data-admin-console-mobile-header-visible',
      'true',
    );
    await canvas.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 48 }));
    });
    await expect(mobileHeader).toHaveAttribute(
      'data-admin-console-mobile-header-visible',
      'true',
    );
    const nestedScrollObservation = await canvas.evaluate((element) => {
      const nestedScroller = document.createElement('div');
      nestedScroller.setAttribute('data-admin-nested-scroll-visibility-probe', 'true');
      nestedScroller.style.height = '96px';
      nestedScroller.style.overflowY = 'auto';
      nestedScroller.style.overscrollBehavior = 'contain';

      const nestedContent = document.createElement('div');
      nestedContent.style.height = '720px';
      nestedContent.textContent = 'Nested admin mobile chrome scroll probe';
      nestedScroller.appendChild(nestedContent);
      element.appendChild(nestedScroller);

      nestedScroller.scrollTop = 180;
      nestedScroller.dispatchEvent(new Event('scroll', { bubbles: false }));
      return {
        nestedScrollTop: nestedScroller.scrollTop,
        probeExists: element.contains(nestedScroller),
      };
    });
    expect(nestedScrollObservation).toEqual({
      nestedScrollTop: 180,
      probeExists: true,
    });
    await expect(mobileHeader).toHaveAttribute(
      'data-admin-console-mobile-header-visible',
      'false',
    );
    await canvas.evaluate((element) => {
      const nestedScroller = element.querySelector<HTMLElement>(
        '[data-admin-nested-scroll-visibility-probe="true"]',
      );
      if (!nestedScroller) throw new Error('Nested admin scroll probe was not mounted.');
      nestedScroller.scrollTop = 0;
      nestedScroller.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    await expect(mobileHeader).toHaveAttribute(
      'data-admin-console-mobile-header-visible',
      'true',
    );
    await canvas.evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.setAttribute('data-admin-menu-scroll-spacer', 'runtime-guard');
      spacer.style.height = '640px';
      element.appendChild(spacer);
      element.scrollTop = 180;
    });

    const nestedScrollCheckedAt = new Date().toISOString();
    const openMenuAt = new Date().toISOString();
    await menuTrigger.click();
    await expect(dropdown).toBeVisible();
    const orderEditor = dropdown.locator('[data-admin-sidebar-order-editor]');
    const orderToggle = orderEditor.locator('[data-admin-sidebar-order-edit-toggle="true"]');
    const moveControls = orderEditor.getByRole('button', { name: / (메뉴|섹션) (앞으로|뒤로)$/ });
    await expect(orderToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(moveControls).toHaveCount(0);
    const lockedEditorHeight = await orderEditor.evaluate(element => element.getBoundingClientRect().height);
    expect(lockedEditorHeight).toBeLessThan(250);
    const lockedMoveControlCount = await moveControls.count();
    await orderToggle.click();
    await expect(orderToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(orderEditor.getByRole('button', { name: '대시보드 (KPI) 메뉴 뒤로', exact: true })).toBeVisible();
    const editingMoveControlCount = await moveControls.count();
    const editingEditorHeight = await orderEditor.evaluate(element => element.getBoundingClientRect().height);
    await orderToggle.click();
    await expect(orderToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(moveControls).toHaveCount(0);
    await expect(routeMenuItem).toBeVisible();
    const selectModuleAt = new Date().toISOString();
    await routeMenuItem.click();

    await expect(dropdown).toHaveCount(0);
    const dropdownCountAfterSelection = await dropdown.count();
    await expect(page).toHaveURL(/\/admin\?module=routes$/);
    await expect(canvas).toHaveAttribute('data-admin-console-active-module', 'routes', {
      timeout: 30_000,
    });
    await expect(page.locator('[aria-label="관리자 지도 운영 개요 2분할"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => canvas.evaluate((element) => element.scrollTop))
      .toBe(0);
    const measuredScrollTopAfterSelection = await canvas.evaluate((element) => element.scrollTop);
    const activeModuleIdAfterSelection = await canvas.getAttribute('data-admin-console-active-module');
    const finalUrlAfterSelection = page.url();
    const selectionCheckedAt = new Date().toISOString();

    const reopenMenuAt = new Date().toISOString();
    await menuTrigger.click();
    await expect(dropdown).toBeVisible();
    await expect(routeMenuItem).toHaveAttribute('aria-current', 'page');
    await expect(routeMenuItem).toHaveAttribute('data-admin-console-menu-item-state', 'active');
    await expect(routeMenuItem).toHaveClass(/bg-primary/);
    const activeMenuObservation = await routeMenuItem.evaluate((element) => ({
      ariaCurrent: element.getAttribute('aria-current'),
      className: element.getAttribute('class'),
      dataState: element.getAttribute('data-admin-console-menu-item-state'),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      visualHasPrimaryClass: [...element.classList].some(className => /^bg-primary(?:\/|$)/.test(className)),
    }));
    const activeStateCheckedAt = new Date().toISOString();
    const viewport = page.viewportSize();
    await routeMenuItem.scrollIntoViewIfNeeded();
    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    const screenshotAt = new Date().toISOString();
    await page.screenshot({ path: MOBILE_MENU_SCREENSHOT, fullPage: false });
    writeFileSync(
      MOBILE_MENU_TRANSCRIPT,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        surface: 'web',
        tool: 'playwright',
        viewport,
        observations: {
          sidebarOrderEditor: {
            lockedEditorHeight,
            lockedMoveControlCount,
            editingEditorHeight,
            editingMoveControlCount,
          },
          activeMenuObservation,
          activeModuleIdAfterSelection,
          dropdownCountAfterSelection,
          finalUrlAfterSelection,
          measuredScrollTopAfterSelection,
          nestedScrollObservation,
          screenshot: MOBILE_MENU_SCREENSHOT,
          setup: 'Inserted a nested scroll probe and a test-only spacer into #admin-console-canvas before selection to make descendant chrome visibility and scroll reset observable.',
        },
        actions: [
          { type: 'goto', timestamp: gotoAt, url: '/admin' },
          {
            type: 'click',
            timestamp: openMenuAt,
            selector: '[data-admin-console-menu-trigger="hamburger"]',
          },
          {
            type: 'click',
            timestamp: selectModuleAt,
            selector: '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
          },
          {
            type: 'click',
            timestamp: reopenMenuAt,
            selector: '[data-admin-console-menu-trigger="hamburger"]',
          },
          {
            type: 'screenshot',
            timestamp: screenshotAt,
            selector: '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
          },
        ],
        assertions: [
          {
            timestamp: nestedScrollCheckedAt,
            selector: '[data-admin-nested-scroll-visibility-probe="true"]',
            status: 'passed',
            description: `Nested descendant scrollTop=${nestedScrollObservation.nestedScrollTop} hid the mobile header, then scrollTop=0 restored it.`,
          },
          {
            timestamp: selectionCheckedAt,
            selector: '#admin-console-canvas',
            status: 'passed',
            description: `Canvas activeModuleId=${activeModuleIdAfterSelection}, scrollTop=${measuredScrollTopAfterSelection}, url=${finalUrlAfterSelection}`,
          },
          {
            timestamp: activeStateCheckedAt,
            selector: '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
            status: 'passed',
            description: `Active menu state aria-current=${activeMenuObservation.ariaCurrent}, data-state=${activeMenuObservation.dataState}, visualHasPrimaryClass=${activeMenuObservation.visualHasPrimaryClass}`,
          },
        ],
        screenshot: MOBILE_MENU_SCREENSHOT,
      }, null, 2)}\n`,
    );

    await page.keyboard.press('Escape');
    await expect(dropdown).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();

    await menuTrigger.click();
    const thumbnailMenuItem = page.locator(
      `[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="${getAdminModuleTitle('youtube-thumbnail-generator')}"]`,
    );
    await expect(thumbnailMenuItem).toBeVisible();
    await thumbnailMenuItem.click();
    await expect(page).toHaveURL(/\/admin\?module=youtube-thumbnail-generator$/);
    await expect(canvas).toHaveAttribute(
      'data-admin-console-active-module',
      'youtube-thumbnail-generator',
      { timeout: 30_000 },
    );
    await expect(page.locator('[data-admin-youtube-thumbnail-generator="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => canvas.evaluate((element) => element.scrollTop))
      .toBe(0);
    await expect
      .poll(() => canvas.evaluate((element) => document.activeElement === element))
      .toBe(true);
    await expect(mobileHeader).toHaveAttribute(
      'data-admin-console-mobile-header-visible',
      'true',
    );
    await expect(menuTrigger).toBeVisible();
    const restoredTriggerGeometry = await menuTrigger.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        pointerEvents: window.getComputedStyle(element).pointerEvents,
        y: bounds.y,
      };
    });
    expect(restoredTriggerGeometry.pointerEvents).not.toBe('none');
    expect(restoredTriggerGeometry.y).toBeGreaterThanOrEqual(0);
    expect(restoredTriggerGeometry.height).toBeGreaterThanOrEqual(44);
    expect(runtimeErrors).toEqual([]);
  });

  test('mobile restaurant evaluations keep quick filters clickable and view toggles icon-only', async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const runtimeErrors: string[] = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);

    await page.setViewportSize({ width: 390, height: 844 });
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    await gotoAndHidePopup(page, '/admin?module=restaurants');

    const canvas = page.locator('#admin-console-canvas');
    await expect(page).toHaveURL(/\/admin\?module=restaurants$/);
    await expect(canvas).toHaveAttribute('data-admin-console-active-module', 'restaurants', {
      timeout: 30_000,
    });

    const statusFilter = page.locator('[data-admin-evaluation-mobile-status-filter="true"]');
    await expect(statusFilter).toBeVisible({ timeout: 30_000 });
    await expect(statusFilter).toHaveAttribute('data-admin-evaluation-mobile-toolbar', 'two-row');
    await expect
      .poll(() =>
        statusFilter.evaluate((element) => {
          const buttons = Array.from(element.querySelectorAll('[data-admin-evaluation-mobile-status-filter-option]'));
          const rowCounts = buttons.reduce<Record<string, number>>((counts, button) => {
            const top = String(Math.round(button.getBoundingClientRect().top));
            counts[top] = (counts[top] ?? 0) + 1;
            return counts;
          }, {});
          return buttons.length === 6 && Object.values(rowCounts).length === 2 && Object.values(rowCounts).every((count) => count === 3);
        })
      )
      .toBe(true);

    const listToggle = page.locator('[data-admin-evaluation-view-toggle="list"]');
    const slideToggle = page.locator('[data-admin-evaluation-view-toggle="slide"]');
    await expect(listToggle).toBeVisible();
    await expect(slideToggle).toBeVisible();

    for (const toggle of [listToggle, slideToggle]) {
      await expect
        .poll(async () => Math.round((await toggle.boundingBox())?.width ?? 0))
        .toBeLessThanOrEqual(36);
      await expect
        .poll(async () => Math.round((await toggle.boundingBox())?.height ?? 0))
        .toBeLessThanOrEqual(36);
    }

    const pendingFilter = page.locator('[data-admin-evaluation-mobile-status-filter-option="pending"]');
    await pendingFilter.click();
    await expect(pendingFilter).toHaveAttribute('aria-pressed', 'true');

    await slideToggle.click();
    await expect(slideToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(listToggle).toHaveAttribute('aria-pressed', 'false');

    expect(runtimeErrors).toEqual([]);
  });

  test('restaurant list uses one count summary and keeps its final row reachable at both widths', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const runtimeErrors: string[] = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);
    const records = Array.from({ length: 50 }, (_, index) => ({
      id: `footer-fixture-${index}`,
      name: `합성 검수 식당 ${index}`,
      status: 'approved',
      categories: ['한식'],
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
      geocoding_success: true,
    }));
    let releaseNextPage = () => {};
    let nextPageGate = Promise.resolve();
    await page.route('**/api/**', async route => {
      const request = route.request();
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/admin/evaluations') {
        const isNextPage = new URL(request.url()).searchParams.has('cursor');
        if (isNextPage) await nextPageGate;
        return route.fulfill({ json: {
          revision: '1', records: isNextPage ? records.slice(40) : records.slice(0, 40),
          filteredTotal: records.length, nextCursor: isNextPage ? null : 'synthetic-next-page',
          stats: { total: 50, approved: 50, pending: 0, hold: 0, db_conflict: 0, missing: 0, not_selected: 0, deleted: 0 },
          warnings: Object.fromEntries(records.map(record => [record.id, {
            sameVideo: { count: 0, candidates: [], message: '' }, identity: [],
          }])),
        } });
      }
      return route.fulfill({ status: 503, json: { code: 'local_synthetic_render' } });
    });
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });
    const observations = [];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      nextPageGate = new Promise<void>(resolve => { releaseNextPage = resolve; });
      await page.setViewportSize(viewport);
      await gotoAndHidePopup(page, '/admin?module=restaurants');
      const summary = viewport.width > 1024
        ? page.locator('#scroll-container .admin-cms-footer')
        : page.locator('[data-admin-evaluation-mobile-filter-actions]');
      await expect(summary).toHaveCount(1);
      await expect(summary).toContainText('40 / 50개');
      await page.getByText('합성 검수 식당 39', { exact: true }).scrollIntoViewIfNeeded();
      const progress = page.locator('#scroll-container [role="status"]').filter({ hasText: '불러오는 중' });
      await expect(progress).toBeVisible();
      await progress.scrollIntoViewIfNeeded();
      const progressBox = await progress.boundingBox();
      expect(progressBox!.y).toBeGreaterThanOrEqual(0);
      expect(progressBox!.y + progressBox!.height).toBeLessThanOrEqual(viewport.height);
      releaseNextPage();
      await expect(summary).toContainText('50 / 50개');
      await expect(page.getByText('불러오는 중', { exact: true })).toHaveCount(0);
      await expect(page.getByText(/모든 레코드를 불러왔습니다|전체 조건/, { exact: false })).toHaveCount(0);
      const finalRow = page.getByText('합성 검수 식당 49', { exact: true });
      await finalRow.scrollIntoViewIfNeeded();
      await expect(finalRow).toBeVisible();
      const rowBox = await finalRow.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(rowBox!.y).toBeGreaterThanOrEqual(0);
      expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(viewport.height);
      observations.push({ viewport, summary: await summary.textContent(), loadingStatus: progressBox, finalRow: rowBox });
      const artifactDir = process.env.ADMIN_HYDRATION_ARTIFACT_DIR?.trim();
      if (artifactDir) {
        mkdirSync(resolve(artifactDir), { recursive: true });
        await page.screenshot({ path: resolve(artifactDir, `restaurant-footer-${viewport.width}.png`) });
      }
    }
    expect(runtimeErrors).toEqual([]);
    const artifactDir = process.env.ADMIN_HYDRATION_ARTIFACT_DIR?.trim();
    if (artifactDir) writeFileSync(resolve(artifactDir, 'restaurant-footer-render.json'), JSON.stringify({
      evidence: 'local-development-shell-with-synthetic-api', observations, runtimeErrors,
    }, null, 2));
  });

  test('responsive storyboard shell exposes both stacked panels to the admin canvas', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const runtimeErrors: string[] = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);

    await page.setViewportSize({ width: 1024, height: 900 });
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    await gotoAndHidePopup(page, '/admin?module=storyboard');

    const canvas = page.locator('#admin-console-canvas');
    const shell = page.locator('[data-admin-embedded-module-id="storyboard"]');
    const resultPanel = shell.locator('[data-storyboard-result-panel="image-frames-only"]');
    const inputPanel = shell.locator('[data-storyboard-input-panel="chat-stream"]');

    await expect(canvas).toHaveAttribute('data-admin-console-active-module', 'storyboard', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-admin-module-header-module="storyboard"]')).toBeVisible();
    await expect(resultPanel).toBeVisible();
    await expect(inputPanel).toBeVisible();

    const layout = await shell.evaluate((element) => {
      const content = element.querySelector<HTMLElement>(':scope > [data-admin-module-content="bounded"]');
      const result = element.querySelector<HTMLElement>('[data-storyboard-result-panel="image-frames-only"]');
      const input = element.querySelector<HTMLElement>('[data-storyboard-input-panel="chat-stream"]');
      const canvasElement = element.closest<HTMLElement>('#admin-console-canvas');
      if (!content || !result || !input || !canvasElement) {
        throw new Error('Storyboard responsive layout markers are incomplete.');
      }

      const shellRect = element.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const resultRect = result.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const panelBottom = Math.max(resultRect.bottom, inputRect.bottom);

      return {
        shellContainsPanels: panelBottom <= shellRect.bottom + 1,
        contentContainsPanels: panelBottom <= contentRect.bottom + 1,
        shellHasNoClippedScrollRange: element.scrollHeight <= element.clientHeight + 1,
        contentHasNoClippedScrollRange: content.scrollHeight <= content.clientHeight + 1,
        canvasHasVerticalScrollRange: canvasElement.scrollHeight > canvasElement.clientHeight,
        shellHeight: Math.round(shellRect.height),
        contentHeight: Math.round(contentRect.height),
        canvasClientHeight: canvasElement.clientHeight,
        canvasScrollHeight: canvasElement.scrollHeight,
      };
    });

    expect(layout.shellContainsPanels).toBe(true);
    expect(layout.contentContainsPanels).toBe(true);
    expect(layout.shellHasNoClippedScrollRange).toBe(true);
    expect(layout.contentHasNoClippedScrollRange).toBe(true);
    expect(layout.canvasHasVerticalScrollRange).toBe(true);

    await inputPanel.scrollIntoViewIfNeeded();
    await expect(inputPanel).toBeInViewport();

    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: STORYBOARD_RESPONSIVE_SCREENSHOT, fullPage: false });
    writeFileSync(
      STORYBOARD_RESPONSIVE_TRANSCRIPT,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        surface: 'web',
        viewport: page.viewportSize(),
        route: '/admin?module=storyboard',
        layout,
        assertions: {
          compactHeaderVisible: true,
          resultPanelVisible: true,
          inputPanelReachable: true,
          stackedPanelsNotClipped: true,
        },
        runtimeErrors,
        screenshot: STORYBOARD_RESPONSIVE_SCREENSHOT,
      }, null, 2)}\n`,
    );

    expect(runtimeErrors).toEqual([]);
  });

  test('embedded insights keeps its compact shell while loading and after an API failure', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const runtimeErrors: string[] = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);

    let releaseInsightsRequest = () => {};
    const insightsRequestGate = new Promise<void>((resolveGate) => {
      releaseInsightsRequest = resolveGate;
    });
    await page.route('**/api/insights/treemap**', async (route) => {
      await insightsRequestGate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forced-insights-smoke-failure' }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    await gotoAndHidePopup(page, '/admin?module=insights');

    const canvas = page.locator('#admin-console-canvas');
    const shell = page.locator('[data-admin-embedded-module-id="insights"]');
    const header = page.locator('[data-admin-module-header-module="insights"]');
    const boundedContent = shell.locator(':scope > [data-admin-module-content="bounded"]');

    await expect(canvas).toHaveAttribute('data-admin-console-active-module', 'insights', {
      timeout: 30_000,
    });
    await expect(header).toBeVisible();
    await expect(boundedContent).toBeVisible();
    await expect(page.locator('[data-insights-client-loading="true"]')).toBeVisible();

    releaseInsightsRequest();

    await expect(page.getByRole('heading', { name: '문제가 발생했습니다' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(header).toBeVisible();
    await expect(boundedContent).toBeVisible();
    await expect(shell.getByRole('button', { name: '다시 시도' })).toBeVisible();

    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: INSIGHTS_STATE_SCREENSHOT, fullPage: false });
    writeFileSync(
      INSIGHTS_STATE_TRANSCRIPT,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        surface: 'web',
        viewport: page.viewportSize(),
        route: '/admin?module=insights',
        states: {
          loading: { compactHeaderVisible: true, boundedContentVisible: true },
          apiFailure: { compactHeaderVisible: true, boundedContentVisible: true, retryVisible: true },
        },
        runtimeErrors,
        screenshot: INSIGHTS_STATE_SCREENSHOT,
      }, null, 2)}\n`,
    );

    expect(runtimeErrors).toEqual([]);
  });
});
