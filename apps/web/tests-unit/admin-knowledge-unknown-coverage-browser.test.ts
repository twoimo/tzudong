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
    import { AdminKnowledgeGraphPanel } from './components/admin/AdminKnowledgeGraphPanel';
    const fixture = { requests: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__knowledgeCoverage = fixture;
    globalThis.fetch = async input => {
      const url = new URL(String(input), location.href);
      if (url.pathname !== '/api/admin/knowledge-graph') throw new Error('OFFLINE_ONLY');
      fixture.requests += 1;
      if (fixture.hold && fixture.requests > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminKnowledgeGraphPanel /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['knowledge-coverage-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'knowledge-coverage-fixture', setup(builder) {
      builder.onResolve({ filter: /^knowledge-coverage-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

(existsSync(chrome) ? test : test.skip)('a failed knowledge graph read does not look like it is still loading', async () => {
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
          if (route.request().url() === 'https://knowledge-coverage.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (new URL(route.request().url()).origin !== 'https://knowledge-coverage.test') externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://knowledge-coverage.test/admin');
        await page.addScriptTag({ content: script });

        await playwrightExpect(page.getByRole('alert')).toContainText('지식 그래프를 불러오지 못했습니다.');
        await playwrightExpect(page.getByText('분석 미확인 / 대상 미확인')).toBeVisible();
        await playwrightExpect(page.getByText('대상 확인 중')).toHaveCount(0);
        await page.getByRole('button', { name: '지식 목록과 분석 현황 열기' }).click();
        const dialog = page.getByRole('dialog');
        await playwrightExpect(dialog).toContainText('목록을 확인하지 못했습니다.');
        await playwrightExpect(dialog).toContainText('대기 수 미확인');
        await playwrightExpect(dialog.getByText('조회 중', { exact: true })).toHaveCount(0);
        await playwrightExpect(dialog.getByText('대기 수 확인 중')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await playwrightExpect(dialog).toHaveCount(0);

        await page.evaluate(() => { (globalThis as unknown as { __knowledgeCoverage: { hold: boolean } }).__knowledgeCoverage.hold = true; });
        const retry = page.getByRole('alert').getByRole('button', { name: '다시 시도' });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(page.getByRole('alert')).toContainText('지식 그래프를 불러오지 못했습니다.');
        await playwrightExpect(page.getByText('그래프 조회 중')).toHaveCount(0);
        await playwrightExpect(page.locator('[data-knowledge-canvas]')).toContainText('지식 그래프를 불러오지 못했습니다.');
        await page.evaluate(() => (globalThis as unknown as { __knowledgeCoverage: { release: () => void } }).__knowledgeCoverage.release());
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(page.getByRole('alert')).toContainText('지식 그래프를 불러오지 못했습니다.');
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
