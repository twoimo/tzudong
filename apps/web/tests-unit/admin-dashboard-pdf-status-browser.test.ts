import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const overviewEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
  import { buildAdminPendingCountsResponse } from './lib/admin/pending-counts';
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const asOf = '2026-10-21T00:00:00Z';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/admin/pending-counts') return json(buildAdminPendingCountsResponse({ restaurantSubmissions: 0, restaurantRecommendationRequests: 0, reviews: 0, recommendationRequestsLifecycleReady: true, asOf }));
    if (url === '/api/admin/banners') return json({ banners: [] });
    if (url === '/api/dashboard/summary') return json({ asOf, totals: { restaurants: 12, videos: 34, withCoordinates: 10 }, topCategories: [], videos: [] });
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


(existsSync(chrome) ? test : test.skip)('a PDF report export reports its result while the card-order editor stays closed', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(overviewEntry);
    for (const [width, opened] of [[1280, false], [390, true]] as const) {
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
        await page.addInitScript(popupOpens => {
          (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } };
          window.open = () => popupOpens ? { opener: null, focus() {}, print() {}, close() {}, document: { open() {}, write() {}, close() {} } } as unknown as Window : null;
        }, opened);
        await page.goto('https://dashboard.test/admin');
        await page.addScriptTag({ content: script });
        await page.locator('[data-admin-dashboard-kpi-pdf-export-trigger]').click();
        const expected = opened
          ? 'PDF 보고서 창을 열었습니다. 새 창에서 PDF로 저장/인쇄 버튼이나 브라우저 인쇄 대화상자를 확인해 주세요.'
          : 'PDF 보고서 창을 열지 못했습니다. 브라우저 팝업 허용 상태를 확인해 주세요.';
        await playwrightExpect(page.getByRole('status').filter({ hasText: expected })).toBeVisible();
        await playwrightExpect(page.locator('[data-admin-dashboard-order-live-status]')).toHaveCount(0);
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
