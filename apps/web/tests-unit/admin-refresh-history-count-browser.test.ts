import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { AdminRestaurantRefreshHistoryPanel } from './components/admin/AdminRestaurantRefreshHistoryPanel';
    const candidate = name => ({ id: name, restaurant_id: name + '-restaurant', restaurant_name: name,
      restaurant_address: null, current_phone: null, candidate_status: 'needs_review', detected_change_types: ['phone'],
      previous_snapshot: {}, candidate_snapshot: {}, evidence: {}, created_at: '2026-10-20T00:00:00Z',
      decided_at: null, applied_at: null, readback_state: { status: 'not_required', checked_at: null, run_id: null, notes: null } });
    const summary = { approved_restaurants_total: 40, needs_review: 1, approved: 0, applied: 0, rejected: 0, last_checked_at: '2026-10-21T00:00:00Z' };
    const fixture = { hold: false, reads: 0, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__historyCount = fixture;
    globalThis.fetch = async input => {
      const url = String(input);
      if (!url.startsWith('/api/admin/restaurant-refresh-history?')) throw new Error('OFFLINE_ONLY');
      fixture.reads += 1;
      if (fixture.hold && fixture.reads > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
      const names = fixture.reads > 1 ? ['이전 맛집', '다음 맛집'] : ['이전 맛집'];
      return new Response(JSON.stringify({ candidates: names.map(candidate), summary }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminRestaurantRefreshHistoryPanel /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['history-count-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'history-count-fixture', setup(builder) {
      builder.onResolve({ filter: /^history-count-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

const reads = (page: Page) => page.evaluate(() => (globalThis as unknown as { __historyCount: { reads: number } }).__historyCount.reads);

(existsSync(chrome) ? test : test.skip)('a refresh keeps the visible history count until the next list arrives', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://history-count.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://history-count.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://history-count.test/admin');
        await page.addScriptTag({ content: script });

        const footer = page.locator('.admin-cms-footer');
        const previous = page.getByRole('button', { name: '이전 맛집 상세 보기' }).first();
        await playwrightExpect(previous).toBeVisible();
        await playwrightExpect(footer).toContainText('1건 · 최근 최대 100건');

        await page.evaluate(() => { (globalThis as unknown as { __historyCount: { hold: boolean } }).__historyCount.hold = true; });
        const refresh = page.getByRole('button', { name: '최신화 이력 새로고침' });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect.poll(() => reads(page)).toBe(2);
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(previous).toBeVisible();
        await playwrightExpect(page.getByRole('button', { name: '다음 맛집 상세 보기' })).toHaveCount(0);
        await playwrightExpect(footer).toContainText('1건 · 최근 최대 100건');
        await playwrightExpect(footer).not.toContainText('불러오는 중');

        await page.evaluate(() => {
          const fixture = (globalThis as unknown as { __historyCount: { hold: boolean; release: () => void } }).__historyCount;
          fixture.hold = false;
          fixture.release();
        });
        await playwrightExpect(page.getByRole('button', { name: '다음 맛집 상세 보기' }).first()).toBeVisible();
        await playwrightExpect(footer).toContainText('2건 · 최근 최대 100건');
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);
