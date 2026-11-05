import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromium.executablePath();

async function bundle(initialView: 'evaluations' | 'submissions' = 'evaluations') {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import AdminEvaluationRoutePage from './app/admin/evaluations/page';
    import { AppToaster } from './components/ui/app-toaster';
    const fixture = { page: 'fail', pageReads: 0, submissions: 'fail', submissionReads: 0, itemReads: 0, originalReads: 0, profileReads: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__fixture = fixture;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    const emptyPage = { records: [], revision: '1', filteredTotal: 0, nextCursor: null, warnings: {},
      stats: { total: 0, pending: 0, approved: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0, deleted: 0 } };
    globalThis.fetch = async (input) => {
      const url = new URL(String(input), location.href);
      if (url.pathname === '/api/admin/submissions') {
        fixture.submissionReads++;
        if (fixture.submissions === 'fail') return json({ code: 'submission_read_failed' }, 500);
        if (fixture.submissions === 'empty') return json({ submissions: [], items: [] });
        const submissions = [{ id: 'submission-fixture', user_id: '00000000-0000-4000-8000-000000000123', submission_type: 'new', status: 'pending',
          restaurant_name: '합성 서버 제보', restaurant_address: null, restaurant_phone: null, restaurant_categories: [], admin_notes: null,
          rejection_reason: null, resolved_by_admin_id: null, reviewed_at: null, created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z' }];
        if (fixture.submissions === 'missing-items') return json({ submissions });
        return json({ submissions, items: [{ id: 'item-fixture', submission_id: 'submission-fixture', youtube_link: 'https://www.youtube.com/watch?v=fixture1234',
          tzuyang_review: '합성 리뷰', target_restaurant_id: 'restaurant-fixture', item_status: 'pending', rejection_reason: null, created_at: '2026-10-23T00:00:00Z' }] });
      }
      if (url.pathname === '/api/admin/profile-summaries') {
        fixture.profileReads++;
        return json({ code: 'ADMIN_PROFILE_SUMMARIES_UNAVAILABLE' }, 502);
      }
      if (url.pathname === '/api/admin/evaluations' && url.searchParams.get('view') === 'page') {
        fixture.pageReads++;
        if (fixture.hold) await new Promise(resolve => { fixture.waiters.push(resolve); });
        else if (fixture.page === 'slow-fail') await new Promise(resolve => setTimeout(resolve, 600));
        return fixture.page === 'ok' ? json(emptyPage) : json({ code: 'unavailable' }, 500);
      }
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    fixture.queryClient = client;
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminEvaluationRoutePage.Embedded embedded initialView="${initialView}" /></main><AppToaster /></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['evaluations-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'evaluations-fixture', setup(builder) {
      builder.onResolve({ filter: /^evaluations-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: `export const supabase = {
          channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {},
          from(table) {
            if (table === 'restaurant_submission_items') { globalThis.__fixture.itemReads++; throw new Error('NO_BROWSER_ITEM_READ'); }
            if (table !== 'restaurants') throw new Error('OFFLINE_ONLY');
            globalThis.__fixture.originalReads++;
            const builder = { select() { return builder; }, in() { return builder; }, overrideTypes: async () => ({ data: [{
              id: 'restaurant-fixture', unique_id: 'trace-fixture', name: '합성 원래 식당', road_address: null, jibun_address: null,
              phone: null, categories: [], youtube_link: null, tzuyang_review: null, youtube_meta: null }], error: null }) };
            return builder;
          },
          storage: { from() { throw new Error('OFFLINE_ONLY'); } }, auth: { getSession: async () => ({ data: { session: null } }) }
        };`,
        navigation: "const params = new URLSearchParams('module=evaluations'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });",
        dynamic: "export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

const setFixture = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate(next => Object.assign((globalThis as unknown as { __fixture: object }).__fixture, next), patch);

(existsSync(chrome) ? test : test.skip)('submission retry uses server items, retains original restaurant reads and profile fallback, and accepts empty results', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await bundle('submissions');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://submissions.test/admin') {
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        }
        externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      await page.goto('https://submissions.test/admin');
      await page.addScriptTag({ content: script });

      const error = page.getByText('신규 제보 목록을 불러오지 못했습니다.');
      const refresh = page.getByRole('button', { name: '목록 새로고침' });
      await playwrightExpect(error).toBeVisible();
      await setFixture(page, { submissions: 'ok' });
      await refresh.click();
      await playwrightExpect(page.getByText('합성 서버 제보', { exact: true })).toBeVisible();
      await playwrightExpect(error).toHaveCount(0);
      await playwrightExpect(page.getByText('닉네임을 불러올 수 없음', { exact: true })).toBeVisible();

      const readback = await page.evaluate(() => {
        const fixture = (globalThis as unknown as { __fixture: {
          itemReads: number; originalReads: number; profileReads: number;
          queryClient: { getQueryData(key: unknown[]): Array<{ items: Array<{ id: string; original_restaurant: { name: string } }> }> };
        } }).__fixture;
        const rows = fixture.queryClient.getQueryData(['admin-submissions-inline', 'admin-self', true]);
        return { itemReads: fixture.itemReads, originalReads: fixture.originalReads, profileReads: fixture.profileReads,
          itemId: rows[0]?.items[0]?.id, originalName: rows[0]?.items[0]?.original_restaurant?.name };
      });
      expect(readback).toEqual({ itemReads: 0, originalReads: 1, profileReads: 1, itemId: 'item-fixture', originalName: '합성 원래 식당' });

      await setFixture(page, { submissions: 'missing-items' });
      await refresh.click();
      await playwrightExpect(error).toBeVisible();
      await setFixture(page, { submissions: 'empty' });
      await refresh.click();
      await playwrightExpect(error).toHaveCount(0);
      await playwrightExpect(page.getByText('합성 서버 제보', { exact: true })).toHaveCount(0);
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toBe(0);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}, 60_000);

(existsSync(chrome) ? test : test.skip)('a failed review-list read reports once and keeps the retry control focused', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const pageErrors: string[] = [];
        const external = { count: 0 };
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://evaluations.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://evaluations.test/')) external.count++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://evaluations.test/admin');
        await page.addScriptTag({ content: script });

        const alert = page.locator('[data-admin-evaluation-page-error]');
        const retry = alert.getByRole('button');
        await playwrightExpect(alert).toContainText('검수 목록 조회 실패');
        await page.waitForTimeout(300);
        await playwrightExpect(page.getByText('데이터 로드 실패')).toHaveCount(0);
        await playwrightExpect(page.getByText('표시할 데이터가 없습니다', { exact: false })).toHaveCount(0);
        const failedCount = page.locator('[data-admin-evaluation-mobile-filter-actions], .admin-cms-footer').filter({ visible: true });
        await playwrightExpect(failedCount).toHaveCount(1);
        await playwrightExpect(failedCount).toContainText('미확인');
        await playwrightExpect(failedCount).not.toContainText('0개');

        await setFixture(page, { hold: true });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveText('조회 중…');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(failedCount).toContainText('미확인');
        await playwrightExpect(page.getByText('집계 중')).toHaveCount(0);
        await playwrightExpect(page.locator('tr[aria-hidden="true"]')).toHaveCount(0);
        await playwrightExpect(page.getByRole('status', { name: '맛집 검수 카드 로딩 중' })).toHaveCount(0);
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => (globalThis as unknown as { __fixture: { pageReads: number } }).__fixture.pageReads)).toBe(2);
        await page.evaluate(() => (globalThis as unknown as { __fixture: { release: () => void } }).__fixture.release());
        await playwrightExpect(retry).toHaveText('다시 조회');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(page.getByText('데이터 로드 실패')).toHaveCount(0);
        expect(await page.evaluate(() => (globalThis as unknown as { __fixture: { pageReads: number } }).__fixture.pageReads)).toBe(2);

        await setFixture(page, { page: 'ok', hold: false });
        await page.keyboard.press('Enter');
        await playwrightExpect(alert).toHaveCount(0);
        await playwrightExpect(page.locator('[data-admin-module-content]')).toBeFocused();
        await playwrightExpect(page.getByText('표시할 데이터가 없습니다').filter({ visible: true })).toHaveCount(1);
        const emptyCount = page.locator('[data-admin-evaluation-mobile-filter-actions], .admin-cms-footer').filter({ visible: true });
        await playwrightExpect(emptyCount).toHaveCount(1);
        await playwrightExpect(emptyCount).toContainText('0개');
        await playwrightExpect(emptyCount).not.toContainText('미확인');
        expect(external.count).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);

(existsSync(chrome) ? test : test.skip)('a failed submission queue does not show zero pending counts in the module summary', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await bundle('submissions');
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://evaluations.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://evaluations.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://evaluations.test/admin');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('신규 제보 목록을 불러오지 못했습니다.')).toBeVisible();
        const summary = page.locator('[data-admin-module-summary]');
        await playwrightExpect(summary).toContainText('미확인');
        await playwrightExpect(summary).not.toContainText('0건');
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);
