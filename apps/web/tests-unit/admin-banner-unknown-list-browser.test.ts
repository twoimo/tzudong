import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import BannerManagementRoutePage from './app/admin/banners/page';
    const fixture = { requests: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__bannerList = fixture;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === '/api/admin/banners') {
        fixture.requests += 1;
        if (fixture.hold && fixture.requests > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><BannerManagementRoutePage.Embedded embedded /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['banner-list-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'banner-list-fixture', setup(builder) {
      builder.onResolve({ filter: /^banner-list-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, storage: { from() { throw new Error('OFFLINE_ONLY'); } }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        navigation: "const params = new URLSearchParams('module=banners'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

(existsSync(chrome) ? test : test.skip)('a failed banner list does not look like an empty catalog', async () => {
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
          if (route.request().url() === 'https://banner-list.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (new URL(route.request().url()).origin !== 'https://banner-list.test') externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://banner-list.test/admin');
        await page.addScriptTag({ content: script });

        const alert = page.getByRole('alert');
        await playwrightExpect(alert).toContainText('배너 목록을 불러오지 못했습니다.');
        await playwrightExpect(page.locator('[data-admin-module-header]')).toContainText('미확인');
        await playwrightExpect(page.getByText('배너 목록을 확인하지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByText('조회가 완료되면 배너 목록을 표시합니다.')).toHaveCount(0);
        await playwrightExpect(page.getByText('등록된 배너가 없습니다. 새 배너를 추가해 보세요.')).toHaveCount(0);
        await playwrightExpect(page.locator('.admin-cms-footer')).toContainText('미확인');
        await playwrightExpect(page.locator('.admin-cms-footer')).not.toContainText('0 / 0개');

        await page.evaluate(() => { (globalThis as unknown as { __bannerList: { hold: boolean } }).__bannerList.hold = true; });
        const retry = alert.getByRole('button', { name: '다시 시도' });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).not.toHaveAttribute('disabled');
        await playwrightExpect(page.getByText('배너 목록을 확인하지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.locator('[data-admin-module-header]')).toContainText('미확인');
        await playwrightExpect(page.locator('[data-admin-module-header]')).not.toContainText('0개');
        await page.evaluate(() => (globalThis as unknown as { __bannerList: { release: () => void } }).__bannerList.release());
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(alert).toContainText('배너 목록을 불러오지 못했습니다.');
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
