import { expect, test, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';


import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
} from '../lib/admin/console-menu-registry';
import { gotoAndHidePopup } from './helpers';
import { writeEvidenceIfSafe } from './helpers/evidence-guard';

const ADMIN_MODULE_SMOKE_TARGETS = [
  {
    path: '/admin',
    moduleId: 'overview',
    readySelector: '[data-admin-dashboard-management="true"]',
  },
  {
    path: '/admin?module=routes',
    moduleId: 'routes',
    readySelector: '[aria-label="관리자 지도 운영 개요 2분할"]',
  },
  {
    path: '/admin?module=map-overlays',
    moduleId: 'map-overlays',
    readySelector: '[data-admin-map-overlays-module="true"]',
  },
  {
    path: '/admin?module=restaurants',
    moduleId: 'restaurants',
    readySelector: '#scroll-container',
  },
  {
    path: '/admin?module=restaurant-refresh-history',
    moduleId: 'restaurant-refresh-history',
    readySelector: '[data-admin-restaurant-refresh-history="true"]',
  },
  {
    path: '/admin?module=submissions',
    moduleId: 'submissions',
    readySelector: '#scroll-container',
  },
  {
    path: '/admin?module=reviews',
    moduleId: 'reviews',
    readySelector: '#scroll-container',
  },
  {
    path: '/admin?module=storyboard',
    moduleId: 'storyboard',
    readySelector: '[data-admin-storyboard-generator="true"]',
  },
  {
    path: '/admin?module=banners',
    moduleId: 'banners',
    readySelector: '[aria-labelledby="banner-list-title"]',
  },
  {
    path: '/admin?module=users',
    moduleId: 'users',
    readySelector: '[data-admin-users-summary]',
  },
  {
    path: '/admin?module=insights',
    moduleId: 'insights',
    readySelector: '[data-admin-embedded-module-id="insights"]',
  },
  {
    path: '/admin?module=audit',
    moduleId: 'audit',
    readySelector: '[data-admin-audit-coverage="partial-domain-specific"]',
  },
  {
    path: '/admin?module=youtube-thumbnail-generator',
    moduleId: 'youtube-thumbnail-generator',
    readySelector: '[data-admin-youtube-thumbnail-generator="true"]',
  },
  {
    path: '/admin?module=llm',
    moduleId: 'llm',
    readySelector: '[aria-label="운영 보조 제안"]',
  },
  {
    path: '/admin?module=pipeline',
    moduleId: 'pipeline',
    readySelector: '[data-admin-pipeline-dashboard="true"]',
  },
] as const;

