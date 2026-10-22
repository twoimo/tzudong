import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminOverviewDashboard } from './components/admin/AdminOverviewDashboard';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  const overlay = (id, label) => ({ restaurantId: id, overlayType: 'trend', label, description: null, activeFrom: null, activeUntil: null, evidence: {}, isActive: true, updatedAt: '2026-10-21T00:00:00Z', createdAt: '2026-10-21T00:00:00Z' });
  const fixture = { hold: false, phase: 'one', requests: [], waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__fixture = fixture;
  globalThis.__client = client;
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
  const restaurants = [
    { id: 'r1', name: '이전 맛집', category: '한식', address: '서울 중구', lat: 37.56, lng: 126.98 },
    { id: 'r2', name: '다음 맛집', category: '분식', address: '서울 종로구', lat: 37.57, lng: 126.99 },
  ].map(item => ({ youtubeLink: null, videoId: null, sourceType: null, status: null, geocodingSuccess: true, isNotSelected: false, updatedAt: null, createdAt: null, ...item }));
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    fixture.requests.push(url);
    if (url === '/api/dashboard/restaurants') return new Response(JSON.stringify({ asOf: '2026-10-21T00:00:00Z', total: 2, limit: 500, offset: 0, filters: { onlyWithCoordinates: true }, items: restaurants }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/admin/map-overlays') {
      if (fixture.hold) await new Promise(resolve => { fixture.waiters.push(resolve); });
      const overlays = fixture.phase === 'two' ? [overlay('r1', '이전 오버레이'), overlay('r2', '다음 오버레이')] : [overlay('r1', '이전 오버레이')];
      return new Response(JSON.stringify({ overlays, meta: { checkedAt: '2026-10-21T00:00:00Z', source: 'admin_restaurant_map_overlays', cache: 'no-store', requestedTypes: ['trend', 'seasonal'] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 503 });
  };
  const stats = { pendingSubmissions: 0, pendingReviews: 0, totalRestaurants: 2, totalVideos: 0, activeBanners: 0 };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminOverviewDashboard stats={stats} isLoading={false} hasError={false} onSelectModule={() => {}} /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['overlay-visible-status-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'overlay-visible-status-fixture', setup(builder) {
      builder.onResolve({ filter: /^overlay-visible-status-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/hooks\/use-naver-maps$/ }, () => ({ path: 'naver', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
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

type Fixture = { hold: boolean; phase: string; requests: string[] };
const setFixture = (page: Page, patch: Partial<Fixture>) =>
  page.evaluate(next => Object.assign((globalThis as unknown as { __fixture: Fixture }).__fixture, next), patch);
const requestCount = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __fixture: Fixture }).__fixture.requests.filter(url => url === '/api/admin/map-overlays').length);

async function withPage(browser: Browser, width: number, script: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://overlay-visible-status.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      if (new URL(route.request().url()).origin !== 'https://overlay-visible-status.test') externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.goto('https://overlay-visible-status.test/admin');
    await page.addScriptTag({ content: script });
    await run(page);
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

(existsSync(chrome) ? test : test.skip)('a visible overlay list keeps its status while the list is read again', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      await withPage(browser, width, script, async page => {
        const toggle = page.getByRole('button', { name: /관리자 오버레이/ });
        const status = page.locator('[data-admin-map-overlay-status]');
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        await playwrightExpect(status).toHaveText('트렌드·제철 표시 중');
        await playwrightExpect(toggle).toContainText('1');

        await setFixture(page, { hold: true, phase: 'two' });
        await page.evaluate(() => {
          void (globalThis as unknown as { __client: { refetchQueries(filter: object): Promise<void> } }).__client
            .refetchQueries({ queryKey: ['admin-overview', 'map-overlays'] });
        });
        await playwrightExpect.poll(() => requestCount(page)).toBe(2);
        await playwrightExpect(status).toHaveText('트렌드·제철 표시 중');
        await playwrightExpect(status).not.toHaveText('오버레이 확인 중');
        await playwrightExpect(toggle).toContainText('1');

        await setFixture(page, { hold: false });
        await page.evaluate(() => (globalThis as unknown as { __fixture: { release: () => void } }).__fixture.release());
        await playwrightExpect(toggle).toContainText('2');
        await playwrightExpect(status).toHaveText('트렌드·제철 표시 중');
      });
    }
  } finally {
    await browser.close();
  }
}, 180_000);
