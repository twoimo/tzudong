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
    const fixture = { hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__reviewsNext = fixture;
    globalThis.fetch = async () => new Response('', { status: 503 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminReviewPanel isOpen onClose={() => {}} /></main></QueryClientProvider>);
  `;
  const client = `const failed = { data: null, error: { message: 'next failed' } };
    const review = i => ({ id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), user_id: '11111111-1111-4111-8111-111111111111', restaurant_id: '22222222-2222-4222-8222-222222222222', title: '리뷰 ' + i, content: '내용', visited_at: '2026-10-01', verification_photo: '', food_photos: [], categories: [], is_verified: false, admin_note: null, is_pinned: false, is_edited_by_admin: false, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
    const firstPage = Array.from({ length: 20 }, (_, index) => review(index + 1));
    export const supabase = {
      from(table) {
        let start = 0;
        const builder = { select() { return builder; }, order() { return builder; }, in() { return builder; }, eq() { return builder; }, overrideTypes() { return builder; }, range(value) { start = value; return builder; }, then(onFulfilled, onRejected) {
          if (table === 'restaurants') return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
          if (table !== 'reviews') return Promise.resolve(failed).then(onFulfilled, onRejected);
          if (start === 0) return Promise.resolve({ data: firstPage, error: null }).then(onFulfilled, onRejected);
          const fixture = globalThis.__reviewsNext;
          const pending = fixture.hold ? new Promise(resolve => { fixture.waiters.push(resolve); }) : Promise.resolve(failed);
          return pending.then(() => failed).then(onFulfilled, onRejected);
        } };
        return builder;
      },
      channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {},
      auth: { getSession: async () => ({ data: { session: null } }) },
    };
    `;
  const built = await Bun.build({
    entrypoints: ['reviews-next-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'reviews-next-fixture', setup(builder) {
      builder.onResolve({ filter: /^reviews-next-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'auth'
        ? "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false }; export const useAuth = () => value;"
        : client }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __reviewsNext: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('the next review page button keeps keyboard focus while that page reloads', async () => {
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
        if (route.request().url() === 'https://reviews-next.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://reviews-next.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://reviews-next.test/');
        await page.addScriptTag({ content: script });
        const more = page.getByRole('button', { name: /리뷰 더 불러오기|다음 리뷰 다시 불러오기/ });
        await playwrightExpect(more).toBeVisible();
        await page.evaluate(() => { window.__reviewsNext.hold = true; });
        await more.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(more).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(more).toBeFocused();
        await playwrightExpect(more).not.toHaveAttribute('disabled');
        await page.evaluate(() => window.__reviewsNext.release());
        await playwrightExpect(page.getByText('다음 리뷰를 불러오지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByRole('button', { name: '다음 리뷰 다시 불러오기' })).toBeFocused();
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
