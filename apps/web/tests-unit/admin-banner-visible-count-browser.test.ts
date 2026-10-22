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
    const row = {
      id: '11111111-1111-4111-8111-111111111111', title: '봄 배너', description: null, image_url: null, video_url: null, media_type: 'none',
      link_url: null, is_active: true, priority: 3, display_target: ['sidebar'], created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-21T00:00:00Z', created_by: null,
    };
    const fixture = { reads: 0 };
    globalThis.__bannerVisibleCount = fixture;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === '/api/admin/banners') {
        fixture.reads += 1;
        if (fixture.reads === 1) return new Response(JSON.stringify({ banners: [row] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><BannerManagementRoutePage.Embedded embedded /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['banner-visible-count-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'banner-visible-count-fixture', setup(builder) {
      builder.onResolve({ filter: /^banner-visible-count-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
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

(existsSync(chrome) ? test : test.skip)('a visible banner list keeps its header count when the next read fails', async () => {
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
          if (route.request().url() === 'https://banner-visible-count.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (new URL(route.request().url()).origin !== 'https://banner-visible-count.test') externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://banner-visible-count.test/admin');
        await page.addScriptTag({ content: script });

        const header = page.locator('[data-admin-module-header]');
        const list = page.locator('[aria-label="배너 목록"]').first();
        const footer = page.locator('.admin-cms-footer');
        await playwrightExpect(list).toContainText('봄 배너');
        await playwrightExpect(header).toContainText('1개');
        await playwrightExpect(header).not.toContainText('미확인');
        await playwrightExpect(footer).toContainText('1 / 1개');

        await page.getByRole('button', { name: '배너 목록 새로고침' }).click();
        const alert = page.getByRole('alert');
        await playwrightExpect(alert).toContainText('이전 목록을 표시합니다.');
        await playwrightExpect(list).toContainText('봄 배너');
        await playwrightExpect(header).toContainText('1개');
        await playwrightExpect(header).not.toContainText('미확인');
        await playwrightExpect(footer).toContainText('1 / 1개');
        await playwrightExpect(footer).not.toContainText('미확인');
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
