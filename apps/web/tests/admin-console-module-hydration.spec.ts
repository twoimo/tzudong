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
});
