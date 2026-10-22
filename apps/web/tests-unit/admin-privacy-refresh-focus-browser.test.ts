import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
let browser: Browser | undefined;
let script: string;

beforeAll(async () => {
  if (!existsSync(chrome)) return;
  const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from './app/admin/privacy-incidents/page';
const state = { reads: 0, hold: false, release: () => {} };
window.privacyFixture = state;
const ok = { ok: true, serverNow: '2026-10-21T00:00:00.000Z', incidents: [], notices: [], actions: [] };
const failFirst = new URL(location.href).searchParams.has('failFirst');
window.fetch = async (url) => {
  if (new URL(url, location.href).pathname !== '/api/admin/privacy-incidents') throw new Error('Unexpected fixture request');
  state.reads += 1;
  if (state.hold) await new Promise(resolve => { state.release = resolve; });
  if (failFirst ? state.reads === 1 : state.reads > 1) return new Response('', { status: 503 });
  return new Response(JSON.stringify(ok), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')).render(<Page />);
`;
  const bundle = await Bun.build({
    entrypoints: ['privacy-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-privacy', setup(builder) {
      builder.onResolve({ filter: /^privacy-refresh-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: join(import.meta.dir, '..') }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, join(import.meta.dir, '..')) }));
    } }],
  });
  expect(bundle.success).toBe(true);
  script = await bundle.outputs[0].text();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
}, 60_000);
afterAll(async () => { await browser?.close(); });

declare global { interface Window { privacyFixture: { hold: boolean; release: () => void } } }

async function open(page: Page, scriptText: string, search = '') {
  const errors: string[] = [];
  const blocked: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().isNavigationRequest() && route.request().url().startsWith('http://privacy.fixture.test/')) {
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    }
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.goto(`http://privacy.fixture.test/admin/privacy-incidents${search}`);
  await page.addScriptTag({ content: scriptText });
  return { errors, blocked };
}

localTest('privacy incident refresh keeps keyboard focus while the list reloads', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    try {
      const { errors, blocked } = await open(page, script);
      await playwrightExpect(page.getByText('표시할 사고가 없습니다. 위 탐지 등록으로 첫 사고를 기록한 뒤 상태 전환을 진행하세요.')).toBeVisible();
      const refresh = page.getByRole('button', { name: '개인정보 사고 목록 새로고침' });
      await page.evaluate(() => { window.privacyFixture.hold = true; });
      await refresh.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(refresh).toBeFocused();
      await page.evaluate(() => window.privacyFixture.release());
      await playwrightExpect(page.locator('[data-privacy-incident-list-read-state="stale"]')).toHaveText('새로고침에 실패해 마지막 확인 결과를 표시합니다.');
      await playwrightExpect(page.getByText('개인정보 사고 작업을 완료하지 못했습니다. 원문 오류는 표시하지 않습니다.')).toHaveCount(0);
      await playwrightExpect(refresh).toBeFocused();
      expect(errors).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 40_000);

localTest('failed privacy incident list stays unknown while the first retry is in flight', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    try {
      const { errors, blocked } = await open(page, script, '?failFirst=1');
      await playwrightExpect(page.getByText('사고 현황 미확인')).toBeVisible();
      await playwrightExpect(page.getByText('사고 목록을 불러오지 못했습니다. 새로고침하여 다시 확인하세요.')).toBeVisible();
      const refresh = page.getByRole('button', { name: '개인정보 사고 목록 새로고침' });
      await page.evaluate(() => { window.privacyFixture.hold = true; });
      await refresh.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
      await playwrightExpect(refresh).toBeFocused();
      await playwrightExpect(refresh).not.toHaveAttribute('disabled');
      await playwrightExpect(page.getByText('사고 현황 미확인')).toBeVisible();
      await playwrightExpect(page.getByText('사고 목록을 불러오지 못했습니다. 새로고침하여 다시 확인하세요.')).toBeVisible();
      await playwrightExpect(page.getByText('사고 현황 조회 중')).toHaveCount(0);
      await playwrightExpect(page.getByText('사고 목록을 불러오는 중입니다.')).toHaveCount(0);
      await page.evaluate(() => window.privacyFixture.release());
      await playwrightExpect(page.getByText('표시할 사고가 없습니다. 위 탐지 등록으로 첫 사고를 기록한 뒤 상태 전환을 진행하세요.')).toBeVisible();
      await playwrightExpect(refresh).toBeFocused();
      expect(errors).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 40_000);
