/** Isolated, synthetic, read-only legacy-route verification. Requires the owned loopback preview. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeForTestingExecutable } from '../tests-unit/fixtures/chrome-for-testing.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.ADMIN_AUDIT_OUTPUT_DIR;
if (!output || !isAbsolute(output)) throw new Error('ABSOLUTE_AUDIT_OUTPUT_REQUIRED');
const base = 'http://127.0.0.1:18794';
const sourcePaths = ['app/admin/evaluations/page.tsx', 'app/admin/submissions/page.tsx', 'app/admin/banners/page.tsx', 'app/admin/privacy-incidents/page.tsx', 'app/app-globals.css', 'components/admin/AdminConsoleOverview.tsx', 'styles/admin-ui.css', 'lib/admin/admin-module-routing.ts', 'scripts/preview-design-fixtures.mjs', 'scripts/verify-admin-legacy-routes-browser.ts'];
const signature = () => createHash('sha256').update(sourcePaths.map(path => `${path}:${createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')}`).join('\n')).digest('hex');
const sourceBefore = signature();
const browser = await chromium.launch({ headless: true, executablePath: chromeForTestingExecutable() });
const context = await browser.newContext({ reducedMotion: 'reduce' });
const blocked: Array<{ method: string; endpoint: string; external: boolean }> = [];
const allowedOrigins = new Set([base, 'http://127.0.0.1:18793']);
const readPosts = new Set(['/api/admin/profile-summaries', '/rest/v1/rpc/read_public_profile_summaries', '/rest/v1/rpc/read_public_profile_leaderboard_page', '/rest/v1/rpc/get_current_privacy_eligibility', '/rest/v1/rpc/is_current_auth_session_active']);
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  const allowed = allowedOrigins.has(url.origin);
  if (allowed && (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || request.method() === 'POST' && readPosts.has(url.pathname))) return route.continue();
  blocked.push({ method: request.method(), endpoint: url.pathname, external: !allowed });
  return route.abort();
});
await context.addInitScript(() => localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1'));
const page = await context.newPage();
const contracts = [
  { source: '/admin/evaluations', destination: '/admin?module=restaurants', title: '맛집 관리' },
  { source: '/admin/submissions', destination: '/admin?module=submissions', title: '제보 관리' },
  { source: '/admin/banners', destination: '/admin/banners', title: '배너 관리' },
  { source: '/admin/privacy-incidents', destination: '/admin/privacy-incidents', title: '개인정보 사고 대응' },
  { source: '/admin?module=restaurant-refresh-history', destination: '/admin?module=restaurants&restaurantView=refresh', title: '맛집 관리' },
];
const results = [];
try {
  await page.goto(base + '/__fixture/session', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  for (const contract of contracts) for (const width of [390, 834, 1423]) {
    await page.setViewportSize({ width, height: 960 });
    const errors: string[] = [];
    const capture = (error: Error) => errors.push(error.name);
    page.on('pageerror', capture);
    let ready = true;
    try {
      await page.goto(base + contract.source, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(({ destination, title }) => {
        const heading = [...document.querySelectorAll('h1')].some(element => element.getBoundingClientRect().width > 0 && element.textContent?.trim() === title);
        const actual = location.pathname + location.search;
        const busy = [...document.querySelectorAll('[aria-busy="true"]')].some(element => element.getBoundingClientRect().width > 0);
        const privacyReady = destination !== '/admin/privacy-incidents' || document.body.innerText.includes('표시할 사고가 없습니다.');
        return actual === destination && heading && !busy && privacyReady;
      }, contract, { timeout: 45_000 });
    } catch { ready = false; }
    const state = await page.evaluate(() => ({
      url: location.pathname + location.search,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewport: innerWidth,
      hasMain: Boolean(document.querySelector('main')),
      headings: [...document.querySelectorAll('h1')].filter(element => element.getBoundingClientRect().width > 0).map(element => element.textContent?.trim()),
      visibleErrorBoundary: [...document.querySelectorAll('button')].some(element => element.textContent?.includes('다시 시도') && element.getBoundingClientRect().width > 0),
      incidentReadFailed: document.body.innerText.includes('사고 목록을 불러오지 못했습니다.'),
    }));
    const screenshot = `compat-${contracts.indexOf(contract)}-${width}.png`;
    await page.screenshot({ path: resolve(output, screenshot) });
    page.off('pageerror', capture);
    const row = { pathname: contract.source, width, ready, ...state, errors, screenshot };
    results.push(row);
    console.log(JSON.stringify(row));
  }
} finally { await browser.close(); }
const sourceAfter = signature();
const passed = sourceBefore === sourceAfter && results.length === 15 && results.every(row => row.ready && !row.errors.length && row.documentWidth <= row.viewport + 1 && row.bodyWidth <= row.viewport + 1 && !row.visibleErrorBoundary && !row.incidentReadFailed && row.hasMain);
writeFileSync(resolve(output, 'compatibility-20261113.json'), JSON.stringify({ synthetic: true, readOnly: true, sourceBefore, sourceAfter, sourceStable: sourceBefore === sourceAfter, passed, blocked, results }, null, 2));
console.log(JSON.stringify({ passed, cases: results.length, sourceStable: sourceBefore === sourceAfter }));
if (!passed) process.exitCode = 1;
