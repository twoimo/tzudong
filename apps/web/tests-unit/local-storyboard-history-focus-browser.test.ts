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
const scene = (n, revision) => ({ sceneNo: n, title: 'Scene ' + n, durationSec: 10, description: 'Description v' + revision, visualDirection: 'Camera',
  narration: 'Narration', caption: 'Caption', productionNotes: ['Note'], imagePrompt: 'Image', sourceIds: [], revision, image: null, imageError: null });
const doc = revision => ({ schema: STORYBOARD_WORKFLOW, projectId: A, revision, generatedAt: now, title: 'Project A v' + revision, logline: 'Fixture',
  textProvenance: { providerId: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL, verification: 'official-api', generatedAt: now, requestId: A, responseId: 'fixture-response', responseModel: STORYBOARD_GEMINI_TEXT_MODEL, modelEvidence: 'response' },
  scenes: Array.from({ length: 5 }, (_, i) => scene(i + 1, revision)) });
const project = { id: A, revision: 3, status: 'partial', createdAt: now, updatedAt: now,
  request: { workflow: STORYBOARD_WORKFLOW, requestId: A, prompt: 'Fixture', sceneCount: 5, retrieval: 'none', sources: [], imageWidth: 1024, imageHeight: 576,
    providers: { externalAI: true, text: { id: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL }, image: { id: 'gemini-api', model: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL } } },
  document: doc(3) };
const workers = [{ id: 'fixture-gemini-worker', online: true, lastHeartbeat: now, models: storyboardGeminiDeclaredModels() }];
const state = window.storyboardHistoryFixture = { failPreview: '1', restores: 0, holdVersions: false, failVersions: false, release() {}, versionReads: 0 };
crypto.randomUUID ??= () => '22222222-2222-4222-8222-222222222222';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init = {}) => {
  const parsed = new URL(url, location.href), method = init.method || 'GET';
  if (parsed.pathname === '/api/admin/storyboard/production' && method === 'GET') return reply({ ok: true, readiness: READY, workers,
    projects: [{ id: A, revision: project.revision, status: 'partial', title: 'Project A', createdAt: now, updatedAt: now }] });
  if (parsed.pathname !== '/api/admin/storyboard/production/' + A) throw new Error('Unexpected fixture request');
  if (method === 'GET' && parsed.searchParams.get('versions') === '1') {
    state.versionReads += 1;
    if (state.holdVersions) await new Promise(resolve => { state.release = resolve; });
    if (state.failVersions) return reply({ ok: false }, 503);
    const target = parsed.searchParams.get('targetRevision');
    if (target && target === state.failPreview) throw new TypeError('Fixture offline');
    const versions = Array.from({ length: project.revision }, (_, i) => ({ revision: i + 1, createdAt: now, title: 'Project A v' + (i + 1), sceneCount: 5 }));
    return reply({ ok: true, versions, preview: target ? doc(Number(target)) : null });
  }
  if (method === 'GET') return reply({ ok: true, project: structuredClone(project), job: null, events: [] });
  const body = JSON.parse(init.body);
  if (body.action !== 'restore' || body.revision !== project.revision) throw new Error('Unexpected mutation');
  state.restores++;
  project.revision++;
  project.document = { ...doc(body.targetRevision), revision: project.revision };
  return reply({ ok: true, project: structuredClone(project), job: null, events: [] });
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace />);
`;
  const bundle = await Bun.build({
    entrypoints: ['storyboard-history-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-storyboard', setup(builder) {
      builder.onResolve({ filter: /^storyboard-history-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
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

declare global { interface Window { storyboardHistoryFixture: { failPreview: string | null; restores: number; holdVersions: boolean; failVersions: boolean; release: () => void; versionReads: number } } }

localTest('version history keeps keyboard focus when picking, failing a preview and restoring', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
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
      await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}`);
      await page.addScriptTag({ content: script });
      await page.getByRole('button', { name: '버전 이력' }).click();
      const select = page.locator('#local-history-version');
      await select.focus();
      await select.selectOption('2');
      await playwrightExpect(page.getByText('v2 미리보기 · Project A v2')).toBeVisible();
      await playwrightExpect(select).toBeFocused();

      await select.selectOption('1');
      await playwrightExpect(page.locator('section[aria-labelledby="local-version-title"] [role="alert"]')).toBeVisible();
      await playwrightExpect(select).toBeVisible();
      await playwrightExpect(select).toBeFocused();
      await playwrightExpect(page.getByText(/v1 미리보기/)).toHaveCount(0);

      await select.selectOption('2');
      await playwrightExpect(page.getByText('v2 미리보기 · Project A v2')).toBeVisible();
      await page.getByRole('checkbox').check();
      const restore = page.getByRole('button', { name: '프로젝트 전체 복원' });
      await restore.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(page.locator('#local-history-version option[value="4"]')).toHaveCount(1);
      await playwrightExpect(select).toHaveValue('');
      await playwrightExpect(page.getByRole('button', { name: '버전 목록 새로고침' })).toBeFocused();
      expect(await page.evaluate(() => window.storyboardHistoryFixture.restores)).toBe(1);
      expect(errors).toEqual([]); expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 40_000);

