import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const knownZeroEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
  import { buildAdminPendingCountsResponse } from './lib/admin/pending-counts';
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const asOf = '2026-10-21T00:00:00.000Z';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/admin/pending-counts') return json(buildAdminPendingCountsResponse({ restaurantSubmissions: 0, restaurantRecommendationRequests: 0, reviews: 0, recommendationRequestsLifecycleReady: true, asOf }));
    if (url === '/api/admin/banners') return json({ banners: [] });
    if (url === '/api/dashboard/summary') return json({ asOf, totals: { restaurants: 0, videos: 0, withCoordinates: 0 }, topCategories: [], videos: [] });
    return new Response('', { status: 503 });
  };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminConsoleOverview /></main></QueryClientProvider>);
`;

const overviewEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const asOf = '2026-10-21T00:00:00.000Z';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/admin/pending-counts') return json({ asOf, domains: {
      restaurant_submissions: { id: 'restaurant_submissions' },
      restaurant_recommendation_requests: { id: 'restaurant_recommendation_requests', ready: false },
      reviews: { id: 'reviews' },
    } });
    if (url === '/api/dashboard/summary') return json({ asOf, totals: {} });
    return new Response('', { status: 503 });
  };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminConsoleOverview /></main></QueryClientProvider>);
`;

async function bundle(entry: string) {
  const built = await Bun.build({
    entrypoints: ['dashboard-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'dashboard-fixture', setup(builder) {
      builder.onResolve({ filter: /^dashboard-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/hooks\/use-naver-maps$/ }, () => ({ path: 'naver', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        naver: "const state = { isLoaded: true, loadError: null, isLoading: false, load() {} }; export const useNaverMaps = () => state;",
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


(existsSync(chrome) ? test : test.skip)('unknown dashboard operations counts stay unknown instead of becoming zero', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(overviewEntry);
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://dashboard.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://dashboard.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://dashboard.test/admin');
        await page.addScriptTag({ content: script });
        const ops = page.locator('[data-admin-dashboard-widget-card="ops"]');
        await ops.scrollIntoViewIfNeeded();
        const valueOf = (label: string) => ops.getByText(label, { exact: true }).locator('xpath=following-sibling::span[1]');
        await playwrightExpect(ops.locator('[data-admin-dashboard-card-title-delta]')).toHaveText('(검수 리스크 —)');
        await playwrightExpect(valueOf('운영 자산')).toHaveText('—');
        await playwrightExpect(valueOf('검수 리스크')).toHaveText('—');
        for (const label of ['제보 대기', '추천 대기', '리뷰 대기', '맛집 데이터', '좌표 미완료', '비활성 배너']) {
          await playwrightExpect(valueOf(label)).toHaveText('—');
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
}, 90_000);

(existsSync(chrome) ? test : test.skip)('confirmed zero dashboard operations counts still show zero', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(knownZeroEntry);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      const pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://dashboard.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      await page.goto('https://dashboard.test/admin');
      await page.addScriptTag({ content: script });
      const ops = page.locator('[data-admin-dashboard-widget-card="ops"]');
      await ops.scrollIntoViewIfNeeded();
      const valueOf = (label: string) => ops.getByText(label, { exact: true }).locator('xpath=following-sibling::span[1]');
      await playwrightExpect(ops.locator('[data-admin-dashboard-card-title-delta]')).toHaveText('(검수 리스크 0)');
      await playwrightExpect(valueOf('운영 자산')).toHaveText('0');
      await playwrightExpect(valueOf('제보 대기')).toHaveText('0');
      await playwrightExpect(valueOf('맛집 데이터')).toHaveText('0');
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}, 60_000);
