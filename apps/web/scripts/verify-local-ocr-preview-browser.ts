/** Synthetic loopback-only acceptance. Never accepts a user receipt or an external URL. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { chromeForTestingExecutable } from '../tests-unit/fixtures/chrome-for-testing';

const output = process.env.ADMIN_AUDIT_OUTPUT_DIR;
if (!output || !isAbsolute(output)) throw new Error('ABSOLUTE_OUTPUT_REQUIRED');
const base = 'http://127.0.0.1:18794';
const server = 'http://127.0.0.1:18792';
const endpoint = '/api/admin/ocr-receipts/preview';
const fixture = resolve(output, 'synthetic-ocr-receipt.png');
const text = ['영수증 테스트 · 실제 결제 아님', '상호: 테스트식당', '2026-11-13 12:30', '합계 15,000원'];
await sharp(Buffer.from(`<svg width="1000" height="550" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${text.map((line, i) => `<text x="60" y="${90 + i * 110}" font-family="Apple SD Gothic Neo, sans-serif" font-size="42" fill="black">${line}</text>`).join('')}</svg>`)).png().toFile(fixture);
const imageBase64 = readFileSync(fixture).toString('base64');
const statuses: Record<string, number> = {};
const assert = (condition: unknown, code: string) => { if (!condition) throw new Error(code); };
statuses.unauthenticated = (await fetch(server + endpoint)).status;
assert(statuses.unauthenticated === 401, 'AUTH_REJECTION_FAILED');
// The generic read-only design gateway does not model every middleware policy.
// Exercise the real route separately with an isolated auth fixture, then use an
// actual local CLI result to test client rendering without claiming hosted auth.
const nativeRun = spawnSync(process.execPath, ['scripts/preview-receipt-ocr.ts', fixture, '--timeout-ms', '20000'], { encoding: 'utf8', timeout: 30_000 });
assert(nativeRun.status === 0, 'LOCAL_NATIVE_EXECUTION_FAILED');
const nativeResult = JSON.parse(nativeRun.stdout);
assert(nativeResult.cloudCalls === 0 && nativeResult.result?.total_amount === 15000, 'SYNTHETIC_OCR_RESULT_INVALID');
const capability = { localAvailable: true, cloudAvailable: false, persistsResult: false };

const browser = await chromium.launch({ headless: true, executablePath: chromeForTestingExecutable() });
let previewPosts = 0;
const views: Array<Record<string, unknown>> = [];
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1'));
  const readPosts = new Set(['/api/admin/profile-summaries', '/rest/v1/rpc/read_public_profile_summaries', '/rest/v1/rpc/read_public_profile_leaderboard_page', '/rest/v1/rpc/get_current_privacy_eligibility', '/rest/v1/rpc/is_current_auth_session_active']);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (![base, 'http://127.0.0.1:18793'].includes(url.origin)) return route.abort();
    if (url.origin === base && url.pathname === endpoint) {
      if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capability) });
      if (request.method() === 'POST') {
        const body = JSON.parse(request.postData() ?? '{}');
        assert(body.imageBase64 === imageBase64 && body.mimeType === 'image/png' && Object.keys(body).length === 2, 'ONLY_SYNTHETIC_FIXTURE_ALLOWED');
        previewPosts++;
        statuses.preview = 200;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nativeResult) });
      }
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || (request.method() === 'POST' && readPosts.has(url.pathname))) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(base + '/__fixture/session', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const panel = page.locator('[aria-label="로컬 영수증 미리보기"]');
  for (const width of [390, 834, 1423]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(base + '/admin?module=reviews', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await panel.getByRole('button', { name: '파일 미리보기', exact: true }).click();
    await panel.locator('input[type=file]').waitFor({ state: 'visible' });
    await panel.locator('input[type=file]').setInputFiles(fixture);
    await panel.getByRole('button', { name: '로컬에서 인식', exact: true }).click();
    await panel.getByText('15,000원', { exact: true }).waitFor({ timeout: 30_000 });
    assert(await panel.getByText('테스트식당', { exact: true }).count() === 1, 'STORE_NOT_RECOGNIZED');
    assert(await panel.getByText('2026-11-13', { exact: true }).count() === 1, 'DATE_NOT_RECOGNIZED');
    await page.waitForFunction(width => innerWidth === width && document.documentElement.scrollWidth <= width + 1, width);
    const geometry = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: innerWidth, height: rect.height,
        controls: [...element.querySelectorAll('button,input')].map(control => { const r = control.getBoundingClientRect(); return { width: r.width, height: r.height }; }) };
    });
    assert(geometry.left >= 0 && geometry.right <= width + 1, 'PREVIEW_OVERFLOW');
    if (width <= 1023) assert(geometry.controls.every(control => control.height >= 43), 'SMALL_TOUCH_TARGET');
    await panel.screenshot({ path: resolve(output, `ocr-preview-${width}.png`) });
    views.push({ ...geometry });
  }
  await panel.getByRole('button', { name: '비우기', exact: true }).click();
  assert(await panel.getByText('15,000원', { exact: true }).count() === 0, 'RESULT_NOT_CLEARED');
  assert(await panel.locator('input[type=file]').inputValue() === '', 'FILE_NOT_CLEARED');
  assert(statuses.preview === 200 && previewPosts === 3, 'PREVIEW_NOT_CONFIRMED');
  writeFileSync(resolve(output, 'local-ocr-preview-acceptance.json'), JSON.stringify({ synthetic: true, actualLocalVision: true, uiApi: 'synthetic response from actual local CLI; route separately tested with mock auth', hostedWrites: 0, cloudCalls: 0, statuses, previewPosts, views, resultCleared: true }, null, 2));
  console.log(JSON.stringify({ passed: true, statuses, previewPosts, views: views.length, cloudCalls: 0 }));
} finally { await browser.close(); }
