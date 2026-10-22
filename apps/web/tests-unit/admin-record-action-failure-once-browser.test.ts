import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser } from '@playwright/test';
import { RECORD_ACTION_CONFIRMATION } from '../lib/admin/record-action-contract';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import AdminEvaluationRoutePage from './app/admin/evaluations/page';
  import { AppToaster } from './components/ui/app-toaster';
  const id = '33333333-3333-4333-8333-333333333333';
  const fixture = { recordActionPosts: 0, recordAction: 'forbidden', deleted: false, refreshOk: false };
  globalThis.__fixture = fixture;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const onePage = { records: [{ id, name: '권한 확인 맛집', status: 'pending' }], revision: '1', filteredTotal: 1, nextCursor: null,
    warnings: { [id]: { sameVideo: { count: 0, candidates: [], message: '' }, identity: [] } },
    stats: { total: 0, pending: 0, approved: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0, deleted: 0 } };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.href);
    if (url.pathname === '/api/admin/evaluations' && url.searchParams.get('view') === 'page') {
      return json(fixture.deleted ? { ...onePage, records: [], warnings: {}, filteredTotal: 0 } : onePage);
    }
    if (fixture.refreshOk && url.pathname === '/api/admin/submissions') return json({ submissions: [] });
    if (fixture.refreshOk && url.pathname === '/api/admin/restaurant-requests') return json({ requests: [] });
    if (fixture.refreshOk && url.pathname === '/api/admin/pending-counts') return json({ submissions: 0, reviews: 0 });
    if (url.pathname === '/api/admin/record-actions') {
      if (init.method === 'POST') fixture.recordActionPosts++;
      if (fixture.recordAction === 'forbidden') return json({ code: 'RECORD_ACTION_FORBIDDEN' }, 403);
      if (init.method === 'POST') fixture.lastRequest = JSON.parse(init.body);
      const body = fixture.lastRequest, applied = init.method !== 'POST' || body.phase === 'apply';
      if (applied) fixture.deleted = true;
      return json({ success: true, receipt: { operationId: body.operationId, action: body.action, state: applied ? 'applied' : 'preview', previewHash: 'a'.repeat(64),
        targetIds: body.targetIds, auditId: applied ? '44444444-4444-4444-8444-444444444444' : null, expiresAt: new Date(Date.now() + 900000).toISOString(),
        readback: [{ id, kind: 'restaurant', status: applied ? 'deleted' : 'pending', fingerprint: applied ? null : 'b'.repeat(64) }], mediaCleanupPending: false } });
    }
    return new Response('', { status: 503 });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminEvaluationRoutePage.Embedded embedded /></main><AppToaster /></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['record-action-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'record-action-fixture', setup(builder) {
      builder.onResolve({ filter: /^record-action-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "const empty = () => { const chain = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => resolve({ data: [], error: null, count: 0 }) : () => chain }); return chain; }; export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { if (globalThis.__fixture?.refreshOk) return empty(); throw new Error('OFFLINE_ONLY'); }, storage: { from() { throw new Error('OFFLINE_ONLY'); } }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        navigation: "const params = new URLSearchParams('module=evaluations'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });",
        dynamic: "export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

async function openPage(context: Awaited<ReturnType<Browser['newContext']>>, script: string) {
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const pageErrors: string[] = [];
  const external = { count: 0 };
  page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
  await page.route('**/*', route => {
    if (route.request().url() === 'https://record-actions.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (!route.request().url().startsWith('https://record-actions.test/')) external.count++;
    return route.abort();
  });
  await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
  await page.goto('https://record-actions.test/admin');
  await page.addScriptTag({ content: script });
  return { page, pageErrors, external };
}

(existsSync(chrome) ? test : test.skip)('a record action failure shown in its dialog is not repeated as a toast', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const { page, pageErrors, external } = await openPage(context, script);

        await page.getByRole('button', { name: '검수 항목 삭제' }).filter({ visible: true }).first().click();
        const dialog = page.getByRole('dialog');
        await playwrightExpect(dialog.getByRole('alert')).toHaveText('관리자 권한을 확인한 뒤 다시 시도하세요.');
        await page.waitForTimeout(300);
        await playwrightExpect(page.getByText('변경 확인 필요')).toHaveCount(0);
        await playwrightExpect(page.getByText('관리자 권한을 확인한 뒤 다시 시도하세요.')).toHaveCount(1);
        expect(await page.evaluate(() => (globalThis as unknown as { __fixture: { recordActionPosts: number } }).__fixture.recordActionPosts)).toBe(1);
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

(existsSync(chrome) ? test : test.skip)('after a confirmed apply removes the row, keyboard focus returns to the list area', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const { page, pageErrors, external } = await openPage(context, script);
        await page.evaluate(() => { (globalThis as unknown as { __fixture: { recordAction: string } }).__fixture.recordAction = 'apply'; });
        await page.getByRole('button', { name: '검수 항목 삭제' }).filter({ visible: true }).first().focus();
        await page.keyboard.press('Enter');
        await page.getByLabel('변경 적용 확인 문구').fill(RECORD_ACTION_CONFIRMATION);
        await page.getByRole('button', { name: '변경 적용' }).focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(page.getByRole('dialog')).toHaveCount(0);
        const retry = page.locator('[data-admin-record-views-invalidated]').getByRole('button');
        await playwrightExpect(retry).toHaveText('새로 조회');
        await playwrightExpect(retry).toBeFocused();

        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveText('새로 조회');
        await playwrightExpect(retry).toBeFocused();

        await page.evaluate(() => { (globalThis as unknown as { __fixture: { refreshOk: boolean } }).__fixture.refreshOk = true; });
        await page.keyboard.press('Enter');
        await playwrightExpect(page.locator('[data-admin-record-views-invalidated]')).toHaveCount(0);
        await playwrightExpect(page.getByText('표시할 데이터가 없습니다').filter({ visible: true })).toHaveCount(1);
        await playwrightExpect(page.locator('[data-admin-module-content]')).toBeFocused();
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
