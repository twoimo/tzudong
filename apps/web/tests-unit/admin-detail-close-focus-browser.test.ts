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
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { AdminOperationsPanel } from './components/admin/AdminOperationsPanel';
    import { AdminSentryPanel } from './components/admin/AdminSentryPanel';
    const fixture = { automationReady: false };
    globalThis.__detailFixture = fixture;
    const idleAutomation = {
      policy: { version: 1, enabled: false, batch_size: 10, daily_limit: 10, last_run_at: null },
      queue: { queued: 0, running: 0, failed: 0 }, runs: [], items: [],
    };
    const issue = (id, type) => ({ id, shortId: 'TZ-' + id, type, status: 'unresolved', level: 'error',
      count: 3, lastSeen: '2026-10-20T00:00:00Z', href: 'https://sentry.invalid/' + id });
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async input => {
      const url = String(input);
      if (url === '/api/admin/evaluations/automation' && fixture.automationReady) return json(idleAutomation);
      if (url.startsWith('/api/admin/sentry?')) return json({ state: 'connected', collection: { browser: true, server: true },
        dashboardUrl: null, issues: [issue('1', '합성 오류 A'), issue('2', '합성 오류 B')], nextCursor: null, fetchedAt: '2026-10-20T00:00:00Z' });
      if (url.startsWith('/api/admin/')) return new Response('', { status: 503 });
      throw new Error('OFFLINE_ONLY');
    };
    const client = new QueryClient();
    const panel = new URLSearchParams(location.search).get('panel');
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}>
        {panel === 'sentry' ? <AdminSentryPanel /> : <AdminOperationsPanel />}
      </main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['detail-focus-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'detail-focus-fixture', setup(builder) {
      builder.onResolve({ filter: /^detail-focus-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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
  expect(built.success).toBe(true);
  return built.outputs[0].text();
}

async function open(page: Page, script: string, panel: 'operations' | 'sentry') {
  await page.goto(`https://detail-focus.test/?panel=${panel}`);
  await page.addScriptTag({ content: script });
}

(existsSync(chrome) ? test : test.skip)('admin operations and sentry details return focus without losing it to the page', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 800]) {
      const drawer = width < 1024;
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      try {
        const page = await context.newPage();
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 160)));
        await page.route('**/*', route => {
          if (route.request().url().startsWith('https://detail-focus.test/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          externalRequests++;
          return route.abort();
        });

        await open(page, script, 'operations');
        const opsSearch = page.getByRole('searchbox', { name: '운영 항목 검색' });
        const automationRow = page.locator('[data-operations-row="automation"] button');
        const opsDetail = page.locator('[data-operations-inspector]');
        await playwrightExpect(automationRow).toBeVisible();

        await automationRow.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(opsDetail).toBeFocused();
        await page.keyboard.press('Escape');
        await playwrightExpect(opsDetail).toHaveCount(0);
        await playwrightExpect(automationRow).toBeFocused();

        await page.getByRole('combobox', { name: '운영 상태 필터' }).selectOption('attention');
        await automationRow.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(opsDetail).toBeFocused();
        await page.evaluate(() => { (globalThis as unknown as { __detailFixture: { automationReady: boolean } }).__detailFixture.automationReady = true; });
        await opsDetail.getByRole('button', { name: '다시 조회' }).click();
        await playwrightExpect(page.locator('[data-operations-row="automation"]')).toHaveCount(0);
        await playwrightExpect(opsDetail).toHaveCount(0);
        await playwrightExpect(opsSearch).toBeFocused();

        await open(page, script, 'sentry');
        const sentrySearch = page.getByRole('searchbox', { name: '현재 페이지 오류 검색' });
        const sentryRow = page.locator('[data-sentry-issue="1"] button');
        const sentryDetail = page.locator('[data-sentry-inspector]');
        await playwrightExpect(sentryRow).toBeVisible();

        await sentryRow.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(sentryDetail).toBeFocused();
        await page.keyboard.press('Escape');
        await playwrightExpect(sentryDetail).toHaveCount(0);
        await playwrightExpect(sentryRow).toBeFocused();

        await sentryRow.click();
        await playwrightExpect(sentryDetail).toBeFocused();
        await sentryDetail.getByRole('button', { name: '오류 상세 닫기' }).click();
        await playwrightExpect(sentryDetail).toHaveCount(0);
        await playwrightExpect(sentryRow).toBeFocused();

        if (!drawer) {
          await sentryRow.click();
          await sentrySearch.click();
          await page.keyboard.type('B');
          await playwrightExpect(sentryDetail).toHaveCount(0);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await playwrightExpect(sentrySearch).toBeFocused();
        }

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
