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
    const fixture = { ok: false, delayMs: 0, hold: false, reads: 0, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__historyFixture = fixture;
    globalThis.fetch = async input => {
      const url = String(input);
      if (!url.startsWith('/api/admin/restaurant-refresh-history?')) throw new Error('OFFLINE_ONLY');
      fixture.reads++;
      if (fixture.hold && fixture.reads > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
      else await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
      if (!fixture.ok) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ candidates: [], summary: { approved_restaurants_total: 40, needs_review: 3, approved: 2, applied: 1, rejected: 4, last_checked_at: null } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminRestaurantRefreshHistoryPanel /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['history-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'history-fixture', setup(builder) {
      builder.onResolve({ filter: /^history-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { ok: boolean; delayMs: number; hold: boolean; reads: number; release: () => void };
const setFixture = (page: Page, changes: Partial<Fixture>) => page.evaluate(next => {
  Object.assign((globalThis as unknown as { __historyFixture: Fixture }).__historyFixture, next);
}, changes);
const reads = (page: Page) => page.evaluate(() => (globalThis as unknown as { __historyFixture: Fixture }).__historyFixture.reads);

(existsSync(chrome) ? test : test.skip)('a failed refresh-history first load is not shown as an empty history and retries keep focus', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://history.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.goto('https://history.test/admin');
    await page.addScriptTag({ content: script });

    const banner = page.getByRole('alert').filter({ hasText: '최신화 이력을 불러오지 못했습니다.' });
    await playwrightExpect(banner).toBeVisible();
    await playwrightExpect(page.getByText('최신화 이력이 없습니다.')).toHaveCount(0);
    await playwrightExpect(page.locator('[data-admin-restaurant-refresh-read-failed]')).toHaveText('최신화 이력을 확인하지 못했습니다.');
    await playwrightExpect(page.getByText('이력을 불러오면 여기에 표시합니다.')).toHaveCount(0);
    await playwrightExpect(page.getByText('조회 실패', { exact: true })).toBeVisible();
    await playwrightExpect(page.locator('[data-admin-module-summary] [data-admin-module-summary]')).toContainText('검토 필요 —');

    await setFixture(page, { hold: true });
    const retry = banner.getByRole('button');
    await retry.focus();
    await page.keyboard.press('Enter');
    await playwrightExpect(retry).toHaveText('불러오는 중…');
    await playwrightExpect(retry).toBeFocused();
    await playwrightExpect(page.locator('[data-admin-restaurant-refresh-read-failed]')).toHaveText('최신화 이력을 확인하지 못했습니다.');
    await playwrightExpect(page.getByText('조회 실패', { exact: true })).toBeVisible();
    await playwrightExpect(page.locator('.admin-cms-footer')).not.toContainText('불러오는 중');
    await page.evaluate(() => (globalThis as unknown as { __historyFixture: { release: () => void } }).__historyFixture.release());
    await playwrightExpect(retry).toHaveText('다시 시도');
    await playwrightExpect(retry).toBeFocused();
    expect(await reads(page)).toBe(2);

    await setFixture(page, { ok: true, hold: false });
    await page.keyboard.press('Enter');
    await playwrightExpect(banner).toHaveCount(0);
    await playwrightExpect(page.getByText('최신화 이력이 없습니다.')).toBeVisible();
    await playwrightExpect(page.locator('[data-admin-module-summary] [data-admin-module-summary]')).toContainText('검토 필요 3');
    await playwrightExpect(page.locator('#refresh-history-search')).toBeFocused();
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
