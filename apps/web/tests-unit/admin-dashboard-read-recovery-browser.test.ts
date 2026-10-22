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
    import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
    import { buildAdminPendingCountsResponse } from './lib/admin/pending-counts';
    const fixture = { summaryOk: false, summaryDelayMs: 0, holdSummary: false, releaseSummary() {}, requests: [] };
    globalThis.__dashboardFixture = fixture;
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const asOf = '2026-10-21T00:00:00Z';
    globalThis.fetch = async input => {
      const url = String(input);
      fixture.requests.push(url.split('?')[0]);
      if (url === '/api/admin/pending-counts') return json(buildAdminPendingCountsResponse({ restaurantSubmissions: 2, restaurantRecommendationRequests: 1, reviews: 3, recommendationRequestsLifecycleReady: true, asOf }));
      if (url === '/api/admin/banners') return json({ banners: [] });
      if (url.startsWith('/api/admin/youtube-kpis?')) return json({ asOf, period: '1M', totalVideos: 0, videos: [] });
      if (url === '/api/dashboard/summary') {
        if (fixture.holdSummary) await new Promise(resolve => { fixture.releaseSummary = resolve; });
        else await new Promise(resolve => setTimeout(resolve, fixture.summaryDelayMs));
      }
      if (url === '/api/dashboard/summary' && fixture.summaryOk) return json({ asOf, totals: { restaurants: 12, videos: 34, withCoordinates: 10 }, topCategories: [], videos: [] });
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminConsoleOverview /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['dashboard-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'dashboard-fixture', setup(builder) {
      builder.onResolve({ filter: /^dashboard-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        navigation: "const params = new URLSearchParams('module=overview'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default function Link({ href, children, prefetch, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; }",
        dynamic: "import React from 'react'; export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { summaryOk: boolean; summaryDelayMs: number; holdSummary?: boolean; releaseSummary?: () => void; requests: string[] };
const fixture = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __dashboardFixture: Fixture }).__dashboardFixture }));
const requestCount = async (page: Page, path: string) => (await fixture(page)).requests.filter(url => url === path).length;

(existsSync(chrome) ? test : test.skip)('a failed dashboard summary read can be retried in place without refetching healthy reads', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://dashboard.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.goto('https://dashboard.test/admin');
    await page.addScriptTag({ content: script });

    const error = page.locator('[data-admin-dashboard-read-error="operations"]');
    await playwrightExpect(error).toContainText('일부 운영 데이터 확인 필요');
    const retry = error.getByRole('button', { name: '다시 조회' });
    await playwrightExpect(retry).toBeVisible();
    expect(await requestCount(page, '/api/dashboard/summary')).toBe(1);
    const pendingBefore = await requestCount(page, '/api/admin/pending-counts');
    const bannersBefore = await requestCount(page, '/api/admin/banners');

    await page.evaluate(() => { (globalThis as unknown as { __dashboardFixture: Fixture }).__dashboardFixture.holdSummary = true; });
    await retry.focus();
    await page.keyboard.press('Enter');
    await playwrightExpect(error.getByRole('button', { name: '조회 중…' })).toBeFocused();
    await playwrightExpect(page.locator('[data-admin-module-summary]')).not.toContainText('KPI 데이터 조회 중');
    await playwrightExpect(page.locator('[data-admin-dashboard-widget-card="ops"] [data-admin-dashboard-dynamic-skeleton]')).toHaveCount(0);
    await page.evaluate(() => {
      const fixture = (globalThis as unknown as { __dashboardFixture: Fixture }).__dashboardFixture;
      fixture.holdSummary = false;
      fixture.releaseSummary?.();
    });
    await playwrightExpect(error.getByRole('button', { name: '다시 조회' })).toBeFocused();
    expect(await requestCount(page, '/api/dashboard/summary')).toBe(2);

    await page.evaluate(() => { (globalThis as unknown as { __dashboardFixture: Fixture }).__dashboardFixture.summaryOk = true; });
    await page.keyboard.press('Enter');
    const summary = page.locator('[data-admin-module-summary]');
    await playwrightExpect(summary).toHaveText('대기 6건 · 맛집 12곳 · 영상 34개');
    await playwrightExpect(page.locator('[data-admin-dashboard-read-error]')).toHaveCount(0);
    await playwrightExpect(summary.locator('span[tabindex="-1"]')).toBeFocused();
    expect(await requestCount(page, '/api/dashboard/summary')).toBe(3);
    expect(await requestCount(page, '/api/admin/pending-counts')).toBe(pendingBefore);
    expect(await requestCount(page, '/api/admin/banners')).toBe(bannersBefore);
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
