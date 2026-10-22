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
  import { AdminConsoleOverview } from './components/admin/AdminConsoleOverview';
  const event = (id, action) => ({ id, actorUserId: null, targetUserId: 'user-' + id, action, status: 'applied', reasonCode: 'operator_request', correlationId: null,
    appliedAt: '2026-10-21T00:00:00Z', errorCode: null, createdAt: '2026-10-21T00:00:00Z', counts: {}, flags: {} });
  const fixture = { fail: false, delayMs: 0, events: [event('audit-a', 'admin_user_role_granted'), event('audit-b', 'admin_user_disabled')], requests: 0 };
  globalThis.__fixture = fixture;
  globalThis.fetch = async input => {
    const url = String(input);
    if (!url.startsWith('/api/admin/audit-events')) return new Response('', { status: 503 });
    fixture.requests++;
    await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
    if (fixture.fail) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ asOf: '2026-10-21T00:00:00Z', source: 'admin_audit_events', events: fixture.events, unavailable: null,
      coverage: { mode: 'truthful-partial-domain-specific', universal: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, placeholderData: previous => previous } } });
  globalThis.__client = client;
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminConsoleOverview /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['audit-visible-count-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'audit-visible-count-fixture', setup(builder) {
      builder.onResolve({ filter: /^audit-visible-count-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        navigation: "const params = new URLSearchParams('module=audit'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default function Link({ href, children, prefetch, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; }",
        dynamic: "import React from 'react'; export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { fail: boolean; delayMs: number; events: unknown[]; requests: number };
const setFixture = (page: Page, patch: Partial<Fixture>) =>
  page.evaluate(next => Object.assign((globalThis as unknown as { __fixture: Fixture }).__fixture, next), patch);
const backgroundPoll = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __client: { refetchQueries(filter: object): Promise<void> } }).__client
    .refetchQueries({ queryKey: ['admin-audit-events'] }));

async function withPage(browser: Browser, width: number, script: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://audit-visible-count.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      if (new URL(route.request().url()).origin !== 'https://audit-visible-count.test') externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.goto('https://audit-visible-count.test/admin');
    await page.addScriptTag({ content: script });
    await run(page);
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

(existsSync(chrome) ? test : test.skip)('a visible audit list keeps its header count when the next list read fails', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      await withPage(browser, width, script, async page => {
        const header = page.locator('[data-admin-module-header-module="audit"] [data-admin-module-summary]');
        const table = page.locator('[data-admin-audit-event-list]');
        const footer = page.locator('[data-admin-embedded-module-id="audit"] .admin-cms-footer');
        await playwrightExpect(table).toContainText('관리자 부여');
        await playwrightExpect(header).toHaveText('부분 감사 · 2개');
        await playwrightExpect(footer).toContainText('2 / 2개');

        await setFixture(page, { fail: true });
        await backgroundPoll(page);
        await playwrightExpect(page.locator('[data-admin-audit-stale-read]')).toContainText('이전 목록을 표시하고 있습니다.');
        await playwrightExpect(table).toContainText('관리자 부여');
        await playwrightExpect(table).toContainText('계정 비활성화');
        await playwrightExpect(header).toHaveText('부분 감사 · 2개');
        await playwrightExpect(header).not.toContainText('읽기 확인 필요');
        await playwrightExpect(footer).toContainText('2 / 2개');
      });
    }
  } finally {
    await browser.close();
  }
}, 180_000);
