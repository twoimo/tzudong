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
  import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
  import { buildAdminPendingCountsResponse } from './lib/admin/pending-counts';
  const fixture = { holdBanners: true, waiters: [], release() { this.holdBanners = false; const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__dashboardHeadline = fixture;
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const asOf = '2026-10-21T00:00:00Z';
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/admin/pending-counts') return json(buildAdminPendingCountsResponse({ restaurantSubmissions: 2, restaurantRecommendationRequests: 1, reviews: 3, recommendationRequestsLifecycleReady: true, asOf }));
    if (url === '/api/dashboard/summary') return json({ asOf, totals: { restaurants: 12, videos: 34, withCoordinates: 10 }, topCategories: [], videos: [] });
    if (url.startsWith('/api/admin/youtube-kpis')) return json({ asOf, period: '1M', totalVideos: 0, videos: [] });
    if (url.startsWith('/api/admin/youtube-channel')) return json({ subscriberCount: 100, videoCount: 34, viewCount: 1000 });
    if (url === '/api/admin/banners') {
      if (fixture.holdBanners) await new Promise(resolve => { fixture.waiters.push(resolve); });
      return json({ banners: [] });
    }
    return new Response('', { status: 503 });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminConsoleOverview /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['dashboard-headline-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'dashboard-headline-fixture', setup(builder) {
      builder.onResolve({ filter: /^dashboard-headline-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
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

const releaseBanners = (page: Page) => page.evaluate(() => {
  (globalThis as unknown as { __dashboardHeadline: { release: () => void } }).__dashboardHeadline.release();
});

(existsSync(chrome) ? test : test.skip)('a known dashboard headline stays visible while banners are still loading', async () => {
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
          if (route.request().isNavigationRequest() && route.request().url() === 'http://dashboard-headline.fixture.test/admin') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          }
          externalRequests += 1;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('http://dashboard-headline.fixture.test/admin');
        await page.addScriptTag({ content: script });
        const summary = page.locator('[data-admin-module-summary]');
        const submissions = page.locator('[data-admin-console-menu-item-mode="desktop-sidebar"][aria-label="제보 관리 대기 3건"]');
        await playwrightExpect(submissions).toHaveCount(1);
        if (width === 1280) await playwrightExpect(submissions).toBeVisible();
        await playwrightExpect(summary).toHaveText('대기 6건 · 맛집 12곳 · 영상 34개');
        await playwrightExpect(summary).not.toContainText('KPI 데이터 조회 중');
        await playwrightExpect(page.locator('[data-admin-dashboard-mobile-loading-prompt="live"]')).toHaveCount(0);
        await releaseBanners(page);
        await playwrightExpect(summary).toHaveText('대기 6건 · 맛집 12곳 · 영상 34개');
        await playwrightExpect(summary).not.toContainText('KPI 데이터 조회 중');
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 120_000);
