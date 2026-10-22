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
  import BannerManagementRoutePage from './app/admin/banners/page';
  import { AppToaster } from './components/ui/app-toaster';
  const row = (title, updatedAt) => ({
    id: '11111111-1111-4111-8111-111111111111', title, description: null, image_url: null, video_url: null, media_type: 'none',
    link_url: null, is_active: true, priority: 0, display_target: ['sidebar'], created_at: '2026-10-20T00:00:00Z', updated_at: updatedAt, created_by: null,
  });
  const fixture = { patch: 'conflict', listAfterPatch: true, patched: false, deleted: false };
  globalThis.__fixture = fixture;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/admin/banners' && init.method === 'PATCH') {
      fixture.patched = true;
      if (fixture.patch === 'conflict') return json({ code: 'banner_revision_conflict', banner: row('다른 관리자 제목', '2026-10-21T01:00:00Z') }, 409);
      return json({ banner: row('수정한 제목', '2026-10-21T02:00:00Z') });
    }
    if (url === '/api/admin/banners' && init.method === 'DELETE') {
      fixture.deleted = true;
      return json({ deletedBanner: row('봄 배너', '2026-10-21T00:00:00Z') });
    }
    if (url === '/api/admin/banners') {
      if (fixture.deleted || (fixture.patched && !fixture.listAfterPatch)) return json({ banners: [] });
      return json({ banners: [fixture.patched ? row('수정한 제목', '2026-10-21T02:00:00Z') : row('봄 배너', '2026-10-21T00:00:00Z')] });
    }
    return new Response('', { status: 503 });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><BannerManagementRoutePage.Embedded embedded /></main><AppToaster /></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['banner-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'banner-fixture', setup(builder) {
      builder.onResolve({ filter: /^banner-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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

const setFixture = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate(next => Object.assign((globalThis as unknown as { __fixture: object }).__fixture, next), patch);

async function openPage(context: import('@playwright/test').BrowserContext, script: string) {
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const external = { count: 0 };
  page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
  await page.route('**/*', route => {
    if (route.request().url() === 'https://banners.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (!route.request().url().startsWith('https://banners.test/')) external.count++;
    return route.abort();
  });
  await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
  await page.goto('https://banners.test/admin');
  await page.addScriptTag({ content: script });
  return { page, pageErrors, external };
}

(existsSync(chrome) ? test : test.skip)('a banner save reports its outcome once, without a contradicting hook toast', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    const cases = [
      { width: 1400, patch: 'conflict', listAfterPatch: true, message: '배너가 다른 관리자에 의해 변경되어 현재 입력을 보존했습니다.' },
      { width: 390, patch: 'conflict', listAfterPatch: true, message: '배너가 다른 관리자에 의해 변경되어 현재 입력을 보존했습니다.' },
      { width: 1400, patch: 'saved', listAfterPatch: false, message: '저장 뒤 배너가 목록에서 사라져 상세를 닫았습니다.' },
    ];
    for (const scenario of cases) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 } });
      try {
        const { page, pageErrors, external } = await openPage(context, script);
        await setFixture(page, { patch: scenario.patch, listAfterPatch: scenario.listAfterPatch });

        await page.getByRole('button', { name: /^봄 배너 편집/ }).click();
        await page.locator('#title').fill('수정한 제목');
        await page.getByRole('button', { name: '수정 저장' }).click();

        await playwrightExpect(page.getByText(scenario.message)).toBeVisible();
        await page.waitForTimeout(300);
        await playwrightExpect(page.getByText('배너 수정 실패')).toHaveCount(0);
        await playwrightExpect(page.getByText('배너 수정 완료')).toHaveCount(0);
        await playwrightExpect(page.getByText('처리 결과를 확인할 수 없습니다. 목록을 새로고침해 확인해 주세요.')).toHaveCount(0);
        expect(external.count).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);

(existsSync(chrome) ? test : test.skip)('on wide screens a confirmed banner save or delete keeps keyboard focus in the editor pane', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      const { page, pageErrors, external } = await openPage(context, script);
      const editor = page.locator('section[aria-labelledby="banner-editor-title"]');
      await setFixture(page, { patch: 'saved', listAfterPatch: true });
      await page.getByRole('button', { name: /^봄 배너 편집/ }).click();
      await page.locator('#title').fill('수정한 제목');
      await page.getByRole('button', { name: '수정 저장' }).focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(page.getByText('저장한 배너 상태를 목록에서 다시 확인했습니다.')).toBeVisible();
      await playwrightExpect(editor).toBeFocused();

      await page.getByLabel('배너 삭제 확인 문구').fill('배너삭제');
      await page.getByRole('button', { name: '삭제', exact: true }).focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(page.getByText('배너가 목록에서 삭제된 것을 확인했습니다.')).toBeVisible();
      await playwrightExpect(editor).toBeFocused();
      await playwrightExpect(editor).toContainText('배너를 선택하면 내용과 노출 설정을 편집할 수 있습니다.');
      expect(external.count).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}, 60_000);
