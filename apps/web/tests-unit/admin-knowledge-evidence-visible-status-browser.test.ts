import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminKnowledgeGraphPanel } from './components/admin/AdminKnowledgeGraphPanel';
  const coverage = { inventoryCount: null, eligibleCount: 4, analyzedCount: 3, pendingCount: 1, failedCount: 0, excludedShortsCount: null, asOf: null };
  const graphPage = n => ({ revision: 'a'.repeat(64), generatedAt: '2026-10-21T00:00:00Z', coverage,
    nodes: [{ id: 'node-' + n, label: (n === 1 ? '이전 노드' : '다음 노드'), kind: 'hub', summary: (n === 1 ? '이전 근거 문장' : '다음 근거 문장'), evidence: [] }],
    edges: [{ id: 'edge-' + n, source: 'node-' + n, target: 'node-' + n, relation: 'references' }], selected: null,
    totalNodes: 2, totalEdges: 1, filteredTotal: 2, omittedEdges: 0, edgePageTotal: 1, nextEdgeCursor: null,
    nextCursor: n < 2 ? 'cursor-2' : null });
  const fixture = { requests: 0, hold: false, waiters: [], release() { const pending = this.waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__knowledgeEvidence = fixture;
  globalThis.fetch = async input => {
    const url = new URL(String(input), location.href);
    if (url.pathname !== '/api/admin/knowledge-graph') throw new Error('OFFLINE_ONLY');
    fixture.requests += 1;
    if (fixture.hold && fixture.requests > 1) await new Promise(resolve => { fixture.waiters.push(resolve); });
    const cursor = url.searchParams.get('cursor');
    return new Response(JSON.stringify(graphPage(cursor ? 2 : 1)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminKnowledgeGraphPanel /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['knowledge-evidence-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'knowledge-evidence-fixture', setup(builder) {
      builder.onResolve({ filter: /^knowledge-evidence-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { requests: number; hold: boolean; release: () => void };
const reads = (page: Page) => page.evaluate(() => (globalThis as unknown as { __knowledgeEvidence: Fixture }).__knowledgeEvidence.requests);
const holdNext = (page: Page) => page.evaluate(() => { (globalThis as unknown as { __knowledgeEvidence: Fixture }).__knowledgeEvidence.hold = true; });
const releaseNext = (page: Page) => page.evaluate(() => {
  const fixture = (globalThis as unknown as { __knowledgeEvidence: Fixture }).__knowledgeEvidence;
  fixture.hold = false;
  fixture.release();
});

(existsSync(chrome) ? test : test.skip)('a visible knowledge node keeps its evidence while the next page is read', async () => {
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
          if (route.request().isNavigationRequest() && route.request().url() === 'http://knowledge-evidence.fixture.test/admin') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          }
          externalRequests += 1;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('http://knowledge-evidence.fixture.test/admin');
        await page.addScriptTag({ content: script });
        const node = page.locator('[data-knowledge-node="node-1"]');
        const detail = page.getByRole('dialog', { name: '지식 근거' });
        await playwrightExpect(node).toBeVisible();
        await page.getByRole('button', { name: '지식 목록과 분석 현황 열기' }).click();
        await page.getByRole('dialog', { name: '지식 목록' }).getByRole('button', { name: '이전 노드' }).click();
        await playwrightExpect(detail.getByRole('heading', { name: '이전 노드' })).toBeVisible();
        await playwrightExpect(detail).toContainText('이전 근거 문장');
        await page.waitForTimeout(400);
        const readsBefore = await reads(page);
        await holdNext(page);
        await page.locator('button[aria-label="다음 지식 페이지"]').evaluate(button => {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        await playwrightExpect.poll(() => reads(page)).toBeGreaterThan(readsBefore);
        await playwrightExpect(node).toHaveCount(1);
        await playwrightExpect(detail.getByRole('heading', { name: '이전 노드' })).toBeVisible();
        await playwrightExpect(detail).toContainText('이전 근거 문장');
        await playwrightExpect(detail.getByText('근거 조회 중', { exact: true })).toHaveCount(0);
        await releaseNext(page);
        await playwrightExpect(page.locator('[data-knowledge-node="node-2"]')).toHaveCount(1);
        await playwrightExpect(detail.getByText('근거 조회 중', { exact: true })).toHaveCount(0);
        await playwrightExpect(detail).not.toContainText('이전 근거 문장');
        await playwrightExpect(detail).toContainText('선택한 근거를 불러오지 못했습니다.');
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 120_000);
