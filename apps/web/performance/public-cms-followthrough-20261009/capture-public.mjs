import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve('performance/public-cms-followthrough-20261009');
const inventory = JSON.parse(readFileSync('performance/cms-followthrough-20261009/route-inventory.json', 'utf8')).public_or_account_pages;
const browser = await chromium.launch({ headless: true, executablePath: '/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const results = { head: 'b085e1d36ad8a8bc5626738b9921b194f50324a1', scope: 'anonymous-local-with-synthetic-read-outages', productionEvidence: false, captures: [], mutationAttemptsBlocked: 0 };
const viewports = [{ id: 'desktop', width: 1440, height: 1000 }, { id: 'tablet', width: 820, height: 1180 }, { id: 'mobile', width: 390, height: 844 }];
mkdirSync(resolve(output, 'screenshots'), { recursive: true });
try {
 for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
   const request = route.request(), url = new URL(request.url());
   if (!['GET', 'HEAD'].includes(request.method())) { results.mutationAttemptsBlocked++; return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } }); }
   if (url.origin !== 'http://127.0.0.1:19872') return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } });
   if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } });
   return route.continue();
  });
  const page = await context.newPage();
  let pageErrorCount = 0; page.on('pageerror', () => { pageErrorCount++; });
  for (let index = 0; index < inventory.length; index++) {
   const item = inventory[index];
   const path = item.route.replace('[code]', 'audit-invalid-code').replace('[userId]', '00000000-0000-4000-8000-000000000009');
   const capture = { index: index + 1, routePattern: item.route, viewport: viewport.id, path, status: null, errorCount: 0 };
   const beforeErrors = pageErrorCount;
   try {
    const response = await page.goto(`http://127.0.0.1:19872${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    capture.status = response?.status() ?? null;
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
    capture.actualPath = new URL(page.url()).pathname + new URL(page.url()).search;
    capture.metrics = await page.evaluate(() => {
     const visible = element => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
     const controls = Array.from(document.querySelectorAll('button,a,input,select,textarea')).filter(visible);
     const unnamed = controls.filter(element => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent?.trim() && !element.getAttribute('title') && !element.getAttribute('alt') && !element.querySelector('img[alt]')?.getAttribute('alt') && !(element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) && !element.closest('label'));
     const headers = Array.from(document.querySelectorAll('header,[data-map-panel-header]')).filter(visible).map(element => ({ height: Math.round(element.getBoundingClientRect().height), compact: element.getAttribute('data-design-density') }));
     const animated = Array.from(document.querySelectorAll('*')).filter(visible).filter(element => { const s = getComputedStyle(element); return s.animationName !== 'none' && s.animationDuration !== '0s'; }).length;
     const scrollOwners = Array.from(document.querySelectorAll('*')).filter(visible).filter(element => { const s = getComputedStyle(element); return ['auto','scroll'].includes(s.overflowY) && element.scrollHeight > element.clientHeight + 4; }).length;
     return { documentOverflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth, viewportWidth: innerWidth, viewportHeight: innerHeight, visibleHeadingCount: Array.from(document.querySelectorAll('h1,h2')).filter(visible).length, bodyHasVisibleText: !!document.body.innerText.trim(), unnamedVisibleControls: unnamed.length, reducedMotionAnimatedElements: animated, verticalScrollOwners: scrollOwners, headers };
    });
    const screenshot = `${String(index + 1).padStart(2, '0')}-${viewport.id}.png`;
    await page.screenshot({ path: resolve(output, 'screenshots', screenshot), fullPage: false });
    capture.screenshot = `screenshots/${screenshot}`;
   } catch (error) { capture.failure = String(error.message).split('\n')[0].slice(0, 160); }
   capture.errorCount = pageErrorCount - beforeErrors;
   results.captures.push(capture);
   writeFileSync(resolve(output, 'capture-results.json'), JSON.stringify(results, null, 2) + '\n');
   console.log(`${viewport.id} ${index + 1}/22 ${item.route} status=${capture.status} errors=${capture.errorCount} overflow=${capture.metrics?.documentOverflowX ?? 'unknown'}`);
  }
  await context.close();
 }
} finally { await browser.close(); writeFileSync(resolve(output, 'capture-results.json'), JSON.stringify(results, null, 2) + '\n'); }
