import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const routeEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminOverviewDashboard } from './components/admin/AdminOverviewDashboard';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  const fixture = { hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__routeRestaurants = fixture;
  globalThis.__routeQueryClient = client;
  const bounds = { getSW: () => ({ lat: () => 37.4, lng: () => 126.8 }), getNE: () => ({ lat: () => 37.7, lng: () => 127.2 }) };
  const stub = () => new Proxy(function () {}, {
    get: (_, key) => typeof key === 'symbol' || key === 'then' ? undefined
      : key === 'getBounds' ? () => bounds
      : key === 'getZoom' ? () => 12
      : key === 'valueOf' ? () => 0
      : key === 'toString' ? () => ''
      : stub(),
    apply: () => stub(),
    construct: () => stub(),
  });
  window.naver = { maps: stub() };
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/dashboard/restaurants') {
      if (fixture.hold) await new Promise(resolve => { fixture.waiters.push(resolve); });
      return new Response(JSON.stringify({ error: 'Failed to build dashboard restaurants.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 503 });
  };
  const stats = { pendingSubmissions: 0, pendingReviews: 0, totalRestaurants: 3, totalVideos: 0, activeBanners: 0 };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminOverviewDashboard stats={stats} isLoading={false} hasError={false} onSelectModule={() => {}} /></main></QueryClientProvider>);
`;

async function bundle(entry: string, naverSource = "const state = { isLoaded: true, loadError: null, isLoading: false, load() {} }; export const useNaverMaps = () => state;") {
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
        naver: naverSource,
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


(existsSync(chrome) ? test : test.skip)('a failed restaurant read does not show an empty local route', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(routeEntry);
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://routes.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://routes.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://routes.test/admin');
        await page.addScriptTag({ content: script });
        const quality = page.locator('[data-admin-route-quality-panel]');
        await quality.scrollIntoViewIfNeeded();
        const cell = (label: string) => quality.getByText(label, { exact: true }).locator('xpath=following-sibling::p');
        await playwrightExpect(cell('좌표 맛집')).toHaveText('미확인');
        await playwrightExpect(cell('추천 지점')).toHaveText('미확인');
        await playwrightExpect(cell('도로 경로')).toHaveText('미확인');
        await playwrightExpect(page.getByText('거리 기반 후보', { exact: true })).toHaveCount(0);
        await playwrightExpect(page.getByText('로컬 후보', { exact: true })).toHaveCount(0);
        await playwrightExpect(page.getByText('동선 미확인')).toBeVisible();
        const overlay = page.locator('[data-admin-map-status-overlay]');
        await playwrightExpect(overlay).toContainText('좌표 맛집 목록을 불러오지 못했습니다.');
        await playwrightExpect(overlay).not.toContainText('요약 API가 실패하면');
        await page.evaluate(() => {
          const fixture = (globalThis as unknown as { __routeRestaurants: { hold: boolean } }).__routeRestaurants;
          const client = (globalThis as unknown as { __routeQueryClient: { refetchQueries: (filters: { queryKey: string[] }) => Promise<unknown> } }).__routeQueryClient;
          fixture.hold = true;
          void client.refetchQueries({ queryKey: ['admin-overview', 'map-restaurants'] }).catch(() => {});
        });
        await playwrightExpect(overlay).toContainText('좌표 맛집 목록을 불러오지 못했습니다.');
        await playwrightExpect(cell('좌표 맛집')).toHaveText('미확인');
        await playwrightExpect(page.getByText('표시할 좌표 맛집이 없습니다')).toHaveCount(0);
        await playwrightExpect(page.getByText('거리 기반 후보', { exact: true })).toHaveCount(0);
        await playwrightExpect(page.getByRole('status', { name: '관리자 네이버 지도 로딩' })).toHaveCount(0);
        await page.evaluate(() => {
          const fixture = (globalThis as unknown as { __routeRestaurants: { hold: boolean; release: () => void } }).__routeRestaurants;
          fixture.hold = false;
          fixture.release();
        });
        await playwrightExpect(overlay).toContainText('좌표 맛집 목록을 불러오지 못했습니다.');
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

const mapSdkNaver = `
  import { useSyncExternalStore } from 'react';
  const listeners = new Set();
  let snapshot = { isLoaded: false, loadError: new Error('map-failed'), isLoading: false };
  const emit = patch => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  export function useNaverMaps() {
    const current = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot, () => snapshot);
    return { ...current, load() { emit({ loadError: null, isLoading: true }); } };
  }
`;

(existsSync(chrome) ? test : test.skip)('a failed admin map sdk load stays failed while retrying', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(routeEntry, mapSdkNaver);
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://routes.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://routes.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://routes.test/admin');
        await page.addScriptTag({ content: script });
        const alert = page.getByRole('alert').filter({ hasText: '네이버 지도를 불러오지 못했습니다' });
        const retry = alert.getByRole('button', { name: '다시 시도' });
        await playwrightExpect(alert).toBeVisible();
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).not.toHaveAttribute('disabled');
        await playwrightExpect(alert).toBeVisible();
        await playwrightExpect(page.getByRole('status', { name: '관리자 네이버 지도 로딩' })).toHaveCount(0);
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
