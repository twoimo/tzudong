import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
const A = '11111111-1111-4111-8111-111111111111';
const HOLD_MESSAGE = '데이터베이스 전환이 완료될 때까지 새 생성과 변경은 보류됩니다.';
const UNKNOWN_MESSAGE = '제작 가능 여부를 확인하지 못했습니다. 목록을 다시 불러온 뒤 만들 수 있습니다.';
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
const readiness = status => Object.freeze({ schemaVersion: 1, status, code: status === 'ready' ? 'FEATURE_DATABASE_READY' : 'FEATURE_DATABASE_HELD' });
const project = { id: A, revision: 1, status: 'partial', createdAt: now, updatedAt: now,
  request: { workflow: STORYBOARD_WORKFLOW, requestId: A, prompt: 'Fixture', sceneCount: 5, retrieval: 'none', sources: [], imageWidth: 1024, imageHeight: 576,
    providers: { externalAI: true, text: { id: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL }, image: { id: 'gemini-api', model: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL } } },
  document: null };
const workers = [{ id: 'fixture-gemini-worker', online: true, lastHeartbeat: now, models: storyboardGeminiDeclaredModels() }];
const state = window.storyboardCatalogFixture = { catalog: 'fail', catalogReads: 0 };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init = {}) => {
  const path = new URL(url, location.href).pathname;
  if (path === '/api/admin/storyboard/production' && (init.method || 'GET') === 'GET') {
    state.catalogReads++;
    if (state.catalog === 'fail') throw new TypeError('Fixture offline');
    return reply({ ok: true, readiness: readiness(state.catalog), workers,
      projects: [{ id: A, revision: 1, status: 'partial', title: 'Project A', createdAt: now, updatedAt: now }] });
  }
  if (path === '/api/admin/storyboard/production/' + A) return reply({ ok: true, project, job: null, events: [] });
  throw new Error('Unexpected fixture request');
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace />);
`;
  const bundle = await Bun.build({
    entrypoints: ['storyboard-catalog-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-storyboard', setup(builder) {
      builder.onResolve({ filter: /^storyboard-catalog-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
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

type CatalogFixture = { catalog: 'fail' | 'ready' | 'held'; catalogReads: number };
declare global { interface Window { storyboardCatalogFixture: CatalogFixture } }

async function run(path: string, width: number, check: (page: Page) => Promise<void>) {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors: string[] = [], blocked: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().isNavigationRequest() && route.request().url().startsWith('http://storyboard.fixture.test/')) {
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    }
    blocked.push(route.request().url()); return route.abort();
  });
  try {
    await page.goto(`http://storyboard.fixture.test${path}`);
    await page.addScriptTag({ content: script });
    await check(page);
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
  } finally { await context.close(); }
}
const setCatalog = (page: Page, catalog: CatalogFixture['catalog']) => page.evaluate(value => { window.storyboardCatalogFixture.catalog = value; }, catalog);

for (const width of [1280, 390]) {
  localTest(`failed catalog read is not reported as a database hold on the new-project screen (${width}px)`, async () => {
    await run('/admin?module=storyboard', width, async page => {
      await playwrightExpect(page.getByText('프로젝트 목록을 불러오지 못했습니다.', { exact: false })).toBeVisible();
      await playwrightExpect(page.getByText(HOLD_MESSAGE, { exact: false })).toHaveCount(0);
      await playwrightExpect(page.getByText(UNKNOWN_MESSAGE)).toBeVisible();
      await playwrightExpect(page.getByRole('button', { name: '프로젝트 만들기' })).toBeDisabled();

      await setCatalog(page, 'ready');
      await page.getByRole('button', { name: '프로젝트 목록 다시 불러오기' }).click();
      await playwrightExpect(page.getByText(UNKNOWN_MESSAGE)).toHaveCount(0);
      await playwrightExpect(page.getByRole('textbox', { name: '제작 요청' })).toBeEnabled();
      await playwrightExpect(page.getByText(HOLD_MESSAGE, { exact: false })).toHaveCount(0);
    });
  }, 20_000);
}

localTest('failed catalog read keeps an open project locked with a reload path instead of a hold notice', async () => {
  await run(`/admin?module=storyboard&storyboardProject=${A}`, 1280, async page => {
    const alert = page.getByRole('alert').filter({ hasText: '프로젝트 목록을 불러오지 못했습니다.' });
    await playwrightExpect(alert).toBeVisible();
    await playwrightExpect(page.getByText(HOLD_MESSAGE, { exact: false })).toHaveCount(0);
    await playwrightExpect(page.getByRole('button', { name: '재시도' })).toBeDisabled();
    await setCatalog(page, 'ready');
    await alert.getByRole('button', { name: '목록 다시 불러오기' }).click();
    await playwrightExpect(alert).toHaveCount(0);
    await playwrightExpect(page.getByRole('button', { name: '재시도' })).toBeEnabled();
  });
}, 20_000);

localTest('a genuine database hold is still reported as a hold', async () => {
  await run('/admin?module=storyboard', 1280, async page => {
    await setCatalog(page, 'held');
    await page.getByRole('button', { name: '프로젝트 목록 다시 불러오기' }).click();
    await playwrightExpect(page.getByText(HOLD_MESSAGE, { exact: false })).toBeVisible();
    await playwrightExpect(page.getByText(UNKNOWN_MESSAGE)).toHaveCount(0);
    await playwrightExpect(page.getByRole('button', { name: '프로젝트 만들기' })).toBeDisabled();
  });
}, 20_000);
