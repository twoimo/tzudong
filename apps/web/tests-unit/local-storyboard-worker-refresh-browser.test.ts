import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
const A = '11111111-1111-4111-8111-111111111111';
let browser: Browser | undefined;
let script: string;

beforeAll(async () => {
  if (!existsSync(chrome)) return;
  const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalStoryboardWorkspace } from './components/admin/storyboard/LocalStoryboardWorkspace';
import { STORYBOARD_WORKFLOW } from './lib/admin/storyboard/production-contract';
import { STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL, STORYBOARD_GEMINI_TEXT_MODEL, storyboardGeminiDeclaredModels } from './lib/admin/storyboard/gemini-models';
const A = '${A}', now = '2026-10-05T00:00:00.000Z';
const READY = Object.freeze({ schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' });
const request = { workflow: STORYBOARD_WORKFLOW, requestId: A, prompt: 'Fixture', sceneCount: 5, retrieval: 'none', sources: [], imageWidth: 1024, imageHeight: 576,
  providers: { externalAI: true, text: { id: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL }, image: { id: 'gemini-api', model: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL } } };
const project = { id: A, revision: 1, status: 'generating', createdAt: now, updatedAt: now, request, document: null };
const job = { id: 'job-1', status: 'claimed', stage: 'generate', sceneNo: null, errorCode: null, attempts: 1, lastHeartbeat: now };
const summary = { id: A, revision: 1, status: 'generating', title: 'Project A', createdAt: now, updatedAt: now };
const models = storyboardGeminiDeclaredModels();
const state = { catalogReads: 0 };
window.storyboardWorkerFixture = state;
const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init = {}) => {
  const path = new URL(url, location.href).pathname, method = init.method || 'GET';
  if (path === '/api/admin/storyboard/production' && method === 'GET') {
    state.catalogReads += 1;
    return reply({ ok: true, readiness: READY, workers: [{ id: 'fixture-gemini-worker', online: state.catalogReads < 2, lastHeartbeat: now, models }], projects: [summary] });
  }
  if (path === '/api/admin/storyboard/production/' + A && method === 'GET') return reply({ ok: true, project, job, events: [] });
  throw new Error('Unexpected fixture request');
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace />);
`;
  const bundle = await Bun.build({
    entrypoints: ['storyboard-worker-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-storyboard', setup(builder) {
      builder.onResolve({ filter: /^storyboard-worker-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: join(import.meta.dir, '..') }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, join(import.meta.dir, '..')) }));
    } }],
  });
  expect(bundle.success).toBe(true);
  script = await bundle.outputs[0].text();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
});
afterAll(async () => { await browser?.close(); });

declare global { interface Window { storyboardWorkerFixture: { catalogReads: number } } }

localTest('an active storyboard job refreshes worker connection without a manual catalog reload', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = [], blocked: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().url().startsWith('http://storyboard.fixture.test/')) {
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
      blocked.push(route.request().url()); return route.abort();
    });
    try {
      await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}`);
      await page.addScriptTag({ content: script });
      await page.getByRole('button', { name: '연결 설정' }).click();
      const panel = page.getByRole('region', { name: '제작 연결' });
      await playwrightExpect(panel.getByText('제작 워커 연결됨')).toBeVisible();
      await playwrightExpect(panel.getByText('목록 확인 중…')).toHaveCount(0);
      await playwrightExpect(panel.getByText('제작 워커 연결 끊김')).toBeVisible({ timeout: 8_000 });
      await playwrightExpect(panel.getByText('목록 확인 중…')).toHaveCount(0);
      const reads = await page.evaluate(() => window.storyboardWorkerFixture.catalogReads);
      expect(reads).toBeGreaterThan(1);
      expect(errors).toEqual([]); expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 30_000);
