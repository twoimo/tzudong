import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { AdminOperationsPanel } from './components/admin/AdminOperationsPanel';
    const fixture = { reads: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__operationsRefresh = fixture;
    globalThis.fetch = async input => {
      const url = String(input).split('?')[0];
      if (!url.startsWith('/api/admin/')) throw new Error('OFFLINE_ONLY');
      fixture.reads += 1;
      if (fixture.hold && fixture.reads > 3) await new Promise(resolve => { fixture.waiters.push(resolve); });
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminOperationsPanel /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['operations-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'operations-refresh-fixture', setup(builder) {
      builder.onResolve({ filter: /^operations-refresh-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'link'
        ? "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });"
        : "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs[0].text();
}

declare global { interface Window { __operationsRefresh: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('operations refresh keeps keyboard focus while the sources reload', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://operations-refresh.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://operations-refresh.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://operations-refresh.test/');
        await page.addScriptTag({ content: script });
        const refresh = page.getByRole('button', { name: '운영 상태 새로고침' });
        await playwrightExpect(refresh).toBeEnabled();
        await page.evaluate(() => { window.__operationsRefresh.hold = true; });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await page.evaluate(() => window.__operationsRefresh.release());
        await playwrightExpect(refresh).toBeFocused();
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);

(existsSync(chrome) ? test : test.skip)('an operations detail retry keeps keyboard focus while that source reloads', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://operations-refresh.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://operations-refresh.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://operations-refresh.test/');
        await page.addScriptTag({ content: script });
        await page.getByRole('button', { name: /맛집 제보/ }).click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
        const retry = page.getByRole('button', { name: '다시 조회' });
        await playwrightExpect(retry).toBeVisible();
        await page.evaluate(() => { window.__operationsRefresh.hold = true; });
        await retry.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).not.toHaveAttribute('disabled');
        await playwrightExpect(page.getByRole('heading', { name: '맛집 제보' })).toBeVisible();
        await page.evaluate(() => window.__operationsRefresh.release());
        await playwrightExpect(retry).toBeFocused();
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);

(existsSync(chrome) ? test : test.skip)('an unsettled operations read does not show zero items needing attention', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle().then(source => source
      .replace('hold: false', 'hold: true')
      .replace('fixture.hold && fixture.reads > 3', 'fixture.hold'));
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://operations-refresh.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://operations-refresh.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://operations-refresh.test/');
        await page.addScriptTag({ content: script });
        const attention = page.locator('option[value="attention"]');
        await playwrightExpect(attention).toHaveText('확인 필요 (미확인)');
        await playwrightExpect(attention).not.toHaveText('확인 필요 (0)');
        await page.evaluate(() => window.__operationsRefresh.release());
        await playwrightExpect(attention).toHaveText('확인 필요 (5)');
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
