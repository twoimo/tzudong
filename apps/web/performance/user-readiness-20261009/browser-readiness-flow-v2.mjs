import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { fixtureQuery } from './fixture-query-v6.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = new URL(`browser-readiness-${process.argv[2] ?? 'v1'}.json`, import.meta.url);
const distDir = process.env.TZUDONG_NEXT_DIST_DIR ?? '.next-user-readiness-v1';
const origin = 'http://localhost:3000';
const restaurant = '00000000-0000-4000-8000-000000000001';
const policyId = '11111111-1111-4111-8111-111111111111';
const policyHash = '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b';
const rows = Array.from({ length: 735 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: `실험맛집${String(i).padStart(4, '0')}`, approved_name: `실험맛집${String(i).padStart(4, '0')}`,
  lat: 37.5 + (i % 40) * .003, lng: 126.96 + Math.floor(i / 40) * .003,
  road_address: `서울특별시 중구 실험로 ${i + 1}`, categories: ['한식'], status: 'approved',
  created_at: '2026-09-01T00:00:00Z', review_count: 0, weekly_search_count: 735 - i,
  youtube_link: null, youtube_meta: null,
}));
const result = { startedAtUtc: new Date().toISOString(), distDir, node: process.version,
  productionBuild: true, data: 'synthetic REST735 / anonymous Auth401', fieldAdmission: 0,
  actualAccountCreated: false, actualReviewWritten: false, physicalDevice: false,
  fixtureSha256: createHash('sha256').update(readFileSync(new URL('./fixture-query-v6.mjs', import.meta.url))).digest('hex'),
  cases: [], errors: { page: 0, console: 0, unsupportedFixture: 0, fixtureShapes: [], consoleKinds: {} }, passed: false };
let server, browser;
try {
  if (!process.version.startsWith('v24.')) throw Error('PINNED_NODE_REQUIRED');
  let occupied = false;
  try { occupied = Boolean(execFileSync('lsof', ['-tiTCP:3000', '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
  if (occupied) throw Error('OWNED_PORT_UNAVAILABLE');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', TZUDONG_NEXT_DIST_DIR: distDir }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error('OWNED_SERVER_STOPPED');
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (i === 99) throw Error('OWNED_SERVER_UNAVAILABLE');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  result.browserVersion = await browser.version();
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 1024, hasTouch: viewport.width < 1024, serviceWorkers: 'block', locale: 'ko-KR' });
    const page = await context.newPage();
    const counts = { oauth: 0, onboarding: 0, unauthorizedWrites: 0 };
    let observedNext = null;
    page.on('pageerror', () => result.errors.page++);
    page.on('console', message => {
      if (message.type() !== 'error') return;
      result.errors.console++;
      const kind = /Content Security Policy/i.test(message.text()) ? 'CSP' : /status of (?:400|401|503)/.test(message.text()) ? 'httpFixture' : 'other';
      result.errors.consoleKinds[kind] = (result.errors.consoleKinds[kind] ?? 0) + 1;
    });
    await page.route('https://localhost:3000/**', async route => {
      const url = new URL(route.request().url()); url.protocol = 'http:';
      if (route.request().method() !== 'GET') return route.abort();
      const reply = await fetch(url), headers = Object.fromEntries(reply.headers);
      delete headers['content-encoding']; delete headers['content-length'];
      return route.fulfill({ status: reply.status, headers, body: Buffer.from(await reply.arrayBuffer()) });
    });
    await page.route('**/_vercel/**', route => route.abort());
    await page.route('**/api/performance/**', route => route.fulfill({ status: 204 }));
    await page.route('**/auth/v1/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/authorize')) {
        counts.oauth++;
        const callback = new URL(url.searchParams.get('redirect_to'));
        observedNext = callback.searchParams.get('next');
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Local intercepted OAuth destination</p>' });
      }
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'session_not_found', message: 'fixture' }) });
    });
    await page.route('**/rest/v1/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) { counts.unauthorizedWrites++; return route.abort(); }
      const url = new URL(route.request().url());
      let data = [], total = 0;
      if (url.pathname.endsWith('/restaurants')) {
        try { const reply = fixtureQuery(rows, url.searchParams); data = reply.data; total = reply.total; }
        catch (error) {
          result.errors.unsupportedFixture++;
          result.errors.fixtureShapes.push({ code: /^fixture_[a-z_]+$/.test(error.message) ? error.message : 'other',
            select: url.searchParams.get('select'), order: url.searchParams.get('order'), columns: [...url.searchParams.keys()] });
          return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
        }
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `${data.length ? `0-${data.length - 1}` : '*'}/${total}` }, body: JSON.stringify(data) });
    });
    await page.route('**/api/privacy/onboarding', route => {
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: policyId, contentSha256: policyHash }) });
      counts.onboarding++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'FIXTURE_DECLINED' }) });
    });
    const expectedNext = `/stamp?restaurant=${restaurant}&writeReview=1`;
    await page.goto(`${origin}/stamp?restaurant=${restaurant}&writeReview=1&__qa=readiness`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[id$="email"]').first()).toBeVisible({ timeout: 30000 });
    const location = new URL(page.url());
    if (location.searchParams.get('reason') !== 'review' || location.searchParams.get('next') !== expectedNext) throw Error('GUEST_CONTINUATION_MISMATCH');
    result.cases.push({ viewport, case: 'guest Stamp review opens login with selected restaurant continuation', passed: true });
    await page.getByText('Google로 계속하기', { exact: true }).first().click();
    await expect.poll(() => counts.oauth).toBe(1);
    if (observedNext !== expectedNext) throw Error('OAUTH_CONTINUATION_MISMATCH');
    result.cases.push({ viewport, case: 'OAuth callback preserves explicit review continuation', passed: true, providerNavigationIntercepted: true });

    await page.goto(`${origin}/?auth=login&reason=mypage&next=%2Fmypage%2Freviews&__qa=readiness`);
    await expect(page.locator('input[id$="email"]').first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('tab', { name: '회원가입', exact: true }).click();
    await page.locator('#signup-email').fill('fixture@example.invalid');
    await page.locator('#signup-password').fill('fixture-long-password-2026');
    await page.locator('#confirm-password').fill('fixture-long-password-2026');
    await page.getByLabel('만 14세 이상입니다', { exact: true }).check();
    await page.locator('#privacy-agree').click();
    await page.getByRole('button', { name: '회원가입', exact: true }).click();
    await expect.poll(() => counts.onboarding).toBe(1);
    result.cases.push({ viewport, case: 'password longer than 12 characters reaches the bounded onboarding path', passed: true, onboardingInterceptedAndDeclined: true });
    if (counts.unauthorizedWrites !== 0) throw Error('UNEXPECTED_PROVIDER_WRITE');
    await context.close();
  }
  const anonymous = await fetch(`${origin}/api/admin/review-verification/${restaurant}`);
  if (anonymous.status !== 401) throw Error('PRIVATE_IMAGE_AUTH_BOUNDARY');
  result.cases.push({ case: 'compiled private verification route rejects anonymous request', passed: true, status: anonymous.status });
  result.passed = result.errors.page === 0 && result.errors.unsupportedFixture === 0;
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  result.failureCode = /^[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_FLOW_UNCONFIRMED';
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await stopped; }
  result.endedAtUtc = new Date().toISOString();
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, errors: result.errors, failureCode: result.failureCode ?? null }));
}
