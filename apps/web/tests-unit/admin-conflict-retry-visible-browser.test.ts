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
    import { DbConflictResolutionPanel } from './components/admin/DbConflictResolutionPanel';
    const fixture = { reads: 0, hold: false, release() {} };
    globalThis.__conflict = fixture;
    globalThis.fetch = async input => {
      if (!String(input).startsWith('/api/admin/evaluations/')) return new Response('', { status: 503 });
      fixture.reads += 1;
      if (fixture.hold) await new Promise(resolve => { fixture.release = resolve; });
      return new Response('', { status: 503 });
    };
    const record = { id: '11111111-1111-4111-8111-111111111111', db_conflict_info: { existing_restaurant: { id: '22222222-2222-4222-8222-222222222222' } } };
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <main style={{ height: '100vh' }}><DbConflictResolutionPanel record={record} open onOpenChange={() => {}} onSuccess={() => {}} /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['conflict-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'conflict-fixture', setup(builder) {
      builder.onResolve({ filter: /^conflict-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'auth'
        ? "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __conflict: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('a failed conflict target read stays failed while retrying', async () => {
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
        if (route.request().url() === 'https://conflict.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://conflict.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://conflict.test/admin');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('충돌 대상을 확인하지 못했습니다.')).toBeVisible();
        const retry = page.getByRole('button', { name: '충돌 정보 다시 불러오기' });
        await page.evaluate(() => { window.__conflict.hold = true; });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).not.toHaveAttribute('disabled');
        await playwrightExpect(page.getByText('충돌 대상을 확인하지 못했습니다.')).toBeVisible();
        await playwrightExpect(page.getByText('충돌 대상의 현재 정보를 확인하고 있습니다.')).toHaveCount(0);
        await page.evaluate(() => window.__conflict.release());
        await playwrightExpect(retry).toBeFocused();
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);
