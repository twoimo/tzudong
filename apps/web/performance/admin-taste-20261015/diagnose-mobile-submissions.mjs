import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
  localStorage.setItem('tzudong-admin-theme', 'light');
});
const page = await context.newPage();
const responses = [];
const suffix = process.env.DIAGNOSTIC_AUTH === '1' ? '-auth-exceptions' : '-exceptions';
const errorCodes = [];
const exceptions = [];
const debug = await context.newCDPSession(page);
await debug.send('Debugger.enable');
debug.on('Debugger.paused', async event => {
  const description = String(event.data?.description ?? '').split('\n')[0]
    .replace(/https?:\/\/\S+/g, '<url>').replace(/[\w.+-]+@[\w.-]+/g, '<email>').slice(0, 260);
  if (exceptions.length < 64) exceptions.push({ reason: event.reason, description, frames: event.callFrames.slice(0, 5).map(frame => ({ functionName: frame.functionName, scriptId: frame.location.scriptId, lineNumber: frame.location.lineNumber })) });
  await debug.send('Debugger.resume').catch(() => {});
});
await debug.send('Debugger.setPauseOnExceptions', { state: 'all' });
page.on('console', message => {
  if (message.type() !== 'error') return;
  const text = message.text();
  const code = text.match(/Minified React error #[0-9]+/)?.[0]
    ?? text.match(/ReferenceError: [A-Za-z_$][A-Za-z0-9_$ ]{0,100}/)?.[0]
    ?? text.match(/TypeError: [A-Za-z0-9_$ ().,'"-]{0,180}/)?.[0];
  if (code) errorCodes.push(code);
});
await page.route('**/*', route => {
  const request = route.request();
  const url = new URL(request.url());
  if (!['GET', 'HEAD'].includes(request.method()) || !['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
  return route.continue();
});
page.on('response', response => {
  const url = new URL(response.url());
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) responses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
});
if (process.env.DIAGNOSTIC_AUTH === '1') {
  const { installSyntheticSession } = await import('./session-fixture.mjs');
  await installSyntheticSession(page);
}
try {
  await page.goto('http://127.0.0.1:18822/admin?module=submissions', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-admin-page-header="true"]:visible').first().waitFor();
  let settled = true;
  try { await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-admin-console-active-module="submissions"]');
    const visible = node => { const r = node.getBoundingClientRect(); return Boolean(r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && getComputedStyle(node).visibility !== 'hidden'); };
    return !document.documentElement.classList.contains('dark') && canvas && [...canvas.querySelectorAll('[data-admin-page-header="true"]')].some(node => visible(node) && node.querySelector('.admin-page-header-title')?.textContent?.trim() === '제보 관리') && ![...canvas.querySelectorAll('[data-admin-sidebar-module-loading-grid], [aria-busy="true"], [data-slot="skeleton"]')].some(visible);
  }, null, { timeout: 10_000 }); }
  catch { settled = false; }
  const metrics = await page.evaluate(() => ({
    title: document.title,
    url: location.pathname,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    viewport: { width: innerWidth, height: innerHeight },
    activeModules: [...document.querySelectorAll('[data-admin-console-active-module]')].map(node => node.getAttribute('data-admin-console-active-module')),
    headers: [...document.querySelectorAll('[data-admin-page-header="true"]')].map(node => { const r = node.getBoundingClientRect(); return { title: node.querySelector('.admin-page-header-title')?.textContent, visibility: getComputedStyle(node).visibility, rect: {x:r.x,y:r.y,width:r.width,height:r.height}, insideCanvas: Boolean(node.closest('[data-admin-console-active-module="submissions"]')) }; }),
    busy: [...document.querySelectorAll('[data-admin-sidebar-module-loading-grid], [aria-busy="true"], [data-slot="skeleton"]')].map(node => { const r = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label'), className: node.className, visibility: getComputedStyle(node).visibility, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; }),
    text: document.querySelector('#admin-console-canvas')?.textContent?.slice(0, 3000),
  }));
  await page.screenshot({ path: resolve(import.meta.dirname, `mobile-submissions-diagnostic${suffix}.png`), animations: 'disabled' });
  await writeFile(resolve(import.meta.dirname, `mobile-submissions-diagnostic${suffix}.json`), JSON.stringify({ syntheticOnly: true, settled, metrics, responses, errorCodes, exceptions }, null, 2));
  console.log(JSON.stringify({ settled, metrics, responses, errorCodes, exceptions }));
} finally { await browser.close(); }
