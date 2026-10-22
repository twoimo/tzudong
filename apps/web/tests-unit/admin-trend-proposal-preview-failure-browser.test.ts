import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const proposal = {
  id: '11111111-1111-4111-8111-111111111111',
  proposalStatus: 'pending',
  restaurant: { id: '22222222-2222-4222-8222-222222222222', name: '합성 식당', lat: 37.5, lng: 127, status: 'approved' },
  overlayType: 'trend',
  label: '합성 제안',
  description: '설명',
  activeFrom: null,
  activeUntil: null,
  score: 1.2,
  scoreBreakdown: {},
  evidenceSummary: { sourceTypes: [], observationCount: 2, freshness: '최근' },
  evidence: [],
  proposalHash: 'a'.repeat(64),
  createdAt: '2026-10-21T00:00:00.000Z',
  review: { reviewedByAdminId: null, reviewedAt: null, reviewReason: null, overlayAuditId: null },
  conflict: { hasActiveOverlay: false, overlay: null },
};
const list = {
  ok: true,
  items: [proposal],
  pageInfo: { nextCursor: null, hasMore: false },
  asOf: '2026-10-21T00:00:00.000Z',
};

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { TrendProposalQueue } from './components/admin/TrendProposalQueue';
    const fixture = { previewReads: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
    globalThis.__trendPreview = fixture;
    const list = ${JSON.stringify(list)};
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('/api/admin/trend-proposals') && !url.includes('/preview-overlay')) {
        return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/preview-overlay')) {
        fixture.previewReads += 1;
        if (fixture.hold && fixture.previewReads > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
        return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main><TrendProposalQueue /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['trend-preview-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'trend-preview-fixture', setup(builder) {
      builder.onResolve({ filter: /^trend-preview-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under \`bun test\`, Bun.build misses tsconfig \`paths\` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global {
  interface Window {
    __trendPreview: { hold: boolean; previewReads: number; release: () => void };
  }
}

async function open(page: Page, script: string) {
  const errors: string[] = [];
  const blocked: string[] = [];
  page.on('pageerror', error => errors.push(error.message.slice(0, 240)));
  await page.route('**/*', route => {
    if (route.request().url() === 'https://trend-preview.test/admin') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    }
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
  await page.goto('https://trend-preview.test/admin');
  await page.addScriptTag({ content: script });
  return { errors, blocked };
}

(existsSync(chrome) ? test : test.skip)('a failed trend proposal preview stays failed while it is recalculated', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        const { errors, blocked } = await open(page, script);
        const preview = page.locator('[data-trend-proposal-preview]');
        await playwrightExpect(preview.getByRole('alert')).toHaveText('오버레이 미리보기를 만들지 못했습니다.');
        await playwrightExpect(preview.getByText('오버레이 미리보기를 계산하는 중입니다.')).toHaveCount(0);
        await playwrightExpect(page.getByRole('button', { name: '제안 승인' })).toBeDisabled();

        await page.evaluate(() => { window.__trendPreview.hold = true; });
        const retry = preview.getByRole('button', { name: '다시 계산' });
        const reads = await page.evaluate(() => window.__trendPreview.previewReads);
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(retry).not.toHaveAttribute('disabled');
        await playwrightExpect(preview.getByRole('alert')).toHaveText('오버레이 미리보기를 만들지 못했습니다.');
        await playwrightExpect(preview.getByText('오버레이 미리보기를 계산하는 중입니다.')).toHaveCount(0);
        expect(await page.evaluate(() => window.__trendPreview.previewReads)).toBe(reads + 1);
        await page.evaluate(() => window.__trendPreview.release());
        await playwrightExpect(preview.getByRole('alert')).toHaveText('오버레이 미리보기를 만들지 못했습니다.');
        await playwrightExpect(retry).toBeFocused();
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
