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
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { AdminPipelineDashboard } from './components/admin/pipeline/AdminPipelineDashboard';
    const fixture = { manifestCalls: 0, manifestFails: true, runId: 101, runStatus: 'in_progress', runConclusion: null };
    globalThis.__pipelineFixture = fixture;
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async input => {
      const url = String(input);
      if (url === '/api/admin/pipeline') return json({ source: 'github_actions', jobs: [{ id: String(fixture.runId), target: 'tzuyang', status: 'Fetching' }], failures: [], targets: [] });
      if (url === '/api/admin/system-status') {
        fixture.manifestCalls++;
        if (fixture.manifestFails) return new Response('', { status: 500 });
        return json({ runDaily: { manifestStatus: 'available', checkedAt: new Date().toISOString(), stale: false, stepEvents: [{ name: 'Step 1 (URL Collection)', status: 'completed', durationSeconds: 3 }] },
          githubActions: { enabled: true, configured: true, reachable: true, latestRunId: fixture.runId, latestRunStatus: fixture.runStatus, latestRunConclusion: fixture.runConclusion } });
      }
      throw new Error('OFFLINE_ONLY');
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={new QueryClient()}><main style={{ height: '100vh' }}><AdminPipelineDashboard /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['pipeline-manifest-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'pipeline-manifest-fixture', setup(builder) {
      builder.onResolve({ filter: /^pipeline-manifest-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, () => ({ loader: 'tsx',
        contents: "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });" }));
    }}],
  });
  expect(built.success).toBe(true);
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { manifestCalls: number; manifestFails: boolean; runId: number; runStatus: string; runConclusion: string | null };
const fixture = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __pipelineFixture: Fixture }).__pipelineFixture }));
const setFixture = (page: Page, changes: Partial<Fixture>) => page.evaluate(next => Object.assign((globalThis as unknown as { __pipelineFixture: Fixture }).__pipelineFixture, next), changes);
const setVisibility = (page: Page, state: 'hidden' | 'visible') => page.evaluate(value => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}, state);

(existsSync(chrome) ? test : test.skip)('pipeline stage record refreshes with run status and pauses while the tab is hidden', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 160)));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://pipeline-manifest.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
    await page.clock.install();
    await page.goto('https://pipeline-manifest.test/');
    await page.addScriptTag({ content: script });
    const record = page.locator('[data-pipeline-canvas] [role="status"]').first();
    await playwrightExpect(record).toHaveText('마지막 배치 · 기록 조회 실패');
    expect((await fixture(page)).manifestCalls).toBe(1);

    await setFixture(page, { manifestFails: false });
    await page.clock.runFor(31_000);
    await playwrightExpect(record).toHaveText('마지막 배치 · 최근 기록');

    await page.getByRole('button', { name: '실행 관리' }).click();
    const job = (id: number) => page.locator(`[data-admin-pipeline-job="${id}"]`);
    await playwrightExpect(job(101)).toContainText('수집 중');
    const beforeRunChange = (await fixture(page)).manifestCalls;
    await setFixture(page, { runId: 102, runStatus: 'completed', runConclusion: 'failure' });
    await page.clock.runFor(15_500);
    await playwrightExpect(job(102)).toContainText('실패');
    expect((await fixture(page)).manifestCalls).toBe(beforeRunChange + 1);

    await setVisibility(page, 'hidden');
    const hiddenCalls = (await fixture(page)).manifestCalls;
    await page.clock.runFor(120_000);
    expect((await fixture(page)).manifestCalls).toBe(hiddenCalls);
    await setVisibility(page, 'visible');
    await page.clock.runFor(1_000);
    await playwrightExpect.poll(async () => (await fixture(page)).manifestCalls).toBeGreaterThan(hiddenCalls);

    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
}, 60_000);
