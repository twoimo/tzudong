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
    import { AdminYoutubeThumbnailGenerator } from './components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator';
    const waiters = [];
    const savedRun = { id: 'run-1', status: 'passed', providerId: 'local-codex', model: 'gpt-image-2', modelProvenance: 'exact', imagePath: '/thumbnails/run-1.png', headline: '기존 썸네일', topic: '기존 주제' };
    const fixture = { historyReads: 0, succeedReads: 0, hold: false, release() { const pending = waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__thumbnailHistory = fixture;
    globalThis.fetch = async input => {
      const url = String(input).split('?')[0];
      if (url === '/api/admin/youtube-thumbnail-generator/history') {
        fixture.historyReads += 1;
        if (fixture.hold) await new Promise(resolve => { waiters.push(resolve); });
        if (fixture.historyReads <= fixture.succeedReads) {
          return new Response(JSON.stringify({ runs: [savedRun] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('', { status: 503 });
      }
      if (url === '/api/admin/youtube-thumbnail-generator') {
        return new Response(JSON.stringify({
          target: { width: 1280, height: 720, aspectRatio: '16:9' },
          providers: { localCodex: { available: true, model: 'gpt-image-2' } },
          limits: { maxFiles: 4, maxFileBytes: 8388608, maxTotalBytes: 20971520, mimeTypes: ['image/png'] },
          configuration: { liveApiGate: '', openaiModelEnv: '', geminiModelEnv: '', localCodexGate: '' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 503 });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminYoutubeThumbnailGenerator /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['thumbnail-history-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'thumbnail-history-fixture', setup(builder) {
      builder.onResolve({ filter: /^thumbnail-history-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
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

declare global { interface Window { __thumbnailHistory: { hold: boolean; succeedReads: number; historyReads: number; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('thumbnail history refresh stays focused and does not show the internal failure code', async () => {
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
        if (route.request().url() === 'https://thumbnail-history.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (new URL(route.request().url()).origin !== 'https://thumbnail-history.test') externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://thumbnail-history.test/admin');
        await page.addScriptTag({ content: script });
        await page.getByRole('button', { name: '생성 히스토리 열기' }).click();
        const panel = page.locator('[data-thumbnail-history-panel]');
        await playwrightExpect(panel.locator('[data-thumbnail-history-error]')).toContainText('히스토리를 불러오지 못했습니다.');
        await playwrightExpect(panel).not.toContainText('history_api_failed');
        const refresh = panel.getByRole('button', { name: '생성 히스토리 새로고침' });
        await page.evaluate(() => { window.__thumbnailHistory.hold = true; });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await playwrightExpect(panel.locator('[data-thumbnail-history-error]')).toContainText('히스토리를 불러오지 못했습니다.');
        await playwrightExpect(panel.getByText('확인 실패', { exact: true })).toBeVisible();
        await playwrightExpect(panel.getByText('불러오는 중', { exact: true })).toHaveCount(0);
        await playwrightExpect(page.locator('[data-admin-module-summary]')).toContainText('기록 확인 실패');
        await playwrightExpect(page.locator('[data-admin-module-summary]')).not.toContainText('기록 확인 중');
        await page.evaluate(() => window.__thumbnailHistory.release());
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(panel).not.toContainText('history_api_failed');
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

(existsSync(chrome) ? test : test.skip)('a failed thumbnail history refresh keeps the previous runs and the failure while retrying', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle().then(source => source.replace('succeedReads: 0', 'succeedReads: 20'));
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://thumbnail-history.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (new URL(route.request().url()).origin !== 'https://thumbnail-history.test') externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://thumbnail-history.test/admin');
        await page.addScriptTag({ content: script });
        await page.getByRole('button', { name: '생성 히스토리 열기' }).click();
        const panel = page.locator('[data-thumbnail-history-panel]');
        await playwrightExpect(panel.getByText('기존 썸네일', { exact: true })).toBeVisible();
        await playwrightExpect(panel.getByText('1건', { exact: true })).toBeVisible();
        const refresh = panel.getByRole('button', { name: '생성 히스토리 새로고침' });
        await page.evaluate(() => { window.__thumbnailHistory.succeedReads = 0; });
        await refresh.click();
        await playwrightExpect(panel.locator('[data-thumbnail-history-error]')).toContainText('히스토리를 불러오지 못했습니다.');
        await playwrightExpect(panel.getByText('기존 썸네일', { exact: true })).toBeVisible();
        await page.evaluate(() => { window.__thumbnailHistory.hold = true; });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await playwrightExpect(panel.locator('[data-thumbnail-history-error]')).toContainText('히스토리를 불러오지 못했습니다.');
        await playwrightExpect(panel.getByText('확인 실패', { exact: true })).toBeVisible();
        await playwrightExpect(panel.getByText('불러오는 중', { exact: true })).toHaveCount(0);
        await playwrightExpect(panel.getByText('기존 썸네일', { exact: true })).toBeVisible();
        await playwrightExpect(page.locator('[data-admin-module-summary]')).toContainText('기록 확인 실패');
        await playwrightExpect(page.locator('[data-admin-module-summary]')).not.toContainText('기록 확인 중');
        await page.evaluate(() => window.__thumbnailHistory.release());
        await playwrightExpect(refresh).toBeFocused();
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
