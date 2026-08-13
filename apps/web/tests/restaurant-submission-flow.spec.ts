import { test, expect } from './nightly/nightly-test';
import { hidePopupOverlay } from './helpers';

const SUPABASE_AUTH_COOKIE_NAME = process.env.NIGHTLY_OFFLINE === '1'
  ? 'sb-127-auth-token'
  : 'sb-aqlcofblfxdrjhhdmarw-auth-token';

test.describe('G003 restaurant submission flow contracts', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
  });

  test('valid step transitions stay local and final submit posts through server route', async ({ page }) => {
    let submitRequests = 0;
    let latestSubmitBody: unknown = null;

    const fakeUser = {
      id: '00000000-0000-4000-8000-000000000003',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'g003-submission@example.test',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { nickname: 'G003 QA' },
    };
    const fakeSession = {
      access_token: 'g003-test-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'g003-refresh-token',
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
    await page.route('**/api/mypage/submissions/submit', async (route) => {
      submitRequests += 1;
      latestSubmitBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, mode: 'new', id: 'submission-e2e', status: 'pending' }),
      });
    });

    await page.addInitScript(() => {
      const events: unknown[] = [];
      Object.defineProperty(window, '__TZUDONG_SUBMISSION_STEP_EVENTS__', {
        configurable: true,
        value: events,
      });
      window.addEventListener('restaurant-submission.step-transition', (event) => {
        events.push(event instanceof CustomEvent ? event.detail : null);
      });
    });

    await page.goto('/');
    await hidePopupOverlay(page);

    await page.getByLabel('맛집 제보하기').click();
    const panel = page.locator('[data-desktop-map-submission-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15000 });

    await panel.getByLabel(/맛집 이름/).fill('G003 원자성 분식');
    await panel.getByRole('button', { name: '분식' }).click();
    await panel.getByLabel(/주소/).fill('서울특별시 중구 세종대로 110');
    await panel.getByLabel(/전화번호/).fill('02-1234-5678');

    await panel.getByRole('button', { name: '다음' }).click();
    await expect(panel).toContainText('2 / 3');
    expect(submitRequests).toBe(0);

    const stepEvents = await page.evaluate(() => (
      window as typeof window & { __TZUDONG_SUBMISSION_STEP_EVENTS__?: Array<{ fromStep?: number; toStep?: number; durationMs?: number }> }
    ).__TZUDONG_SUBMISSION_STEP_EVENTS__ ?? []);
    expect(stepEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStep: 1, toStep: 2 }),
    ]));
    expect(Number(stepEvents[0]?.durationMs)).toBeGreaterThanOrEqual(0);

    await panel.getByLabel(/유튜브 영상 링크/).fill('https://youtube.com/watch?v=g003submission');
    await panel.getByLabel(/쯔양의 리뷰/).fill('서버 원자성 검증을 위한 제보 메모입니다.');
    await panel.getByRole('button', { name: '다음' }).click();
    await expect(panel).toContainText('3 / 3');

    await page.screenshot({
      path: 'test-results/g003-submission-step-transition.png',
      fullPage: true,
    });

    await panel.getByRole('button', { name: '제보하기' }).click();
    await expect.poll(() => submitRequests).toBe(1);
    expect(latestSubmitBody).toMatchObject({
      mode: 'new',
      payload: {
        restaurant_name: 'G003 원자성 분식',
        address: '서울특별시 중구 세종대로 110',
        phone: '02-1234-5678',
      },
    });
    expect(String((latestSubmitBody as { clientRequestKey?: unknown }).clientRequestKey ?? '')).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  });
});
