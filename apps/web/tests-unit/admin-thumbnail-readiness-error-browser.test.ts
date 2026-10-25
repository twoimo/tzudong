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
    import { AdminYoutubeThumbnailGenerator } from './components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator';
    const fixture = { readinessOk: false, readinessDelayMs: 0, requests: [] };
    globalThis.__thumbnailFixture = fixture;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    const readiness = { jobs: [] };
    globalThis.fetch = async input => {
      const url = String(input);
      fixture.requests.push(url.split('?')[0]);
      if (url === '/api/admin/youtube-thumbnail-generator/jobs') {
        await new Promise(resolve => setTimeout(resolve, fixture.readinessDelayMs));
        return fixture.readinessOk ? json(readiness) : json({ error: { code: 'unavailable' } }, 503);
      }
      return new Response('', { status: 503 });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminYoutubeThumbnailGenerator /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['thumbnail-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'thumbnail-fixture', setup(builder) {
      builder.onResolve({ filter: /^thumbnail-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'auth-seam' }));
      builder.onLoad({ filter: /.*/, namespace: 'auth-seam' }, () => ({ loader: 'tsx', contents: "export const useAuth=()=>({user:{id:'6f5d42d6-d122-4d32-b8bb-2779de58b423'},isAdmin:true});" }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { readinessOk: boolean; readinessDelayMs: number; requests: string[] };
const setFixture = (page: Page, changes: Partial<Fixture>) => page.evaluate(next => {
  Object.assign((globalThis as unknown as { __thumbnailFixture: Fixture }).__thumbnailFixture, next);
}, changes);
const readinessRequests = (page: Page) => page.evaluate(() => (globalThis as unknown as { __thumbnailFixture: Fixture }).__thumbnailFixture.requests
  .filter(url => url === '/api/admin/youtube-thumbnail-generator/jobs').length);

(existsSync(chrome) ? test : test.skip)('a failed thumbnail readiness read is reported as failed and can be re-checked', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://thumbnail.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      if (new URL(route.request().url()).origin !== 'https://thumbnail.test') externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.goto('https://thumbnail.test/admin');
    await page.addScriptTag({ content: script });

    const status = page.locator('[data-thumbnail-chat-status-badge]');
    await playwrightExpect(status).toHaveText('확인 실패');
    await playwrightExpect(status).toHaveAttribute('data-thumbnail-chat-status', 'check-failed');
    const retry = page.locator('[data-thumbnail-readiness-retry]');
    await playwrightExpect(retry).toHaveAccessibleName('모델 상태 다시 확인');
    expect(await readinessRequests(page)).toBe(1);
    await playwrightExpect(page.getByText('기록 확인 실패', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: '밥도둑 한상 썸네일 예시 불러오기' }).click();
    await playwrightExpect(page.getByText('이미지 만들기 상태를 확인하지 못해 다시 확인하고 있어요.', { exact: false })).toBeVisible();
    await playwrightExpect.poll(() => readinessRequests(page)).toBe(2);
    await playwrightExpect(status).toHaveText('확인 실패');

    await setFixture(page, { readinessDelayMs: 600 });
    await retry.focus();
    await page.keyboard.press('Enter');
    await playwrightExpect(retry).toHaveAccessibleName('모델 상태 확인 중');
    await playwrightExpect(retry).toBeFocused();
    await playwrightExpect(retry).toHaveAccessibleName('모델 상태 다시 확인');
    await playwrightExpect(retry).toBeFocused();
    expect(await readinessRequests(page)).toBe(3);

    await setFixture(page, { readinessOk: true });
    await page.keyboard.press('Enter');
    await playwrightExpect(status).toHaveText('접수 가능');
    await playwrightExpect(retry).toHaveCount(0);
    await playwrightExpect(page.locator('#thumbnail-chat-composer')).toBeFocused();
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
