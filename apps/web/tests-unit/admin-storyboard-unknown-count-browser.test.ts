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
    import { LocalStoryboardWorkspace } from './components/admin/storyboard/LocalStoryboardWorkspace';
    const fixture = { mode: 'fail' };
    globalThis.__storyboardCatalog = fixture;
    const empty = { ok: true, projects: [], workers: [], readiness: { schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' } };
    globalThis.fetch = async input => {
      const url = new URL(String(input), location.href);
      if (url.pathname === '/api/admin/storyboard/production' && fixture.mode === 'ok') {
        return new Response(JSON.stringify(empty), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 503 });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><LocalStoryboardWorkspace /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['storyboard-count-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'storyboard-count-fixture', setup(builder) {
      builder.onResolve({ filter: /^storyboard-count-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

const setMode = (page: Page, mode: 'fail' | 'ok') => page.evaluate(next => {
  (globalThis as unknown as { __storyboardCatalog: { mode: string } }).__storyboardCatalog.mode = next;
}, mode);

(existsSync(chrome) ? test : test.skip)('a failed storyboard catalog does not show zero saved projects', async () => {
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
          if (route.request().url() === 'https://storyboard-count.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (new URL(route.request().url()).origin !== 'https://storyboard-count.test') externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://storyboard-count.test/admin');
        await page.addScriptTag({ content: script });

        const library = page.locator('#local-storyboard-project-library');
        await playwrightExpect(library.getByRole('alert')).toContainText('프로젝트 목록을 불러오지 못했습니다.');
        await playwrightExpect(library.getByRole('heading', { name: '저장된 프로젝트 미확인' })).toBeVisible();
        await playwrightExpect(page.getByText('저장된 프로젝트가 없습니다.')).toHaveCount(0);

        await setMode(page, 'ok');
        await library.getByRole('button', { name: '프로젝트 목록 다시 불러오기' }).click();
        await playwrightExpect(library.getByRole('heading', { name: '저장된 프로젝트 0' })).toBeVisible();
        await playwrightExpect(page.getByText('저장된 프로젝트가 없습니다.')).toBeVisible();
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
