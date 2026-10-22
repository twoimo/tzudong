import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import InsightsClient from './app/insights/insights-client';
  const video = (id, title, viewCount) => ({
    id, title, publishedAt: '2026-01-01T00:00:00Z', category: '한식',
    viewCount, likeCount: 1, commentCount: 1, duration: 60,
    previousViewCount: null, previousLikeCount: null, previousCommentCount: null, previousDuration: null,
  });
  const payload = period => period === '1M'
    ? { asOf: '2026-10-21T00:00:00Z', period, totalVideos: 9, videos: [video('month-1', '전월 영상', 888888)] }
    : { asOf: '2026-10-21T00:00:00Z', period, totalVideos: 2, videos: [video('all-1', '전체 기간 영상', 222222)] };
  const fixture = { hold: false, waiters: [], requests: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__fixture = fixture;
  globalThis.fetch = async input => {
    const url = new URL(String(input), location.origin);
    if (url.pathname !== '/api/insights/treemap') return new Response('', { status: 503 });
    const period = url.searchParams.get('period');
    fixture.requests.push(period);
    if (fixture.hold) await new Promise(resolve => { fixture.waiters.push(resolve); });
    return new Response(JSON.stringify(payload(period)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><InsightsClient embedded /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['insights-period-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'insights-period-fixture', setup(builder) {
      builder.onResolve({ filter: /^insights-period-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        navigation: "const params = new URLSearchParams('module=insights'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default function Link({ href, children, prefetch, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

const requests = (page: Page) => page.evaluate(() => (globalThis as unknown as { __fixture: { requests: string[] } }).__fixture.requests);

(existsSync(chrome) ? test : test.skip)('the visible insights period stays with the chart until the next period arrives', async () => {
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
          if (route.request().url() === 'https://insights-period.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://insights-period.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://insights-period.test/admin');
        await page.addScriptTag({ content: script });

        const summary = page.locator('[data-admin-module-summary]');
        const chart = page.getByRole('img');
        await playwrightExpect(summary).toContainText('전체 기간');
        await playwrightExpect(summary).toContainText('2개 영상');
        await playwrightExpect(chart).toContainText('222.2k');
        await playwrightExpect(chart).toHaveAttribute('aria-label', /전체 기간/);

        await page.evaluate(() => { (globalThis as unknown as { __fixture: { hold: boolean } }).__fixture.hold = true; });
        const nextPeriod = page.getByText('기준', { exact: true }).locator('..').getByRole('button', { name: '1M', exact: true });
        await nextPeriod.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect.poll(() => requests(page)).toContain('1M');
        await playwrightExpect(chart).toContainText('222.2k');
        await playwrightExpect(chart).not.toContainText('888.9k');
        await playwrightExpect(summary).toContainText('전체 기간');
        await playwrightExpect(summary).toContainText('2개 영상');
        await playwrightExpect(summary).not.toContainText('전월');
        await playwrightExpect(chart).toHaveAttribute('aria-label', /전체 기간/);
        await playwrightExpect(chart).not.toHaveAttribute('aria-label', /전월/);

        await page.evaluate(() => {
          const fixture = (globalThis as unknown as { __fixture: { hold: boolean; release: () => void } }).__fixture;
          fixture.hold = false;
          fixture.release();
        });
        await playwrightExpect(summary).toContainText('전월');
        await playwrightExpect(summary).toContainText('9개 영상');
        await playwrightExpect(chart).toContainText('888.9k');
        await playwrightExpect(chart).toHaveAttribute('aria-label', /전월/);
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
