import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { LocalStoryboardWorkspace } from './components/admin/storyboard/LocalStoryboardWorkspace';
  import { storyboardGeminiDeclaredModels } from './lib/admin/storyboard/gemini-models';
  const now = '2026-10-22T00:00:00.000Z';
  const READY = Object.freeze({ schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' });
  const models = storyboardGeminiDeclaredModels();
  const fixture = { catalogReads: 0, hold: false, release() {} };
  globalThis.__workerStatusFixture = fixture;
  const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.href);
    if (url.pathname !== '/api/admin/storyboard/production' || (init.method || 'GET') !== 'GET') throw new Error('OFFLINE_ONLY');
    fixture.catalogReads += 1;
    if (fixture.catalogReads > 1 && fixture.hold) await new Promise(resolve => { fixture.release = resolve; });
    return reply({ ok: true, readiness: READY, workers: [{ id: 'fixture-gemini-worker', online: true, lastHeartbeat: now, models }], projects: [] });
  };
  createRoot(document.body.appendChild(document.createElement('div'))).render(<LocalStoryboardWorkspace />);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['worker-visible-status-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'worker-visible-status-fixture', setup(builder) {
      builder.onResolve({ filter: /^worker-visible-status-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { catalogReads: number; hold: boolean; release: () => void };
const holdNext = (page: Page) => page.evaluate(() => { (globalThis as unknown as { __workerStatusFixture: Fixture }).__workerStatusFixture.hold = true; });
const releaseNext = (page: Page) => page.evaluate(() => {
  const fixture = (globalThis as unknown as { __workerStatusFixture: Fixture }).__workerStatusFixture;
  fixture.hold = false;
  fixture.release();
});

(existsSync(chrome) ? test : test.skip)('a visible storyboard worker keeps its connection status while the list is read again', async () => {
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
          if (route.request().isNavigationRequest() && route.request().url() === 'http://storyboard.fixture.test/admin') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          }
          externalRequests += 1;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('http://storyboard.fixture.test/admin');
        await page.addScriptTag({ content: script });
        await page.getByRole('button', { name: '연결 설정' }).click();
        const panel = page.getByRole('region', { name: '제작 연결' });
        await playwrightExpect(panel.getByText('제작 워커 연결됨')).toBeVisible();
        await holdNext(page);
        await panel.getByRole('button', { name: '목록 새로고침', exact: true }).click();
        await playwrightExpect(panel.getByRole('button', { name: '목록 새로고침', exact: true })).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(panel.getByText('제작 워커 연결됨')).toBeVisible();
        await playwrightExpect(panel.getByText('목록 확인 중…', { exact: true })).toHaveCount(0);
        await releaseNext(page);
        await playwrightExpect(panel.getByRole('button', { name: '목록 새로고침', exact: true })).not.toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(panel.getByText('제작 워커 연결됨')).toBeVisible();
        await playwrightExpect(panel.getByText('목록 확인 중…', { exact: true })).toHaveCount(0);
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
