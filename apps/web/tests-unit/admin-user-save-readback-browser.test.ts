import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import AdminUsersPanel from './components/admin/AdminUsersPanel';
    const user = (nickname, username) => ({ id: 'synthetic-user', email: 'synthetic@example.invalid', username, nickname, avatarUrl: null,
      profileRole: 'user', isAdmin: false, isDisabled: false, bannedUntil: null, createdAt: '2026-10-01T00:00:00Z', lastSignInAt: null,
      emailConfirmedAt: '2026-10-01T00:00:00Z', statusLabel: '활성', roleLabel: '일반 사용자' });
    const fixture = { current: user('before', 'before-user'), concurrentNickname: null, toasts: [] };
    globalThis.__usersFixture = fixture;
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const list = () => ({ users: [fixture.current], summary: { loadedUsers: 1, adminUsers: 0, disabledUsers: 0, unconfirmedUsers: 0 },
      page: 1, perPage: 120, total: 1, sourceTotal: 1, isPartial: false, hasPreviousPage: false, hasNextPage: false });
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url === '/api/admin/users/synthetic-user' && init.method === 'PATCH') {
        const { profile } = JSON.parse(init.body);
        fixture.current = user(fixture.concurrentNickname ?? profile.nickname, profile.username);
        return json({ message: '프로필 정보를 저장했습니다.', audit: { readbackId: 'audit-fixture' } });
      }
      if (url.startsWith('/api/admin/users?')) return json(list());
      throw new Error('OFFLINE_ONLY');
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminUsersPanel /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['user-save-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'user-save-fixture', setup(builder) {
      builder.onResolve({ filter: /^user-save-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/components\/ui\/use-toast$/ }, () => ({ path: 'toast', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'auth'
        ? "const value = { user: { id: 'admin-self' } }; export const useAuth = () => value;"
        : "const toast = item => { globalThis.__usersFixture.toasts.push(item.title); }; const value = { toast }; export const useToast = () => value;" }));
    }}],
  });
  expect(built.success).toBe(true);
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { concurrentNickname: string | null; toasts: string[] };
const fixture = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __usersFixture: Fixture }).__usersFixture }));

async function saveProfile(page: Page, nickname: string, username: string) {
  await page.getByLabel('닉네임', { exact: true }).fill(nickname);
  await page.getByLabel('사용자명', { exact: true }).fill(username);
  await page.getByRole('button', { name: '프로필 저장' }).click();
}

(existsSync(chrome) ? test : test.skip)('a saved user change reports its exact readback once, including a concurrent conflict', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 160)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://user-save.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.goto('https://user-save.test/');
    await page.addScriptTag({ content: script });

    await page.getByRole('button', { name: 'before 상세 보기' }).first().click();
    const result = page.locator('[data-admin-user-mutation-action]');

    await saveProfile(page, 'after', 'after-user');
    await playwrightExpect(result).toContainText('적용 완료');
    await playwrightExpect(result).toContainText('상태를 다시 확인했습니다.');
    expect((await fixture(page)).toasts).toEqual(['상태 재확인 완료']);

    await page.evaluate(() => { (globalThis as unknown as { __usersFixture: Fixture }).__usersFixture.concurrentNickname = 'someone-else'; });
    await saveProfile(page, 'after-2', 'after-user-2');
    await playwrightExpect(page.getByRole('button', { name: '최신 상태 수용' })).toBeVisible();
    await playwrightExpect(result).toContainText('요청한 상태와 다른 최신 사용자 상태를 확인했습니다.');
    await playwrightExpect(result).not.toContainText('새로고침으로 확인해 주세요');
    expect((await fixture(page)).toasts).toEqual(['상태 재확인 완료', '최신 상태 확인 필요']);

    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
}, 60_000);
