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
    import { AdminRestaurantRefreshHistoryPanel } from './components/admin/AdminRestaurantRefreshHistoryPanel';
    const fixture = { reads: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__historyReload = fixture;
    globalThis.fetch = async input => {
      const url = String(input);
      if (!url.startsWith('/api/admin/restaurant-refresh-history?')) throw new Error('OFFLINE_ONLY');
      fixture.reads += 1;
      if (fixture.hold && fixture.reads > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
      return new Response('', { status: 503 });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminRestaurantRefreshHistoryPanel /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['history-reload-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'history-reload-fixture', setup(builder) {
      builder.onResolve({ filter: /^history-reload-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __historyReload: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('refresh-history reload keeps keyboard focus on the header refresh button', async () => {
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
        if (route.request().url() === 'https://history-reload.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://history-reload.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://history-reload.test/admin');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByRole('alert').filter({ hasText: '최신화 이력을 불러오지 못했습니다.' })).toBeVisible();
        const refresh = page.getByRole('button', { name: '최신화 이력 새로고침' });
        await page.evaluate(() => { window.__historyReload.hold = true; });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await page.evaluate(() => window.__historyReload.release());
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(page.getByText('조회 실패', { exact: true })).toBeVisible();
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
