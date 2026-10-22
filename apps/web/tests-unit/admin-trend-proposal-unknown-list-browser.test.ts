import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const emptyList = {
  ok: true,
  items: [],
  pageInfo: { nextCursor: null, hasMore: false },
  asOf: '2026-10-21T00:00:00.000Z',
};

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { TrendProposalQueue } from './components/admin/TrendProposalQueue';
    const fixture = { requests: 0, hold: false, mode: 'fail', waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__trendProposals = fixture;
    const emptyList = ${JSON.stringify(emptyList)};
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (!url.startsWith('/api/admin/trend-proposals')) return new Response('', { status: 503 });
      fixture.requests += 1;
      if (fixture.hold && fixture.requests > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
      if (fixture.mode !== 'ok') return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(emptyList), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main><TrendProposalQueue /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['trend-proposal-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'trend-proposal-fixture', setup(builder) {
      builder.onResolve({ filter: /^trend-proposal-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global {
  interface Window {
    __trendProposals: { hold: boolean; mode: string; requests: number; release: () => void };
  }
}

async function open(page: Page, script: string) {
  const errors: string[] = [];
  const blocked: string[] = [];
  page.on('pageerror', error => errors.push(error.message.slice(0, 240)));
  await page.route('**/*', route => {
    if (route.request().url() === 'https://trend-proposals.test/admin') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    }
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
  await page.goto('https://trend-proposals.test/admin');
  await page.addScriptTag({ content: script });
  return { errors, blocked };
}

(existsSync(chrome) ? test : test.skip)('a failed trend proposal list is not shown as an empty queue', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        const { errors, blocked } = await open(page, script);
        const queue = page.getByRole('region', { name: '트렌드 제안 검토' });
        await playwrightExpect(queue.getByRole('alert')).toHaveText('트렌드 제안을 불러오지 못했습니다.');
        await playwrightExpect(queue.getByText('미확인', { exact: true })).toBeVisible();
        await playwrightExpect(queue.getByText('0건 대기')).toHaveCount(0);
        await playwrightExpect(queue.getByText('검토 대기 중인 트렌드 제안이 없습니다.')).toHaveCount(0);
        await playwrightExpect(queue.getByText('제안을 선택하면 미리보기, 해시, 검토 사유를 확인합니다.')).toHaveCount(0);

        await page.evaluate(() => { window.__trendProposals.hold = true; });
        const retry = queue.getByRole('button', { name: '다시 시도' });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).not.toHaveAttribute('disabled');
        await playwrightExpect(queue.getByRole('alert')).toHaveText('트렌드 제안을 불러오지 못했습니다.');
        await playwrightExpect(queue.getByText('미확인', { exact: true })).toBeVisible();
        await playwrightExpect(queue.getByText('제안 목록을 불러오는 중입니다.')).toHaveCount(0);
        await playwrightExpect(queue.getByText('0건 대기')).toHaveCount(0);

        await page.evaluate(() => { window.__trendProposals.mode = 'ok'; window.__trendProposals.release(); });
        await playwrightExpect(queue.getByText('검토 대기 중인 트렌드 제안이 없습니다.')).toBeVisible();
        await playwrightExpect(queue.getByText('0건 대기')).toBeVisible();
        await playwrightExpect(queue.getByRole('alert')).toHaveCount(0);
        await playwrightExpect(retry).toHaveCount(0);
        expect(errors).toEqual([]);
        expect(blocked).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 40_000);