localTest('failed version history stays visible while the list refresh is in flight', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  const failure = '요청 상태를 확인하지 못했습니다. 새로고침하여 저장 여부를 확인하세요. 자동 재전송하지 않습니다.';
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
      await page.getByRole('button', { name: '버전 이력' }).click();
      await playwrightExpect(page.locator('#local-history-version')).toBeVisible();
      await page.evaluate(() => { window.storyboardHistoryFixture.failVersions = true; });
      const refresh = page.getByRole('button', { name: '버전 목록 새로고침' });
      await refresh.click();
      const versionAlert = page.locator('section[aria-labelledby="local-version-title"] [role="alert"]');
      await playwrightExpect(versionAlert).toHaveText(failure);
      const reads = await page.evaluate(() => window.storyboardHistoryFixture.versionReads);
      await page.evaluate(() => { window.storyboardHistoryFixture.holdVersions = true; });
      await refresh.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(refresh).toBeFocused();
      await playwrightExpect(refresh).not.toHaveAttribute('disabled');
      await playwrightExpect(versionAlert).toHaveText(failure);
      await playwrightExpect(page.getByText('버전 불러오는 중…')).toHaveCount(0);
      await playwrightExpect(page.locator('#local-history-version')).toBeVisible();
      expect(await page.evaluate(() => window.storyboardHistoryFixture.versionReads)).toBe(reads + 1);
      await page.evaluate(() => window.storyboardHistoryFixture.release());
      await playwrightExpect(versionAlert).toHaveText(failure);
      await playwrightExpect(refresh).toBeFocused();
      expect(errors).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 40_000);

localTest('visible version history keeps its status while the list is read again', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (route.request().isNavigationRequest() && url.startsWith('http://storyboard.fixture.test/')) {
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
      if (!url.startsWith('http://storyboard.fixture.test/')) externalRequests += 1;
      return route.abort();
    });
    try {
      await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}`);
      await page.addScriptTag({ content: script });
      await page.getByRole('button', { name: '버전 이력' }).click();
      const select = page.locator('#local-history-version');
      const refresh = page.getByRole('button', { name: '버전 목록 새로고침' });
      await playwrightExpect(select.locator('option[value="1"]')).toHaveCount(1);
      await playwrightExpect(page.getByText('버전 불러오는 중…')).toHaveCount(0);

      await page.evaluate(() => { window.storyboardHistoryFixture.holdVersions = true; });
      await refresh.click();
      await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(select.locator('option[value="1"]')).toHaveCount(1);
      await playwrightExpect(page.getByText('버전 불러오는 중…')).toHaveCount(0);

      await page.evaluate(() => window.storyboardHistoryFixture.release());
      await playwrightExpect(refresh).not.toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(select.locator('option[value="1"]')).toHaveCount(1);
      await playwrightExpect(page.getByText('버전 불러오는 중…')).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(externalRequests).toBe(0);
    } finally {
      await context.close();
    }
  }
}, 40_000);
