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
  const fixture = { failPeriod: globalThis.__insightsInitialFailPeriod || '1M', delayMs: 0, hold: false, waiters: [], requests: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__fixture = fixture;
  globalThis.fetch = async input => {
    const url = new URL(String(input), location.origin);
    if (url.pathname !== '/api/insights/treemap') return new Response('', { status: 503 });
    const period = url.searchParams.get('period');
    fixture.requests.push(period);
    await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
    if (fixture.hold) await new Promise(resolve => { fixture.waiters.push(resolve); });
    if (period === fixture.failPeriod) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ asOf: '2026-10-21T00:00:00Z', period, totalVideos: 0, videos: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><InsightsClient embedded /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['insights-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'insights-fixture', setup(builder) {
      builder.onResolve({ filter: /^insights-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
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

type Fixture = { failPeriod: string | null; delayMs: number; hold?: boolean; requests: string[]; release?: () => void };
const setFixture = (page: Page, patch: Partial<Fixture>) =>
  page.evaluate(next => Object.assign((globalThis as unknown as { __fixture: Fixture }).__fixture, next), patch);
const requestCount = async (page: Page, period: string) =>
  (await page.evaluate(() => (globalThis as unknown as { __fixture: Fixture }).__fixture.requests)).filter(value => value === period).length;

(existsSync(chrome) ? test : test.skip)('an insights period read failure keeps keyboard focus through the error, retry and recovery', async () => {
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
          if (route.request().url() === 'https://insights.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://insights.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://insights.test/admin');
        await page.addScriptTag({ content: script });

        const card = page.locator('[data-insights-card]');
        await playwrightExpect(page.getByText('전체 0개')).toBeVisible();
        await page.getByRole('button', { name: '1M', exact: true }).focus();
        await page.keyboard.press('Enter');
        const retry = page.getByRole('button', { name: '다시 시도', exact: true });
        await playwrightExpect(retry).toBeFocused();
        const afterFailure = await requestCount(page, '1M');
        expect(afterFailure).toBeGreaterThan(0);

        await setFixture(page, { delayMs: 600 });
        await page.keyboard.press('Enter');
        await playwrightExpect(page.getByRole('button', { name: '다시 시도하는 중…' })).toBeFocused();
        await playwrightExpect(page.getByText('전체 0개')).toHaveCount(0);
        await playwrightExpect(retry).toBeFocused();
        const afterRetry = await requestCount(page, '1M');
        expect(afterRetry).toBeGreaterThan(afterFailure);

        await setFixture(page, { failPeriod: null, delayMs: 0 });
        await page.keyboard.press('Enter');
        await playwrightExpect(card).toBeFocused();
        await playwrightExpect(card.getByRole('button', { name: '1M', exact: true })).toBeVisible();
        expect(await requestCount(page, '1M')).toBeGreaterThan(afterRetry);
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

(existsSync(chrome) ? test : test.skip)('a failed first insights read stays failed while retrying', async () => {
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
          if (route.request().url() === 'https://insights.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://insights.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown; __insightsInitialFailPeriod: string }).process = { env: { NODE_ENV: 'test' } }; (globalThis as unknown as { __insightsInitialFailPeriod: string }).__insightsInitialFailPeriod = 'ALL'; });
        await page.goto('https://insights.test/admin');
        await page.addScriptTag({ content: script });

        await playwrightExpect(page.getByText('데이터를 불러오지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByRole('heading', { name: '문제가 발생했습니다' })).toBeVisible();
        const retry = page.getByRole('button', { name: '다시 시도', exact: true });
        await page.evaluate(() => { (globalThis as unknown as { __fixture: { hold: boolean } }).__fixture.hold = true; });
        await retry.focus();
        await page.keyboard.press('Enter');
        const retrying = page.getByRole('button', { name: /다시 시도/ });
        await playwrightExpect(retrying).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retrying).toBeFocused();
        await playwrightExpect(page.getByText('데이터를 불러오지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByRole('heading', { name: '문제가 발생했습니다' })).toBeVisible();
        await playwrightExpect(page.getByText('데이터를 불러오는 중입니다.')).toHaveCount(0);
        await page.evaluate(() => {
          const fixture = (globalThis as unknown as { __fixture: { hold: boolean; release: () => void } }).__fixture;
          fixture.hold = false;
          fixture.release();
        });
        await playwrightExpect(page.getByText('데이터를 불러오지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByRole('button', { name: /다시 시도/ })).toBeFocused();
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
