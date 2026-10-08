import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve('performance/cms-followthrough-20261009');
const processEnv = execFileSync('ps', ['eww', '-p', process.env.CMS_DEV_SERVER_PID ?? '57309', '-o', 'command='], { encoding: 'utf8' });
const token = processEnv.match(/(?:^| )E2E_ADMIN_ROUTE_BYPASS_TOKEN=([^\s]+)/)?.[1];
if (!token) throw new Error('Existing local test bypass unavailable');
const binary = '/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ headless: true, executablePath: existsSync(binary) ? binary : '/Users/twoimo/Applications/Spark.app/Contents/Resources/chromium/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-e2e-admin-bypass': '1', 'x-e2e-admin-bypass-token': token } });
await context.addInitScript(() => { localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1'); });
const page = await context.newPage();
let pageErrorCount = 0, blockedMutationCount = 0;
page.on('pageerror', () => { pageErrorCount++; });
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (!['GET', 'HEAD'].includes(request.method())) { blockedMutationCount++; return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } }); }
  if (url.origin !== 'http://127.0.0.1:19872') return route.fulfill({ status: 503, body: '' });
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/admin/pipeline') return route.fulfill({ json: { source: 'job_api', jobs: [], failures: [] } });
    return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } });
  }
  return route.continue();
});
const report = { evidence: 'local-browser-with-synthetic-read-responses', hostedEvidence: false, modules: [], keyboard: {}, pageErrorCount: 0, blockedMutationCount: 0 };
try {
  await page.goto('http://127.0.0.1:19872/admin?module=llm', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const panel = page.locator('[data-admin-operations-panel]');
  await expect(panel).toBeVisible({ timeout: 30000 });
  const row = panel.locator('[data-operations-row="pipeline"] button');
  await row.focus(); await page.keyboard.press('Enter');
  await expect(panel.locator('[data-operations-inspector]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel.locator('[data-operations-inspector]')).toHaveCount(0);
  await expect(row).toBeFocused();
  report.keyboard.desktopEnterEscapeFocusReturn = true;
  await panel.screenshot({ path: resolve(output, 'operations-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await row.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-operations-drawer]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-operations-drawer]')).toHaveCount(0);
  await expect(row).toBeFocused();
  report.keyboard.mobileDrawerEscapeFocusReturn = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const moduleId of ['overview', 'restaurants', 'submissions', 'reviews', 'users', 'banners', 'insights', 'pipeline', 'knowledge-graph', 'sentry', 'youtube-thumbnail-generator', 'storyboard', 'routes', 'llm', 'audit']) {
    try {
      await page.goto(`http://127.0.0.1:19872/admin?module=${moduleId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await expect(page.locator('#admin-console-canvas')).toHaveAttribute('data-admin-console-active-module', moduleId, { timeout: 20000 });
      const header = page.locator(`[data-admin-module-header-module="${moduleId}"]`);
      await expect(header).toBeVisible({ timeout: 15000 });
      report.modules.push({ module: moduleId, shellAndHeaderVisible: true });
    } catch { report.modules.push({ module: moduleId, shellAndHeaderVisible: false }); }
  }
} catch (error) { report.failure = String(error.message).split('\n')[0]; }
finally { report.pageErrorCount = pageErrorCount; report.blockedMutationCount = blockedMutationCount; writeFileSync(resolve(output, 'browser-results.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify(report));
