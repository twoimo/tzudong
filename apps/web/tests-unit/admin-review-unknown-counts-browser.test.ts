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
    import AdminReviewPanel from './components/admin/AdminReviewPanel';
    const failed = { data: null, error: { message: 'read failed' } };
    const fixture = { reads: 0, hold: false, release: () => {} };
    globalThis.__reviewsRead = fixture;
    const builder = {
      select() { return this; }, order() { return this; }, range() { return this; }, in() { return this; }, eq() { return this; },
      overrideTypes() { return this; },
      then(onFulfilled, onRejected) {
        fixture.reads += 1;
        const pending = fixture.hold
          ? new Promise(resolve => { fixture.release = () => resolve(failed); })
          : Promise.resolve(failed);
        return pending.then(onFulfilled, onRejected);
      },
    };
    globalThis.fetch = async () => new Response('', { status: 503 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminReviewPanel isOpen onClose={() => {}} /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['reviews-read-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'reviews-read-fixture', setup(builder) {
      builder.onResolve({ filter: /^reviews-read-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'auth'
        ? "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false }; export const useAuth = () => value;"
        : "const failed = { data: null, error: { message: 'read failed' } }; const builder = { select() { return this; }, order() { return this; }, range() { return this; }, in() { return this; }, eq() { return this; }, overrideTypes() { return this; }, then(onFulfilled, onRejected) { const fixture = globalThis.__reviewsRead; fixture.reads += 1; const pending = fixture.hold ? new Promise(resolve => { fixture.release = () => resolve(failed); }) : Promise.resolve(failed); return pending.then(onFulfilled, onRejected); } }; export const supabase = { from() { return builder; }, channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, auth: { getSession: async () => ({ data: { session: null } }) } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __reviewsRead: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('a failed review read does not show zero reviews and keeps retry focused', async () => {
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
        if (route.request().url() === 'https://reviews-read.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://reviews-read.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://reviews-read.test/');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('리뷰를 불러오지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByText('대기 중인 리뷰가 없습니다')).toHaveCount(0);
        await playwrightExpect(page.getByText('불러온 리뷰 미확인')).toBeVisible();
        const stats = page.getByLabel('불러온 리뷰 상태');
        for (const label of ['대기', '승인', '거부']) {
          await playwrightExpect(stats.getByText(label, { exact: true }).locator('xpath=following-sibling::p')).toHaveText('미확인');
        }
        const retry = page.getByRole('button', { name: '다시 불러오기' });
        await page.evaluate(() => { window.__reviewsRead.hold = true; });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await page.evaluate(() => window.__reviewsRead.release());
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(page.getByText('불러온 리뷰 미확인')).toBeVisible();
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
