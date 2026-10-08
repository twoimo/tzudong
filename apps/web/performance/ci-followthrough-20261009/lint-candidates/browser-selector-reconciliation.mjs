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
  for (const moduleId of ['overview', 'restaurants', 'knowledge-graph', 'sentry', 'storyboard']) {
    try {
      await page.goto(`http://127.0.0.1:19872/admin?module=${moduleId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await expect(page.locator('#admin-console-canvas')).toHaveAttribute('data-admin-console-active-module', moduleId, { timeout: 20000 });
      const selectors = { overview: '[data-admin-dashboard-management="true"]', restaurants: '[data-admin-restaurant-primary-header="true"]', 'knowledge-graph': '[data-admin-knowledge-graph-panel] [data-admin-page-header]', sentry: '[data-admin-sentry-panel] [data-admin-page-header]', storyboard: '[data-local-storyboard-workspace="true"] [data-admin-page-header]' };
      const header = page.locator(selectors[moduleId]);
      await expect(header).toBeVisible({ timeout: 15000 });
      report.modules.push({ module: moduleId, shellAndHeaderVisible: true });
    } catch { report.modules.push({ module: moduleId, shellAndHeaderVisible: false }); }
  }
} catch (error) { report.failure = String(error.message).split('\n')[0]; }
finally { report.pageErrorCount = pageErrorCount; report.blockedMutationCount = blockedMutationCount; writeFileSync(resolve(output, 'browser-selector-reconciliation.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify(report));
