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
  const fixture = { fail: false, delayMs: 0, events: [event('audit-a', 'admin_user_update'), event('audit-b', 'admin_user_create')], requests: 0 };
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
    entrypoints: ['audit-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'audit-fixture', setup(builder) {
      builder.onResolve({ filter: /^audit-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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

async function withPage(browser: Browser, width: number, script: string, setup: Partial<Fixture>, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://audit.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      if (!route.request().url().startsWith('https://audit.test/')) externalRequests++;
      return route.abort();
    });
    await page.addInitScript(patch => {
      (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } };
      (globalThis as unknown as { __fixtureSetup: unknown }).__fixtureSetup = patch;
    }, setup);
    await page.goto('https://audit.test/admin');
    await page.addScriptTag({ content: script.replace('globalThis.__fixture = fixture;', 'Object.assign(fixture, globalThis.__fixtureSetup); globalThis.__fixture = fixture;') });
    await run(page);
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

const browserTest = existsSync(chrome) ? test : test.skip;

browserTest('a failed audit refresh keeps the last table and keyboard focus, and recovers in place', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      await withPage(browser, width, script, {}, async page => {
        const table = page.locator('[data-admin-audit-event-list]');
        const rowButton = table.locator('button[aria-controls="audit-detail-audit-a"]');
        await rowButton.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(rowButton).toHaveAttribute('aria-expanded', 'true');

        await setFixture(page, { fail: true });
        await backgroundPoll(page);
        const stale = page.locator('[data-admin-audit-stale-read]');
        await playwrightExpect(stale).toContainText('감사 로그를 다시 읽지 못했습니다. 이전 목록을 표시하고 있습니다.');
        await playwrightExpect(table).toBeVisible();
        await playwrightExpect(rowButton).toBeFocused();
        await playwrightExpect(page.locator('#audit-detail-audit-a')).toBeVisible();

        await setFixture(page, { delayMs: 600 });
        const retry = stale.getByRole('button', { name: '다시 확인' });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(stale.getByRole('button', { name: '확인 중…' })).toBeFocused();
        await playwrightExpect(retry).toBeFocused();

        await setFixture(page, { fail: false, delayMs: 0, events: [] });
        await page.keyboard.press('Enter');
        await playwrightExpect(page.locator('[data-admin-audit-empty-state]')).toBeVisible();
        await playwrightExpect(stale).toHaveCount(0);
        await playwrightExpect(page.getByLabel('감사 로그 검색')).toBeFocused();
      });
    }
  } finally {
    await browser.close();
  }
}, 90_000);

browserTest('a failed first audit read offers an inline retry that keeps focus', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    await withPage(browser, 1280, script, { fail: true }, async page => {
      const failed = page.locator('[data-admin-audit-unavailable-state]');
      await playwrightExpect(failed).toContainText('감사 로그를 읽지 못했습니다.');
      await setFixture(page, { delayMs: 600 });
      const retry = failed.getByRole('button', { name: '감사 로그 다시 확인' });
      await retry.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(failed.getByRole('button', { name: '확인 중…' })).toBeFocused();
      await playwrightExpect(retry).toBeFocused();

      await setFixture(page, { fail: false, delayMs: 0 });
      await page.keyboard.press('Enter');
      await playwrightExpect(page.locator('[data-admin-audit-event-list]')).toBeVisible();
      await playwrightExpect(page.getByLabel('감사 로그 검색')).toBeFocused();
    });
  } finally {
    await browser.close();
  }
}, 60_000);
