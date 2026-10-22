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
const project = { id: A, revision: 1, status: 'partial', createdAt: now, updatedAt: now, request, document: null };
const summary = { id: A, revision: 1, status: 'partial', title: 'Project A', createdAt: now, updatedAt: now };
const workers = [{ id: 'fixture-gemini-worker', online: true, lastHeartbeat: now, models: storyboardGeminiDeclaredModels() }];
const waiters = [];
const fixture = { reads: 0, hold: false, release() { const pending = waiters.splice(0); for (const resolve of pending) resolve(); } };
const failProject = new URL(location.href).searchParams.has('failProject');
window.storyboardProjectRefresh = fixture;
const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
window.fetch = async url => {
  const path = new URL(url, location.href).pathname;
  if (path === '/api/admin/storyboard/production') return reply({ ok: true, readiness: READY, workers, projects: [summary] });
  if (path !== '/api/admin/storyboard/production/' + A) throw new Error('Unexpected fixture request');
  fixture.reads += 1;
  if (fixture.hold && fixture.reads > 1) await new Promise(resolve => { waiters.push(resolve); });
  if (failProject) return new Response('', { status: 503 });
  return reply({ ok: true, project, job: null, events: [] });
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace />);
`;
  const bundle = await Bun.build({
    entrypoints: ['storyboard-project-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-storyboard', setup(builder) {
      builder.onResolve({ filter: /^storyboard-project-refresh-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
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

declare global { interface Window { storyboardProjectRefresh: { hold: boolean; release: () => void } } }

localTest('storyboard project refresh keeps keyboard focus while the saved project reloads', async () => {
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
      const workspace = page.getByLabel('저장된 스토리보드');
      await playwrightExpect(workspace.getByRole('status')).toContainText('일부 결과 저장됨');
      const refresh = workspace.getByRole('button', { name: '새로고침' });
      await page.evaluate(() => { window.storyboardProjectRefresh.hold = true; });
      await refresh.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(refresh).toBeFocused();
      await playwrightExpect(refresh).not.toHaveAttribute('disabled');
      await page.evaluate(() => window.storyboardProjectRefresh.release());
      await playwrightExpect(refresh).toBeFocused();
      await playwrightExpect(workspace.getByRole('status')).toContainText('일부 결과 저장됨');
      expect(errors).toEqual([]); expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 60_000);

localTest('a failed storyboard project read stays unread while refreshing', async () => {
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
      await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}&failProject=1`);
      await page.addScriptTag({ content: script });
      const workspace = page.getByLabel('저장된 스토리보드');
      const status = workspace.getByRole('status');
      await playwrightExpect(status).toHaveText('아직 저장 결과를 확인하지 못했습니다.');
      await playwrightExpect(workspace.getByRole('alert')).toContainText('요청 상태를 확인하지 못했습니다.');
      const refresh = workspace.getByRole('button', { name: '새로고침' });
      await page.evaluate(() => { window.storyboardProjectRefresh.hold = true; });
      await refresh.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(refresh).toBeFocused();
      await playwrightExpect(status).toHaveText('아직 저장 결과를 확인하지 못했습니다.');
      await playwrightExpect(page.getByText('저장된 결과 확인 중…')).toHaveCount(0);
      await playwrightExpect(workspace.getByRole('alert')).toContainText('요청 상태를 확인하지 못했습니다.');
      await page.evaluate(() => window.storyboardProjectRefresh.release());
      await playwrightExpect(status).toHaveText('아직 저장 결과를 확인하지 못했습니다.');
      await playwrightExpect(refresh).toBeFocused();
      expect(errors).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 60_000);
