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
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { AdminPipelineDashboard } from './components/admin/pipeline/AdminPipelineDashboard';
    const waiters = [];
    const fixture = { hold: false, release() { const pending = waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__pipelineRefresh = fixture;
    globalThis.fetch = async input => {
      const url = String(input);
      if (url !== '/api/admin/pipeline' && url !== '/api/admin/system-status') throw new Error('OFFLINE_ONLY');
      if (fixture.hold) await new Promise(resolve => { waiters.push(resolve); });
      return new Response('', { status: 503 });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={new QueryClient()}><main style={{ height: '100vh' }}><AdminPipelineDashboard /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['pipeline-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'pipeline-refresh-fixture', setup(builder) {
      builder.onResolve({ filter: /^pipeline-refresh-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, () => ({ loader: 'tsx',
        contents: "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __pipelineRefresh: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('pipeline refresh keeps keyboard focus while both reads are in flight', async () => {
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
        if (route.request().url() === 'https://pipeline-refresh.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://pipeline-refresh.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://pipeline-refresh.test/');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('실행 조회 실패', { exact: true })).toBeVisible();
        const refresh = page.getByRole('button', { name: '새로고침' });
        await page.evaluate(() => { window.__pipelineRefresh.hold = true; });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await playwrightExpect(page.getByText('실행 조회 실패', { exact: true })).toBeVisible();
        await playwrightExpect(page.getByText('마지막 배치 · 기록 조회 실패')).toBeVisible();
        await playwrightExpect(page.getByText('실행 조회 중')).toHaveCount(0);
        await playwrightExpect(page.getByText('기록 조회 중')).toHaveCount(0);
        await page.evaluate(() => window.__pipelineRefresh.release());
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(page.getByText('실행 조회 실패', { exact: true })).toBeVisible();
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
