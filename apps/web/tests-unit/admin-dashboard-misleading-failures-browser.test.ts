import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const shared = `
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const unavailable = () => new Response('', { status: 503 });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const asOf = '2026-10-21T00:00:00Z';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
`;

const overviewEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
  import { buildAdminPendingCountsResponse } from './lib/admin/pending-counts';
  ${shared}
  const fixture = { logs: null, requests: [], holdLogs: false, holdInsights: false, insightWaiters: [], releaseLogs() {}, releaseInsights() { const pending = this.insightWaiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__fixture = fixture;
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    fixture.requests.push(url);
    if (url === '/api/admin/pending-counts') return json(buildAdminPendingCountsResponse({ restaurantSubmissions: 0, restaurantRecommendationRequests: 0, reviews: 0, recommendationRequestsLifecycleReady: true, asOf }));
    if (url === '/api/admin/banners') return json({ banners: [] });
    if (url === '/api/dashboard/summary') return json({ asOf, totals: { restaurants: 12, videos: 34, withCoordinates: 10 }, topCategories: [], videos: [] });
    if (url === '/api/admin/youtube-kpis' || url === '/api/insights/treemap' || url === '/api/admin/youtube-channel') {
      if (fixture.holdInsights) await new Promise(resolve => { fixture.insightWaiters.push(resolve); });
    }
    if (url === '/api/admin/youtube-kpi-collection-logs') {
      if (fixture.holdLogs) await new Promise(resolve => { fixture.releaseLogs = resolve; });
      if (fixture.logs) return json(fixture.logs);
    }
    return unavailable();
  };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminConsoleOverview /></main></QueryClientProvider>);
