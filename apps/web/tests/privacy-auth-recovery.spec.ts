import { expect, test, type Page } from '@playwright/test';
import { hidePopupOverlay } from './helpers';

const POLICY_ID = '11111111-1111-4111-8111-111111111111';
const POLICY_SHA = 'a'.repeat(64);

async function mockCurrentPolicy(page: Page, onPost?: (body: Record<string, unknown>) => void) {
  await page.route('**/api/privacy/onboarding', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: POLICY_ID, contentSha256: POLICY_SHA }),
      });
      return;
    }

    const body = route.request().postDataJSON() as Record<string, unknown>;
    onPost?.(body);
    if (body.action === 'password_signup') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ emailConfirmationRequired: true }),
      });
      return;
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ oauthNonce: 'b'.repeat(64) }),
    });
  });
}

async function openSignup(page: Page) {
  await page.goto('/privacy/onboarding');
  await expect(page.getByRole('tab', { name: '회원가입' })).toHaveAttribute('data-state', 'active');
  await page.getByLabel('이메일', { exact: true }).fill('new@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('password1');
  await page.getByLabel('비밀번호 확인').fill('password1');
  await page.locator('#signup-username').fill('new-user');
  await page.getByRole('radio', { name: '만 14세 이상입니다' }).check();
  await page.locator('#privacy-agree').click();
}

test.describe('privacy auth recovery browser contracts', () => {
  test('new password signup binds a current-policy challenge before confirmation can proceed', async ({ page }) => {
    const posts: Array<Record<string, unknown>> = [];
    await mockCurrentPolicy(page, (body) => posts.push(body));
    await openSignup(page);

    await page.getByRole('button', { name: '회원가입' }).click();

    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      intent: 'password',
      policyVersion: POLICY_ID,
      ageBand: 'age_14_plus',
      policyAcknowledged: true,
    });
  });

  test('new OAuth signup cannot start until its current-policy nonce challenge succeeds', async ({ page }) => {
    const posts: Array<Record<string, unknown>> = [];
    await mockCurrentPolicy(page, (body) => posts.push(body));
    await page.route('**/auth/v1/authorize**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await openSignup(page);

    await page.getByRole('button', { name: 'Google 개인정보 확인 계속하기' }).click();

    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      intent: 'oauth',
      policyVersion: POLICY_ID,
      ageBand: 'age_14_plus',
    });
  });

  test('existing password authentication failure does not fabricate a privacy recovery session', async ({ page }) => {

    await page.goto('/');
    await hidePopupOverlay(page);
    await page.getByRole('button', { name: /로그인/i }).first().click();
    await page.locator('#login-email').fill('existing@example.test');
    await page.locator('#login-password').fill('password1');
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await expect(page.getByRole('status')).toContainText('로그인에 실패했습니다');
  });

  test('existing OAuth login does not mint a privacy onboarding challenge without a freshness signal', async ({ page }) => {
    let onboardingPosts = 0;
    await mockCurrentPolicy(page, () => { onboardingPosts += 1; });
    await page.route('**/auth/v1/authorize**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await hidePopupOverlay(page);
    await page.getByRole('button', { name: /로그인/i }).first().click();
    await page.getByRole('button', { name: 'Google로 계속하기' }).click();

    await page.waitForTimeout(100);
    expect(onboardingPosts).toBe(0);
  });

  test('ambiguous OAuth callbacks are rejected before provider exchange', async ({ page }) => {
    let providerRequests = 0;
    await page.route('**/auth/v1/**', async (route) => {
      providerRequests += 1;
      await route.abort();
    });

    const response = await page.goto('/auth/callback?code=first&code=second');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    expect(providerRequests).toBe(0);
  });

  test('OAuth callback provider errors and nonce replay-shaped duplicate values are rejected', async ({ page }) => {
    let providerRequests = 0;
    await page.route('**/auth/v1/**', async (route) => {
      providerRequests += 1;
      await route.abort();
    });

    await page.goto('/auth/callback?error=access_denied&code=replayed');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/auth/callback?code=replayed&next=%2Fsafe&next=%2Fadmin');
    await expect(page).toHaveURL(/\/$/);
    expect(providerRequests).toBe(0);
  });

  test('incomplete sessions keep the literal loop-safe onboarding route, but protected admin and API surfaces deny access', async ({ page, request }) => {
    await page.goto('/privacy/onboarding');
    await expect(page).toHaveURL(/\/privacy\/onboarding$/);

    const apiResponse = await request.get('/api/privacy/consents');
    expect(apiResponse.status()).toBeGreaterThanOrEqual(400);

    const adminResponse = await request.get('/admin', { maxRedirects: 0 });
    expect([302, 307, 308, 401, 403, 503]).toContain(adminResponse.status());
  });

  test('password recovery rejects ambiguous query authority before a password can be updated', async ({ page }) => {
    await page.goto('/auth/reset-password?code=one&token=two&type=recovery');
    await expect(page.getByText(/이 페이지는 이메일로 받은 비밀번호 재설정 링크를 통해 접속해야/)).toBeVisible();
    await expect(page.getByRole('button', { name: '비밀번호 변경', exact: true })).toHaveCount(0);
  });
});
