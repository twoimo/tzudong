import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const root = '/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web';
const { chromium } = createRequire(root + '/package.json')('@playwright/test');
const config = JSON.parse(readFileSync('/Users/twoimo/.codex/runtime-cache/sentry-activation-20261015/connection.json'));
const ingest = new URL(config.dsn).origin;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const rows = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 834, height: 1112 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const sends = [];
    let cspBlocked = 0, pageErrors = 0;
    page.on('pageerror', () => pageErrors++);
    page.on('console', m => { if (m.type() === 'error' && m.text().includes('Content Security Policy') && m.text().includes(new URL(ingest).hostname)) cspBlocked++; });
    page.on('response', response => {
      if (new URL(response.url()).origin !== ingest) return;
      const body = response.request().postData() ?? '';
      let header = {};
      try { header = JSON.parse(body.split('\n')[0]); } catch {}
      sends.push({ status: response.status(), eventId: header.event_id ?? null, containsSyntheticPrivate: body.includes('sentry-synthetic-private@example.test'), itemTypes: body.split('\n').flatMap(s => { try { const j = JSON.parse(s); return j.type ? [j.type] : []; } catch { return []; } }) });
    });
    const response = await page.goto('http://localhost:3003/auth/required?reason=mypage&next=%2Fmypage', { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByRole('heading', { name: '로그인이 필요합니다', exact: true }).waitFor({ timeout: 15000 });
    const csp = response.headers()['content-security-policy'];
    if (!csp?.includes(ingest)) throw Error('CSP_INGEST_ORIGIN_MISSING');
    const reply = page.waitForResponse(r => new URL(r.url()).origin === ingest, { timeout: 20000 });
    await page.evaluate(() => setTimeout(() => { throw new TypeError('sentry-synthetic-private@example.test'); }, 0));
    await reply;
    await page.screenshot({ path: new URL('./login-' + viewport.width + '.png', import.meta.url).pathname });
    rows.push({ viewport, status: response.status(), ingestionOriginAllowed: true, cspBlocked, pageErrors, events: sends });
    await context.close();
  }
  writeFileSync(new URL('./browser-smoke-v2.json', import.meta.url), JSON.stringify({ kind: 'local-production-build-actual-sentry-network', browser: browser.version(), sdk: '11.4.0', buildId: readFileSync(root + '/.next-sentry-activation-20261015-v1/BUILD_ID', 'utf8').trim(), sourceCommit: '18400459f85f3fee574db6bdc33159ef8bcc88b2', scope: 'Three independent clean browser contexts; synthetic TypeError. No physical device or field proof. Browser build environment is production; these exact IDs are synthetic and must be excluded from field cohorts.', rows }, null, 2) + '\n');
  console.log(JSON.stringify({ rows: rows.length, statuses: rows.map(r => r.events.map(e => e.status)), sensitiveValuesPresent: rows.some(r => r.events.some(e => e.containsSyntheticPrivate)), cspBlocked: rows.reduce((n, r) => n + r.cspBlocked, 0) }));
} finally { await browser.close(); }