`;

const routeEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminOverviewDashboard } from './components/admin/AdminOverviewDashboard';
  ${shared}
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
    { id: 'r1', name: '첫 번째 맛집', category: '한식', address: '서울 중구', lat: 37.56, lng: 126.98 },
    { id: 'r2', name: '두 번째 맛집', category: '분식', address: '서울 종로구', lat: 37.57, lng: 126.99 },
    { id: 'r3', name: '세 번째 맛집', category: '중식', address: '서울 용산구', lat: 37.53, lng: 126.97 },
  ].map(item => ({ youtubeLink: null, videoId: null, sourceType: null, status: null, geocodingSuccess: true, isNotSelected: false, updatedAt: null, createdAt: null, ...item }));
  const fixture = { candidatesOk: false, candidatesDelayMs: 0, requests: [], holdOverlays: false, overlayWaiters: [], releaseOverlays() { const pending = this.overlayWaiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__fixture = fixture;
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    fixture.requests.push(url);
    if (url === '/api/dashboard/restaurants') return json({ asOf, total: 3, limit: 500, offset: 0, filters: { onlyWithCoordinates: true }, items: restaurants });
    if (url === '/api/admin/routes/candidates') {
      await wait(fixture.candidatesDelayMs);
      if (fixture.candidatesOk) return json({ ok: true, asOf, items: restaurants, candidateReadback: { candidateTotal: 3, candidateReturned: 3, candidateLimit: 5, truncated: false, candidateSource: 'visible-bbox', excludedNoCoordinateCount: 0, selectedAnchorIncluded: true, exclusions: [] } });
    }
    if (url === '/api/admin/map-overlays') {
      if (fixture.holdOverlays) await new Promise(resolve => { fixture.overlayWaiters.push(resolve); });
    }
    return unavailable();
  };
  const stats = { pendingSubmissions: 0, pendingReviews: 0, totalRestaurants: 3, totalVideos: 0, activeBanners: 0 };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminOverviewDashboard stats={stats} isLoading={false} hasError={false} onSelectModule={() => {}} /></main></QueryClientProvider>);
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

type Fixture = { requests: string[]; logs?: unknown; holdLogs?: boolean; holdInsights?: boolean; holdOverlays?: boolean; releaseLogs?: () => void; releaseInsights?: () => void; releaseOverlays?: () => void; candidatesOk?: boolean; candidatesDelayMs?: number };
const setFixture = (page: Page, patch: Partial<Fixture>) =>
  page.evaluate(next => Object.assign((globalThis as unknown as { __fixture: Fixture }).__fixture, next), patch);
const requestCount = async (page: Page, path: string) =>
  (await page.evaluate(() => (globalThis as unknown as { __fixture: Fixture }).__fixture.requests)).filter(url => url === path).length;

async function withPage(browser: Browser, width: number, script: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await context.newPage();
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
    await run(page);
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

const browserTest = existsSync(chrome) ? test : test.skip;

browserTest('failed dashboard metric and collection-log reads are not shown as zeros, empty data or missing permission', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(overviewEntry);
    for (const width of [1440, 390]) {
      await withPage(browser, width, script, async page => {
        const viewsValue = page.locator('[data-admin-dashboard-widget-card="views"] [data-admin-dashboard-kpi-value-size="bounded"]');
        await playwrightExpect(page.locator('[data-admin-dashboard-read-error]').first()).toBeVisible();
        await playwrightExpect(viewsValue).toHaveText('—');
        await playwrightExpect(page.locator('[data-admin-dashboard-widget-card="views"] [data-admin-dashboard-kpi-caption]')).toContainText('현재 전체 누적 —');
        const impact = page.locator('[data-admin-dashboard-widget-card="impact"]');
        await impact.scrollIntoViewIfNeeded();
        await playwrightExpect(impact.locator('[data-admin-dashboard-metric-read-failed]')).toBeVisible();
        await playwrightExpect(impact).toContainText('전체 —개');
        await playwrightExpect(page.getByText('표시할 영상 영향도 데이터가 없습니다.')).toHaveCount(0);
        await setFixture(page, { holdInsights: true });
        const metricAlert = page.locator('[data-admin-dashboard-read-error="metrics"]');
        const metricRetry = metricAlert.getByRole('button');
        await metricRetry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(metricRetry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(metricRetry).toBeFocused();
        await playwrightExpect(impact.locator('[data-admin-dashboard-metric-read-failed]')).toBeVisible();
        await playwrightExpect(impact.locator('[data-admin-dashboard-dynamic-skeleton]')).toHaveCount(0);
        await playwrightExpect(page.getByText('표시할 영상 영향도 데이터가 없습니다.')).toHaveCount(0);
        const subscribers = page.locator('[data-admin-dashboard-widget-card="subscribers"]');
        await playwrightExpect(subscribers.locator('[data-admin-dashboard-kpi-caption]')).toHaveText('채널 통계 확인 필요');
        await playwrightExpect(subscribers.locator('[data-admin-dashboard-dynamic-skeleton="kpi"]')).toHaveCount(0);
        await playwrightExpect(subscribers.getByText('채널 통계 불러오는 중')).toHaveCount(0);
        await setFixture(page, { holdInsights: false });
        await page.evaluate(() => (globalThis as unknown as { __fixture: { releaseInsights: () => void } }).__fixture.releaseInsights());
        await page.locator('[data-admin-dashboard-kpi-collection-log-trigger]').scrollIntoViewIfNeeded();

        await page.locator('[data-admin-dashboard-kpi-collection-log-trigger]').click();
        const popover = page.locator('[data-admin-dashboard-kpi-collection-log-panel]');
        await playwrightExpect(popover.locator('[data-admin-dashboard-kpi-collection-log-read-failed]')).toHaveText(
          '수집 상태를 불러오지 못했습니다. 갱신을 눌러 다시 확인해 주세요.');
        await playwrightExpect(popover).not.toContainText('권한');
        await playwrightExpect(popover).not.toContainText('저장된 스냅샷 없음');

        const refresh = popover.getByRole('button', { name: '갱신' });
        await setFixture(page, { holdLogs: true });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await playwrightExpect(popover.locator('[data-admin-dashboard-kpi-collection-log-read-failed]')).toHaveText(
          '수집 상태를 불러오지 못했습니다. 갱신을 눌러 다시 확인해 주세요.');

        await setFixture(page, { holdLogs: false, logs: {
          asOf: '2026-10-21T00:00:00Z',
          workflow: { available: false, repository: 'twoimo/tzudong', workflowId: 'youtube-kpi-snapshot.yml', runs: [], latestJobs: [], error: 'github-runs-502' },
          snapshot: { available: false, error: 'SNAPSHOT_QUERY_FAILED' },
        } });
        await page.evaluate(() => (globalThis as unknown as { __fixture: { releaseLogs: () => void } }).__fixture.releaseLogs());
        await playwrightExpect(popover).toContainText('로그 확인 실패');
        await playwrightExpect(popover).toContainText('스냅샷 조회 실패');
        await playwrightExpect(popover).not.toContainText('권한');
        await playwrightExpect(refresh).toBeFocused();

        await setFixture(page, { logs: {
          asOf: '2026-10-21T00:00:00Z',
          workflow: { available: false, repository: 'twoimo/tzudong', workflowId: 'youtube-kpi-snapshot.yml', runs: [], latestJobs: [], error: 'github-runs-403' },
          snapshot: { available: false, error: 'snapshot-empty' },
        } });
        await refresh.click();
        await playwrightExpect(popover).toContainText('로그 권한 필요');
        await playwrightExpect(popover).toContainText('GITHUB_ACTIONS_TOKEN');
        await playwrightExpect(popover).toContainText('저장된 스냅샷 없음');
      });
    }
  } finally {
    await browser.close();
  }
}, 90_000);

browserTest('a failed route candidate read shows no invented readback or export and can be retried in place', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(routeEntry);
    for (const width of [1280, 390]) {
      await withPage(browser, width, script, async page => {
        const alert = page.locator('[data-admin-route-candidates-read-failed]');
        const quality = page.locator('[data-admin-route-quality-panel]');
        const exportBlock = page.locator('div[data-admin-route-export="tzudong-json-v1"][data-admin-route-candidate-source]');
        await playwrightExpect(alert).toContainText('동선 후보를 불러오지 못했습니다.');
        await playwrightExpect(quality).toContainText('후보 출처조회 실패');
        await playwrightExpect(quality).toContainText('후보 readback—');
        await playwrightExpect(page.locator('[data-admin-route-export="unavailable"]')).toBeVisible();
        await playwrightExpect(exportBlock).toHaveCount(0);
        await playwrightExpect(page.getByText('k-nearest')).toHaveCount(0);
        const before = await requestCount(page, '/api/admin/routes/candidates');

        await setFixture(page, { candidatesDelayMs: 600 });
        const retry = alert.getByRole('button', { name: '후보 다시 조회' });
        await retry.scrollIntoViewIfNeeded();
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(alert.getByRole('button', { name: '조회 중…' })).toBeFocused();
        await playwrightExpect(alert.getByRole('button', { name: '후보 다시 조회' })).toBeFocused();
        expect(await requestCount(page, '/api/admin/routes/candidates')).toBe(before + 1);

        await setFixture(page, { candidatesOk: true });
        await page.keyboard.press('Enter');
        await playwrightExpect(alert).toHaveCount(0);
        await playwrightExpect(quality).toContainText('후보 출처visible-bbox');
        await playwrightExpect(quality).toContainText('후보 readback3/3');
        await playwrightExpect(quality).toBeFocused();
        await playwrightExpect(exportBlock).toHaveAttribute('data-admin-route-candidate-source', 'visible-bbox');
        await playwrightExpect(exportBlock).toContainText('source=visible-bbox');
        expect(await requestCount(page, '/api/admin/routes/candidates')).toBe(before + 2);
      });
    }
  } finally {
    await browser.close();
  }
}, 90_000);

browserTest('a failed map overlay read stays failed when the overlay layer is opened again', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(routeEntry);
    for (const width of [1280, 390]) {
      await withPage(browser, width, script, async page => {
        const toggle = page.getByRole('button', { name: '관리자 오버레이' });
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        const status = page.locator('[data-admin-map-overlay-status]');
        await playwrightExpect(status).toHaveText('오버레이를 불러오지 못했습니다');
        await setFixture(page, { holdOverlays: true });
        await toggle.click();
        await playwrightExpect(status).toHaveCount(0);
        await toggle.click();
        await playwrightExpect(status).toHaveText('오버레이를 불러오지 못했습니다');
        await playwrightExpect(page.getByText('오버레이 확인 중')).toHaveCount(0);
        await playwrightExpect(page.getByText('등록된 활성 오버레이 없음')).toHaveCount(0);
        await setFixture(page, { holdOverlays: false });
        await page.evaluate(() => (globalThis as unknown as { __fixture: { releaseOverlays: () => void } }).__fixture.releaseOverlays());
        await playwrightExpect(status).toHaveText('오버레이를 불러오지 못했습니다');
      });
    }
  } finally {
    await browser.close();
  }
}, 90_000);
