import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromium.executablePath();

async function bundle() {
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { EvaluationTable } from './components/admin/EvaluationTableNew';
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: 'fixture-' + index, status: 'approved', approved_name: '합성 식당 ' + index,
      created_at: '2026-10-01T00:00:00Z',
      restaurant_info: { name: '합성 식당 ' + index, category: '한식' },
      youtube_link: '', youtube_meta: {}, evaluation_results: {}, categories: ['한식'],
    }));
    function Fixture() {
      const [state, setState] = useState('partial');
      globalThis.__evaluationProgress = { set: setState };
      return <EvaluationTable records={state === 'failed' || state === 'initial' ? [] : state === 'complete' ? rows : rows.slice(0, 1)}
        totalCount={3} hasMore={state !== 'complete'} isLoadingMore={state === 'loading'}
        loading={state === 'initial'} readFailed={state === 'failed'} evalFilters={{}} onFilterChange={() => {}}
        onResetFilters={() => {}} onApprove={() => {}} onDelete={() => {}} />;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['evaluation-list-progress-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""' },
    plugins: [{ name: 'evaluation-list-progress-fixture', setup(builder) {
      builder.onResolve({ filter: /^evaluation-list-progress-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : args.path === 'navigation'
          ? "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();"
          : "export const supabase = { from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global {
  interface Window { __evaluationProgress: { set: (state: string) => void }; }
}

(existsSync(chrome) ? test : test.skip)('restaurant list preserves visible rows and total count during pagination, then reports failed reads as unknown', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 720 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        const errors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => errors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://evaluation-progress.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://evaluation-progress.test/admin');
        await page.addScriptTag({ content: script });
        const summary = width === 1280 ? page.locator('.admin-cms-footer') : page.locator('[data-admin-evaluation-mobile-filter-actions]');
        await browserExpect(summary).toContainText('1 / 3개');
        await page.evaluate(() => window.__evaluationProgress.set('loading'));
        await browserExpect(summary).toContainText('1 / 3개');
        await browserExpect(page.getByRole('status')).toContainText('불러오는 중');
        await browserExpect(page.getByText('합성 식당 0', { exact: true }).first()).toBeVisible();
        await page.evaluate(() => window.__evaluationProgress.set('complete'));
        await browserExpect(summary).toContainText('3 / 3개');
        await browserExpect(page.getByText('불러오는 중', { exact: true })).toHaveCount(0);
        await page.evaluate(() => window.__evaluationProgress.set('failed'));
        await browserExpect(summary).toContainText('미확인');
        await browserExpect(summary).not.toContainText('0 / 3개');
        await page.evaluate(() => window.__evaluationProgress.set('initial'));
        await browserExpect(summary).toContainText(/조회 중|집계 중/);
        await browserExpect(summary).not.toContainText('0 / 3개');
        expect(externalRequests).toBe(0);
        expect(errors).toEqual([]);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}, 90_000);