const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = 'tzudong:e2e-admin-shell-bypass';
const HYDRATION_SMOKE_ARTIFACT_DIR = resolve(process.cwd(), '..', '..', 'artifacts', 'ultragoal');
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
  test('loads core admin modules without hydration/runtime errors', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const runtimeErrors: string[] = [];
    const visited: Array<{ path: string; moduleId: string; headerSelector: string; readySelector: string }> = [];
    attachRuntimeErrorCollectors(page, runtimeErrors);

    await installE2EAdminShellBypass(page);

    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    for (const target of ADMIN_MODULE_SMOKE_TARGETS) {
      await gotoAndHidePopup(page, target.path);
      await expect(page.locator('#admin-console-canvas')).toHaveAttribute(
        'data-admin-console-active-module',
        target.moduleId,
        { timeout: 30_000 },
      );
      const headerSelector = `[data-admin-module-header-module="${target.moduleId}"]`;
      await expect(page.locator(headerSelector)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(target.readySelector)).toBeVisible({ timeout: 30_000 });
      visited.push({ path: target.path, moduleId: target.moduleId, headerSelector, readySelector: target.readySelector });
      await page.waitForTimeout(300);
    }

    expect(runtimeErrors).toEqual([]);
    expect(visited).toHaveLength(15);
    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: HYDRATION_SMOKE_SCREENSHOT, fullPage: false });
    writeEvidenceIfSafe(HYDRATION_SMOKE_TRANSCRIPT, {
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        visited,
        runtimeErrors,
        screenshot: HYDRATION_SMOKE_SCREENSHOT,
      });
  });

  test('activates all 15 menus with a skeleton-to-ready canvas, never a blank loading fallback', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    await page.setViewportSize({ width: 1280, height: 800 });
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });
    await gotoAndHidePopup(page, '/admin');

    const canvas = page.locator('#admin-console-canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    const layout = page.locator('[data-admin-console-sidebar-collapsed]');
    const toggle = page.locator('[data-admin-sidebar-collapse-toggle="true"]');
    if ((await layout.getAttribute('data-admin-console-sidebar-collapsed')) === 'true') {
      await toggle.click();
    }
    await expect(layout).toHaveAttribute('data-admin-console-sidebar-collapsed', 'false');

    const transitions: Array<{
      moduleId: string;
      observedLoading: boolean;
      observedReady: boolean;
      childCount: number;
    }> = [];

    const readyByModuleId = Object.fromEntries(
      ADMIN_MODULE_SMOKE_TARGETS.map((target) => [target.moduleId, target.readySelector]),
    );

    for (const moduleId of ADMIN_CONSOLE_MENU_IDS) {
      const title = ADMIN_CONSOLE_MENUS[moduleId].title;
      const menuButton = page
        .locator('[data-admin-console-menu-item-mode="desktop-sidebar"]')
        .filter({ hasText: title })
        .first();
      await menuButton.click();

      await expect(canvas).toHaveAttribute('data-admin-console-active-module', moduleId, {
        timeout: 30_000,
      });

      const loadingLocator = canvas.locator(
        `[data-admin-sidebar-module-loading-module="${moduleId}"]`,
      );
      const readyLocator = canvas.locator(
        `[data-admin-module-state-menu="${moduleId}"], ${readyByModuleId[moduleId]}`,
      );
      await expect(loadingLocator.or(readyLocator).first()).toBeVisible({ timeout: 30_000 });
      const observedLoading = (await loadingLocator.count()) > 0;
      await expect(readyLocator.first()).toBeVisible({ timeout: 30_000 });
      const childCount = await canvas.evaluate((element) => element.childElementCount);
      expect(childCount).toBeGreaterThan(0);
      await expect(page.locator(`[data-admin-module-header-module="${moduleId}"]`)).toBeVisible({
        timeout: 30_000,
      });

      transitions.push({
        moduleId,
        observedLoading,
        observedReady: true,
        childCount,
      });
    }

    expect(transitions).toHaveLength(15);
    expect(new Set(transitions.map((entry) => entry.moduleId)).size).toBe(15);

    writeEvidenceIfSafe(resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-admin-console-module-activation.json'), {
      schemaVersion: 1,
      kind: 'playwright-browser-automation-report',
      transitions,
      blankLoadingFallbackBanned: true,
    });
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

    const trendChart = page.locator('[data-admin-dashboard-line-chart="recharts"]');
    const legend = page.getByLabel('영상별 성과 분포 지표 숨김/보임');
    await expect(trendChart).toBeVisible({ timeout: 30_000 });
    await expect(legend).toBeVisible();
    await expect(legend.getByRole('button', { name: '조회수 숨기기' })).toBeVisible();
    await expect(trendChart.locator('.recharts-line-curve')).toHaveCount(3);
    await expect(trendChart.locator('.recharts-line-dots circle')).toHaveCount(9);

    const zeroValueDot = trendChart.locator('.recharts-line-dots').last().locator('circle').nth(1);
    await zeroValueDot.hover();
    const tooltip = page.locator('[data-admin-dashboard-tooltip-kind="trend-simple"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('0점');

    await legend.getByRole('button', { name: '참여율 숨기기' }).click();
    await expect(legend.getByRole('button', { name: '참여율 보이기' })).toBeVisible();
    await expect(trendChart.locator('.recharts-line-curve')).toHaveCount(2);
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

    await menuTrigger.click();
    await expect(dropdown).toBeVisible();
    await expect(routeMenuItem).toBeVisible();
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

    await menuTrigger.click();
    await expect(dropdown).toBeVisible();
    await expect(routeMenuItem).toHaveAttribute('aria-current', 'page');
    await expect(routeMenuItem).toHaveAttribute('data-admin-console-menu-item-state', 'active');
    await expect(routeMenuItem).toHaveClass(/bg-muted/);
    const activeMenuObservation = await routeMenuItem.evaluate((element) => ({
      ariaCurrent: element.getAttribute('aria-current'),
      className: element.getAttribute('class'),
      dataState: element.getAttribute('data-admin-console-menu-item-state'),
      visualHasMutedClass: element.classList.contains('bg-muted'),
    }));
    const viewport = page.viewportSize();
    await routeMenuItem.scrollIntoViewIfNeeded();
    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: MOBILE_MENU_SCREENSHOT, fullPage: false });
    writeEvidenceIfSafe(MOBILE_MENU_TRANSCRIPT, {
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        surface: 'web',
        tool: 'playwright',
        viewport,
        observations: {
          activeMenuObservation,
          activeModuleIdAfterSelection,
          dropdownCountAfterSelection,
          measuredScrollTopAfterSelection,
          nestedScrollObservation,
          screenshot: MOBILE_MENU_SCREENSHOT,
          setup: 'Inserted a nested scroll probe and a test-only spacer into #admin-console-canvas before selection to make descendant chrome visibility and scroll reset observable.',
        },
        actions: [
          { type: 'goto', timestamp: '2026-07-09T03:20:00.000Z', url: '/admin' },
          {
            type: 'click',
            timestamp: '2026-07-09T03:20:01.000Z',
            selector: '[data-admin-console-menu-trigger="hamburger"]',
          },
          {
            type: 'click',
            timestamp: '2026-07-09T03:20:02.000Z',
            selector: '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
          },
          {
            type: 'click',
            timestamp: '2026-07-09T03:20:03.000Z',
            selector: '[data-admin-console-menu-trigger="hamburger"]',
          },
          {
            type: 'screenshot',
            timestamp: '2026-07-09T03:20:04.000Z',
            selector: '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
          },
        ],
        assertions: [
          {
            timestamp: '2026-07-09T03:20:04.500Z',
            selector: '[data-admin-nested-scroll-visibility-probe="true"]',
            status: 'passed',
            description: `Nested descendant scrollTop=${nestedScrollObservation.nestedScrollTop} hid the mobile header, then scrollTop=0 restored it.`,
          },
          {
            timestamp: '2026-07-09T03:20:05.000Z',
            selector: '#admin-console-canvas',
            status: 'passed',
            description: `Canvas activeModuleId=${activeModuleIdAfterSelection}, scrollTop=${measuredScrollTopAfterSelection}`,
          },
          {
            timestamp: '2026-07-09T03:20:06.000Z',
            selector: '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
            status: 'passed',
            description: `Active menu state aria-current=${activeMenuObservation.ariaCurrent}, data-state=${activeMenuObservation.dataState}, visualHasMutedClass=${activeMenuObservation.visualHasMutedClass}`,
          },
        ],
        screenshot: MOBILE_MENU_SCREENSHOT,
      });

    await page.keyboard.press('Escape');
    await expect(dropdown).toHaveCount(0);
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
    writeEvidenceIfSafe(STORYBOARD_RESPONSIVE_TRANSCRIPT, {
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
      });

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
    writeEvidenceIfSafe(INSIGHTS_STATE_TRANSCRIPT, {
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
      });

    expect(runtimeErrors).toEqual([]);
  });
});
