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
    const nextRun = { id: 'run-2', status: 'passed', providerId: 'local-codex', model: 'gpt-image-2', modelProvenance: 'exact', imagePath: '/thumbnails/run-2.png', headline: '다음 썸네일', topic: '다음 주제' };
    const fixture = { historyReads: 0, succeedReads: 20, hold: false, useNext: false, release() { const pending = waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__thumbnailHistoryCount = fixture;
    globalThis.fetch = async input => {
      const url = String(input).split('?')[0];
      if (url === '/api/admin/youtube-thumbnail-generator/history') {
        fixture.historyReads += 1;
        if (fixture.hold) await new Promise(resolve => { waiters.push(resolve); });
        if (fixture.historyReads <= fixture.succeedReads) {
          const runs = fixture.useNext ? [savedRun, nextRun] : [savedRun];
          return new Response(JSON.stringify({ runs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    entrypoints: ['thumbnail-history-count-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'thumbnail-history-count-fixture', setup(builder) {
      builder.onResolve({ filter: /^thumbnail-history-count-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global {
  interface Window {
    __thumbnailHistoryCount: { hold: boolean; useNext: boolean; succeedReads: number; historyReads: number; release: () => void };
  }
}

(existsSync(chrome) ? test : test.skip)('a visible thumbnail history keeps its count while the list is read again', async () => {
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
          if (route.request().url() === 'https://thumbnail-history-count.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (new URL(route.request().url()).origin !== 'https://thumbnail-history-count.test') externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://thumbnail-history-count.test/admin');
        await page.addScriptTag({ content: script });

        const summary = page.locator('[data-admin-module-summary]');
        await playwrightExpect(summary).toContainText('기록 1개');
        await page.getByRole('button', { name: '생성 히스토리 열기' }).click();
        const panel = page.locator('[data-thumbnail-history-panel]');
        await page.waitForFunction(() => {
          const node = document.querySelector('[data-thumbnail-history-panel]');
          const text = node?.textContent ?? '';
          return node?.getAttribute('data-thumbnail-history-status') === 'ready' && text.includes('기존 썸네일') && text.includes('1건');
        });

        await page.evaluate(() => { window.__thumbnailHistoryCount.hold = true; });
        const refresh = panel.locator('[data-thumbnail-history-refresh]');
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(panel).toContainText('기존 썸네일');
        await playwrightExpect(panel).toContainText('1건');
        await playwrightExpect(panel).not.toContainText('불러오는 중');
        await playwrightExpect(summary).toContainText('기록 1개');
        await playwrightExpect(summary).not.toContainText('기록 확인 중');

        await page.evaluate(() => { window.__thumbnailHistoryCount.useNext = true; window.__thumbnailHistoryCount.release(); });
        await playwrightExpect(panel).toContainText('다음 썸네일');
        await playwrightExpect(panel).toContainText('2건');
        await playwrightExpect(panel).not.toContainText('1건');
        await playwrightExpect(summary).toContainText('기록 2개');
        await playwrightExpect(summary).not.toContainText('기록 확인 중');
        await playwrightExpect(refresh).toBeFocused();
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 180_000);
