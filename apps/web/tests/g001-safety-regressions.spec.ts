import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup, hidePopupOverlay } from './helpers';

const SUPABASE_AUTH_COOKIE_NAME = 'sb-aqlcofblfxdrjhhdmarw-auth-token';
const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = 'tzudong:e2e-admin-shell-bypass';

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

function writeReceiptFixture() {
  const fixtureDir = resolve(process.cwd(), 'test-results');
  const fixturePath = resolve(fixtureDir, 'g001-receipt-fixture.png');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    fixturePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  return fixturePath;
}

async function installFakeSession(page: Page, email = 'g001-live@example.test') {
  const fakeUser = {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { nickname: 'G001 QA' },
  };
  const fakeSession = {
    access_token: 'g001-test-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'g001-refresh-token',
    user: fakeUser,
  };
  const encodedSession = Buffer.from(JSON.stringify(fakeSession), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  await page.context().addCookies([{
    name: SUPABASE_AUTH_COOKIE_NAME,
    value: `base64-${encodedSession}`,
    domain: 'localhost',
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }]);

  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeUser),
    });
  });
}

async function installBasicRestMocks(page: Page) {
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rest/v1/user_roles')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'admin' }) });
      return;
    }
    if (url.pathname.endsWith('/rest/v1/profiles')) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test.describe('G001 safety regression live proofs', () => {
  test('admin user details stay blank until explicit selection and clear after filtered reload', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await installE2EAdminShellBypass(page);
    await page.setExtraHTTPHeaders({
      [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
      [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    });

    const users = [{
      id: 'admin-user-live-1',
      email: 'admin-user-live-1@example.test',
      username: 'admin-live-1',
      nickname: '라이브 관리자',
      avatarUrl: null,
      profileRole: 'admin',
      isAdmin: true,
      isDisabled: false,
      bannedUntil: null,
      createdAt: '2026-07-08T00:00:00.000Z',
      lastSignInAt: '2026-07-08T01:00:00.000Z',
      emailConfirmedAt: '2026-07-08T00:10:00.000Z',
      statusLabel: '활성',
      roleLabel: '관리자',
    }];

    await page.route('**/api/admin/users**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
        return;
      }
      const url = new URL(route.request().url());
      const isMissingSearch = url.searchParams.get('search') === 'missing-user';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: isMissingSearch ? [] : users,
          summary: {
            loadedUsers: isMissingSearch ? 0 : users.length,
            adminUsers: isMissingSearch ? 0 : 1,
            disabledUsers: 0,
            unconfirmedUsers: 0,
          },
          page: 1,
          perPage: 50,
          total: isMissingSearch ? 0 : users.length,
        }),
      });
    });

    await gotoAndHidePopup(page, '/admin?module=users');
    await expect(page.locator('#admin-console-canvas')).toHaveAttribute('data-admin-console-active-module', 'users', { timeout: 30_000 });
    await expect(page.getByText('사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '라이브 관리자 상세 보기' })).toBeVisible();

    await page.screenshot({ path: 'test-results/g001-admin-users-explicit-selection.png', fullPage: true });

    await page.getByRole('button', { name: '라이브 관리자 상세 보기' }).click();
    await expect(page.getByLabel('닉네임').last()).toHaveValue('라이브 관리자');

    await page.getByLabel('닉네임, 이메일, 사용자 ID로 검색').fill('missing-user');
    await page.getByRole('button', { name: '검색' }).click();
    await expect(page.getByText('조건에 맞는 사용자가 없습니다. 필터를 줄이거나 전체 보기로 돌아가세요.')).toBeVisible();
    await expect(page.getByText('사용자를 선택하면 상세 정보와 변경 작업이 표시됩니다.')).toBeVisible();
    await page.screenshot({ path: 'test-results/g001-admin-users-filter-clears-selection.png', fullPage: true });
  });

  test('review OCR surface shows safe copy without dev-admin forced wording', async ({ page }) => {
    test.setTimeout(60_000);
    await installFakeSession(page, 'g001-review@example.test');
    await installBasicRestMocks(page);
    await page.route('**/api/ocr/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ remaining: 9, max: 9, unlimited: true }),
      });
    });

    await page.goto('/feed');
    await hidePopupOverlay(page);
    await page.getByLabel('리뷰 작성').click();
    await expect(page.getByText('OCR 다시 분석')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/dev\/admin|강제 재호출/)).toHaveCount(0);
    await page.getByText('OCR 다시 분석').click();
    await expect(page.getByText('이번 분석은 캐시 없이 재호출')).toBeVisible();
    await page.screenshot({ path: 'test-results/g001-review-ocr-safe-copy.png', fullPage: true });
  });

  test('mobile review category popover remains interactive inside modal bottom sheet', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const receiptFixture = writeReceiptFixture();
    await installFakeSession(page, 'g001-review-mobile@example.test');
    await installBasicRestMocks(page);
    await page.route('**/api/ocr/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ remaining: 9, max: 9, unlimited: true }),
      });
    });

    await page.goto('/feed');
    await hidePopupOverlay(page);
    await page.getByLabel('리뷰 작성').click();
    await expect(page.getByRole('heading', { name: '쯔동여지도 리뷰 작성' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '사진만 첨부' }).click();
    await page.locator('input[type="file"]').first().setInputFiles(receiptFixture);
    await expect(page.getByRole('button', { name: /사진 제거/ })).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByText('방문한 쯔양 맛집')).toBeVisible();
    await page.getByRole('button', { name: '어떤 종류의 음식을 드셨나요?' }).click();
    await expect(page.getByText('카테고리 선택')).toBeVisible();
    await page.getByLabel('한식').click();
    await expect(page.getByRole('button', { name: /1개 선택됨/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/g001-review-mobile-category-popover.png', fullPage: true });
  });

  test('mobile modal bottom sheet stops outside pointer leakage on live submission sheet', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await installFakeSession(page, 'g001-submission-mobile@example.test');
    await installBasicRestMocks(page);
    await page.route('**/api/mypage/submissions/submit', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });


    await page.goto('/');
    await hidePopupOverlay(page);
    await page.getByLabel('맛집 제보하기').click();
    await expect(page.getByRole('heading', { name: '쯔동여지도 제보하기' })).toBeVisible({ timeout: 30_000 });

    const pointerResult = await page.evaluate(() => {
      let bubbledCount = 0;
      let listenerSawDefaultPrevented = false;
      const target = document.body;
      const listener = (event: PointerEvent) => {
        bubbledCount += 1;
        listenerSawDefaultPrevented = event.defaultPrevented;
      };
      target.addEventListener('pointerdown', listener);
      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
      const dispatchResult = target.dispatchEvent(event);
      target.removeEventListener('pointerdown', listener);
      return {
        dispatchResult,
        defaultPrevented: event.defaultPrevented,
        bubbledCount,
        listenerSawDefaultPrevented,
      };
    });

    expect(pointerResult.defaultPrevented).toBe(true);
    expect(pointerResult.dispatchResult).toBe(false);
    expect(pointerResult.bubbledCount).toBe(0);
    await expect(page.getByRole('heading', { name: '쯔동여지도 제보하기' })).toBeVisible();
    await page.screenshot({ path: 'test-results/g001-bottom-sheet-pointer-isolation.png', fullPage: true });
  });
});
