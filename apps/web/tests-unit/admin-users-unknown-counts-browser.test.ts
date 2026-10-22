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
    import AdminUsersPanel from './components/admin/AdminUsersPanel';
    const fixture = { hold: false, release: () => {}, reads: 0, pages: false, failFromPage: 0, requestedPages: [] };
    globalThis.__usersRead = fixture;
    const user = page => ({ id: 'user-' + page, email: 'user@example.test', username: 'user' + page, nickname: '사용자 ' + page, avatarUrl: null, profileRole: 'user', isAdmin: false, isDisabled: false, bannedUntil: null, createdAt: '2026-10-21T00:00:00Z', lastSignInAt: null, emailConfirmedAt: '2026-10-21T00:00:00Z', statusLabel: '활성', roleLabel: '사용자' });
    globalThis.fetch = async input => {
      if (!String(input).startsWith('/api/admin/users')) throw new Error('OFFLINE_ONLY');
      fixture.reads += 1;
      if (fixture.hold) await new Promise(resolve => { fixture.release = resolve; });
      const pageParam = new URL(String(input), 'https://users-read.test').searchParams.get('page');
      if (pageParam) fixture.requestedPages.push(Number(pageParam));
      if (fixture.pages) {
        const page = Number(pageParam ?? '1');
        if (fixture.failFromPage > 0 && page >= fixture.failFromPage) return new Response(JSON.stringify({ error: '사용자 목록을 불러오지 못했습니다.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ users: [user(page)], summary: { loadedUsers: 1, adminUsers: 0, disabledUsers: 0, unconfirmedUsers: 0 }, page, perPage: 120, total: 240, sourceTotal: 240, isPartial: false, hasPreviousPage: page > 1, hasNextPage: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: '사용자 목록을 불러오지 못했습니다.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminUsersPanel /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['users-read-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'users-read-fixture', setup(builder) {
      builder.onResolve({ filter: /^users-read-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/components\/ui\/use-toast$/ }, () => ({ path: 'toast', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'auth'
        ? "const value = { user: { id: 'admin-self' } }; export const useAuth = () => value;"
        : "const value = { toast() {} }; export const useToast = () => value;" }));
    }}],
  });
  expect(built.success).toBe(true);
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __usersRead: { hold: boolean; release: () => void; failFromPage: number; requestedPages: number[] } } }

(existsSync(chrome) ? test : test.skip)('a failed user-list read does not show zero users and keeps the retry focused', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://users-read.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://users-read.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://users-read.test/');
        await page.addScriptTag({ content: script });
        const metric = (label: string) => page.locator(`[data-admin-users-summary-metric="${label}"] p`).nth(1);
        await playwrightExpect(page.getByRole('alert')).toContainText('사용자 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
        await playwrightExpect(page.getByText('등록된 사용자가 없습니다.')).toHaveCount(0);
        for (const label of ['전체 사용자', '조건 일치', '현재 페이지']) await playwrightExpect(metric(label)).toHaveText('미확인');
        await playwrightExpect(page.locator('.admin-cms-footer')).toContainText('조회 실패');
        await playwrightExpect(page.locator('.admin-cms-footer')).not.toContainText('전체 0명');

        const retry = page.getByRole('button', { name: '다시 시도' });
        await page.evaluate(() => { window.__usersRead.hold = true; });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(metric('전체 사용자')).toHaveText('미확인');
        await playwrightExpect(page.getByText('목록을 확인한 후 사용자 작업을 진행할 수 있습니다.')).toBeVisible();
        await playwrightExpect(page.getByRole('status', { name: '사용자 목록 로딩 중' })).toHaveCount(0);
        await playwrightExpect(page.locator('.admin-cms-footer')).toContainText('조회 실패');
        await page.evaluate(() => window.__usersRead.release());
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(metric('전체 사용자')).toHaveText('미확인');
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);

(existsSync(chrome) ? test : test.skip)('the next user page keeps keyboard focus while that page is loading', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle().then(source => source.replace('pages: false', 'pages: true'));
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://users-read.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://users-read.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://users-read.test/');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('사용자 1', { exact: true }).first()).toBeVisible();
        const next = page.getByRole('button', { name: '다음 사용자 페이지' });
        await page.evaluate(() => { window.__usersRead.hold = true; });
        await next.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(next).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(next).toBeFocused();
        await playwrightExpect(next).not.toHaveAttribute('disabled');
        await playwrightExpect(page.getByText('사용자 1', { exact: true }).first()).toBeVisible();
        await page.evaluate(() => window.__usersRead.release());
        await playwrightExpect(page.getByText('사용자 2', { exact: true }).first()).toBeVisible();
        await playwrightExpect(next).toBeFocused();
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);

(existsSync(chrome) ? test : test.skip)('a failed next user page stays on the loaded page and the next attempt reads that page', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle().then(source => source.replace('pages: false', 'pages: true').replace('failFromPage: 0', 'failFromPage: 2'));
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://users-read.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://users-read.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://users-read.test/');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('사용자 1', { exact: true }).first()).toBeVisible();
        const next = page.getByRole('button', { name: '다음 사용자 페이지' });
        await next.click();
        await playwrightExpect(page.getByRole('alert')).toContainText('이전 목록을 표시합니다.');
        await playwrightExpect(page.locator('.admin-cms-footer')).toContainText('1 /');
        await playwrightExpect(page.getByText('사용자 1', { exact: true }).first()).toBeVisible();
        await page.evaluate(() => { window.__usersRead.failFromPage = 0; });
        await next.click();
        await playwrightExpect(page.getByText('사용자 2', { exact: true }).first()).toBeVisible();
        await playwrightExpect(page.getByText('사용자 3', { exact: true })).toHaveCount(0);
        const requested = await page.evaluate(() => window.__usersRead.requestedPages);
        expect(requested.filter(value => value === 3)).toEqual([]);
        expect(requested.filter(value => value === 2).length).toBeGreaterThan(0);
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
