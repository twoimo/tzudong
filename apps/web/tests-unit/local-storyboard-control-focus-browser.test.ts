import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
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
const A = '${A}', B = '${B}', now = '2026-10-05T00:00:00.000Z';
const READY = Object.freeze({ schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' });
const request = id => ({ workflow: STORYBOARD_WORKFLOW, requestId: id, prompt: 'Fixture', sceneCount: 5, retrieval: 'none', sources: [], imageWidth: 1024, imageHeight: 576,
  providers: { externalAI: true, text: { id: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL }, image: { id: 'gemini-api', model: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL } } });
const projects = {
  [A]: { id: A, revision: 1, status: 'generating', createdAt: now, updatedAt: now, request: request(A), document: null },
  [B]: { id: B, revision: 1, status: 'partial', createdAt: now, updatedAt: now, request: request(B), document: null },
};
const jobs = { [A]: { id: 'job-1', status: 'claimed', stage: 'generate', sceneNo: null, errorCode: null, attempts: 1, lastHeartbeat: now } };
const summary = id => ({ id, revision: 1, status: projects[id].status, title: id === A ? 'Project A' : 'Project B', createdAt: now, updatedAt: now });
const workers = [{ id: 'fixture-gemini-worker', online: true, lastHeartbeat: now, models: storyboardGeminiDeclaredModels() }];
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init = {}) => {
  const path = new URL(url, location.href).pathname, method = init.method || 'GET';
  if (path === '/api/admin/storyboard/production' && method === 'GET') return reply({ ok: true, readiness: READY, workers, projects: [summary(A), summary(B)] });
  const id = path.split('/').at(-1);
  if (!projects[id]) throw new Error('Unexpected fixture request');
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (body.action !== 'cancel' || id !== A) throw new Error('Unexpected mutation');
    projects[A].status = 'cancelled';
    jobs[A] = { ...jobs[A], status: 'cancelled' };
    return reply({ ok: true, project: projects[A], job: jobs[A], events: [] });
  }
  if (id === B) return new Response('', { status: 503 });
  return reply({ ok: true, project: projects[A], job: jobs[A], events: [] });
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace />);
`;
  const bundle = await Bun.build({
    entrypoints: ['storyboard-control-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-storyboard', setup(builder) {
      builder.onResolve({ filter: /^storyboard-control-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
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

localTest('storyboard cancel, new project and a failed library pick keep a keyboard target', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [], blocked: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => void dialog.accept());
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().url().startsWith('http://storyboard.fixture.test/')) {
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
      blocked.push(route.request().url()); return route.abort();
    });
    try {
      await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}`);
      await page.addScriptTag({ content: script });
      const cancel = page.getByRole('button', { name: '작업 취소' });
      await cancel.focus();
      await page.keyboard.press('Enter');
      const heading = page.getByRole('heading', { name: '저장된 제작 요청' });
      await playwrightExpect(page.getByLabel('저장된 스토리보드').getByRole('status')).toContainText('취소됨');
      await playwrightExpect(heading).toBeFocused();

      await page.getByRole('button', { name: '새 프로젝트' }).focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(page.locator('#local-storyboard-prompt')).toBeFocused();

      await page.getByRole('button', { name: /Project B/ }).click();
      await playwrightExpect(page.getByRole('alert').filter({ hasText: '요청 상태를 확인하지 못했습니다' })).toBeVisible();
      await playwrightExpect(page.locator('#local-project-select')).toBeFocused();
      expect(errors).toEqual([]); expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 60_000);
