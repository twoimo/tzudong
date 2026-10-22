import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminKnowledgeGraphPanel } from './components/admin/AdminKnowledgeGraphPanel';
  const coverage = { inventoryCount: null, eligibleCount: null, analyzedCount: 0, pendingCount: null, failedCount: 0, excludedShortsCount: null, asOf: null };
  const page = { revision: 'a'.repeat(64), generatedAt: '2026-10-21T00:00:00Z', coverage,
    nodes: [{ id: 'node-1', label: '페이지 1 노드', kind: 'hub', summary: '', evidence: [] }], edges: [], selected: null,
    totalNodes: 1, totalEdges: 0, filteredTotal: 1, omittedEdges: 0, nextCursor: null };
  const waiters = [];
  const fixture = { reads: 0, hold: false, release() { const pending = waiters.splice(0); for (const resolve of pending) resolve(); } };
  globalThis.__knowledgeRefresh = fixture;
  globalThis.fetch = async input => {
    const url = new URL(String(input), location.href);
    if (url.pathname !== '/api/admin/knowledge-graph') throw new Error('OFFLINE_ONLY');
    fixture.reads += 1;
    if (fixture.hold && fixture.reads > 1) await new Promise(resolve => { waiters.push(resolve); });
    return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminKnowledgeGraphPanel /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['knowledge-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'knowledge-refresh-fixture', setup(builder) {
      builder.onResolve({ filter: /^knowledge-refresh-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global { interface Window { __knowledgeRefresh: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('knowledge graph refresh keeps keyboard focus while the graph reloads', async () => {
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
        if (route.request().url() === 'https://knowledge-refresh.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://knowledge-refresh.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://knowledge-refresh.test/admin');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.locator('[data-knowledge-node="node-1"]')).toBeVisible();
        const refresh = page.getByRole('button', { name: '지식 그래프 새로고침' });
        await page.evaluate(() => { window.__knowledgeRefresh.hold = true; });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await page.evaluate(() => window.__knowledgeRefresh.release());
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(page.locator('[data-knowledge-node="node-1"]')).toBeVisible();
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
