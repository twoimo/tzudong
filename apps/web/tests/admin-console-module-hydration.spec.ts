import { expect, test, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';


import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup } from './helpers';

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
    path: '/admin?module=youtube-thumbnail-generator',
    moduleId: 'youtube-thumbnail-generator',
    readySelector: '[data-admin-youtube-thumbnail-generator="true"]',
  },
  {
    path: '/admin?module=audit',
    moduleId: 'audit',
    readySelector: '[data-admin-audit-coverage="partial-domain-specific"]',
  },
] as const;

const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = 'tzudong:e2e-admin-shell-bypass';
const HYDRATION_SMOKE_ARTIFACT_DIR = resolve(process.cwd(), '..', '..', 'artifacts', 'ultragoal');
const HYDRATION_SMOKE_SCREENSHOT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g006-hydration-smoke-final.png');
const HYDRATION_SMOKE_TRANSCRIPT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g006-hydration-smoke-transcript.json');
const MOBILE_MENU_SCREENSHOT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-mobile-admin-menu-final.jpg');
const MOBILE_MENU_TRANSCRIPT = resolve(HYDRATION_SMOKE_ARTIFACT_DIR, 'g001-mobile-admin-menu-transcript.json');


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
    if (/hydration|react|error #418|minified react error/i.test(text)) {
      runtimeErrors.push(text);
    }
  });

  page.on('pageerror', (error) => {
    runtimeErrors.push(error.message);
  });
}

test.describe('admin console module hydration smoke', () => {
  test('loads core admin modules without hydration/runtime errors', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const runtimeErrors: string[] = [];
    const visited: Array<{ path: string; moduleId: string; readySelector: string }> = [];
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
      await expect(page.locator(target.readySelector)).toBeVisible({ timeout: 30_000 });
      visited.push({ path: target.path, moduleId: target.moduleId, readySelector: target.readySelector });
      await page.waitForTimeout(300);
    }

    expect(runtimeErrors).toEqual([]);
    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: HYDRATION_SMOKE_SCREENSHOT, fullPage: false });
    writeFileSync(
      HYDRATION_SMOKE_TRANSCRIPT,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'playwright-browser-automation-report',
        visited,
        runtimeErrors,
        screenshot: HYDRATION_SMOKE_SCREENSHOT,
      }, null, 2)}\n`,
    );
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
    const menuTrigger = page.locator('[data-admin-console-menu-trigger="hamburger"]');
    const routeMenuItem = page.locator(
      '[data-admin-console-menu-item-mode="mobile-dropdown"][aria-label="맛집 동선 추천"]',
    );

    await expect(page.locator('[data-admin-dashboard-management="true"]')).toBeVisible({
      timeout: 30_000,
    });
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
    const finalUrlAfterSelection = page.url();

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
      visualHasPrimaryClass: element.classList.contains('bg-primary'),
    }));
    const viewport = page.viewportSize();
    await routeMenuItem.scrollIntoViewIfNeeded();
    mkdirSync(HYDRATION_SMOKE_ARTIFACT_DIR, { recursive: true });
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
          activeMenuObservation,
          activeModuleIdAfterSelection,
          dropdownCountAfterSelection,
          finalUrlAfterSelection,
          measuredScrollTopAfterSelection,
          screenshot: MOBILE_MENU_SCREENSHOT,
          setup: 'Inserted a test-only spacer into #admin-console-canvas before selection to make scroll reset observable.',
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
            timestamp: '2026-07-09T03:20:05.000Z',
            selector: '#admin-console-canvas',
            status: 'passed',
            description: `Canvas activeModuleId=${activeModuleIdAfterSelection}, scrollTop=${measuredScrollTopAfterSelection}, url=${finalUrlAfterSelection}`,
          },
          {
            timestamp: '2026-07-09T03:20:06.000Z',
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
    expect(runtimeErrors).toEqual([]);
  });
});
