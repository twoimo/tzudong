import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminOverviewDashboard } from './components/admin/AdminOverviewDashboard';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  const restaurants = [
    { id: 'r1', name: '이전 맛집', category: '한식', address: '서울 중구', lat: 37.56, lng: 126.98 },
    { id: 'r2', name: '다음 맛집', category: '분식', address: '서울 종로구', lat: 37.57, lng: 126.99 },
  ].map(item => ({ youtubeLink: null, videoId: null, sourceType: null, status: null, geocodingSuccess: true, isNotSelected: false, updatedAt: null, createdAt: null, ...item }));
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
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/dashboard/restaurants') return json({ asOf: '2026-10-21T00:00:00Z', total: 2, limit: 500, offset: 0, filters: { onlyWithCoordinates: true }, items: restaurants });
    if (url === '/api/admin/routes/candidates') return json({ ok: true, asOf: '2026-10-21T00:00:00Z', items: restaurants, candidateReadback: { candidateTotal: 2, candidateReturned: 2, candidateLimit: 7, truncated: false, candidateSource: 'visible-bbox', excludedNoCoordinateCount: 0, selectedAnchorIncluded: true, exclusions: [] } });
    if (url === '/api/admin/routes/directions') return json({
      provider: 'naver-directions5',
      path: [{ lat: 37.56, lng: 126.98 }, { lat: 37.57, lng: 126.99 }],
      summary: { distance: 54321, duration: 600000 },
      directionsReadback: { provider: 'naver-directions5', providerCache: 'hit', fallbackReasonCode: null },
    });
    return new Response('', { status: 503 });
  };
  const stats = { pendingSubmissions: 0, pendingReviews: 0, totalRestaurants: 2, totalVideos: 0, activeBanners: 0 };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminOverviewDashboard stats={stats} isLoading={true} hasError={false} onSelectModule={() => {}} /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['route-stats-loading-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'route-stats-loading-fixture', setup(builder) {
      builder.onResolve({ filter: /^route-stats-loading-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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
        navigation: "const params = new URLSearchParams('module=routes'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default function Link({ href, children, prefetch, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; }",
        dynamic: "import React from 'react'; export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

(existsSync(chrome) ? test : test.skip)('a visible route keeps its status while another admin source is still loading', async () => {
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
          if (route.request().isNavigationRequest() && route.request().url() === 'http://route-stats-loading.fixture.test/admin') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          }
          externalRequests += 1;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('http://route-stats-loading.fixture.test/admin');
        await page.addScriptTag({ content: script });
        const planner = page.getByRole('region', { name: '동선 추천 초안' });
        const stops = planner.locator('[data-admin-route-stop-list]');
        await playwrightExpect(stops.getByText('이전 맛집', { exact: true })).toBeVisible();
        await playwrightExpect(planner.getByText('54.3km')).toBeVisible();
        await playwrightExpect(planner.getByText('실제 도로 경로', { exact: true })).toBeVisible();
        await playwrightExpect(page.locator('[data-admin-map-loading-skeleton="true"]')).toHaveCount(0);
        await playwrightExpect(page.getByText('네이버 지도를 준비하고 있습니다.')).toHaveCount(0);
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
