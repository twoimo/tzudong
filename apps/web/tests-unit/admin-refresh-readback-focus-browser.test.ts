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
    import { AdminRestaurantRefreshHistoryPanel } from './components/admin/AdminRestaurantRefreshHistoryPanel';
    const candidate = status => ({ id: '55555555-5555-4555-8555-555555555555', restaurant_id: '66666666-6666-4666-8666-666666666666', restaurant_name: '전화 바뀐 맛집',
      restaurant_address: null, current_phone: '02-000-0000', candidate_status: status, detected_change_types: ['phone'], previous_snapshot: {}, candidate_snapshot: {}, evidence: {},
      created_at: '2026-10-20T00:00:00Z', decided_at: status === 'needs_review' ? null : '2026-10-21T00:00:00Z', applied_at: null,
      readback_state: { status: 'not_required', checked_at: null, run_id: null, notes: null } });
    const fixture = { decided: false, exact: 'fail', delayMs: 0, exactReads: 0 };
    globalThis.__readbackFixture = fixture;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    const summary = { approved_restaurants_total: 40, needs_review: 1, approved: 0, applied: 0, rejected: 0, last_checked_at: null };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input), location.href);
      if (url.pathname !== '/api/admin/restaurant-refresh-history') throw new Error('OFFLINE_ONLY');
      if (init.method === 'POST') { fixture.decided = true; return json({ ok: false }, 500); }
      if (url.searchParams.has('candidate_id')) {
        fixture.exactReads++;
        await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
        if (fixture.exact === 'fail') return new Response('', { status: 503 });
      }
      return json({ candidates: [candidate(fixture.decided && fixture.exact === 'ok' ? 'approved' : 'needs_review')], summary });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main style={{ height: '100vh' }}><AdminRestaurantRefreshHistoryPanel /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['readback-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'readback-fixture', setup(builder) {
      builder.onResolve({ filter: /^readback-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { decided: boolean; exact: 'fail' | 'ok'; delayMs: number; exactReads: number };
const setFixture = (page: Page, changes: Partial<Fixture>) => page.evaluate(next => {
  Object.assign((globalThis as unknown as { __readbackFixture: Fixture }).__readbackFixture, next);
}, changes);

(existsSync(chrome) ? test : test.skip)('an unconfirmed refresh decision keeps keyboard focus through readback retries', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://readback.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://readback.test/admin');
        await page.addScriptTag({ content: script });

        await page.getByRole('button', { name: '전화 바뀐 맛집 상세 보기' }).filter({ visible: true }).first().click();
        const save = page.getByRole('button', { name: '결정 저장' });
        await save.focus();
        await page.keyboard.press('Enter');
        const recheck = page.getByRole('button', { name: /결정 상태 다시 확인|확인 중…/ });
        await playwrightExpect(recheck).toHaveText('결정 상태 다시 확인');
        await playwrightExpect(recheck).toBeFocused();

        await setFixture(page, { delayMs: 600 });
        await page.keyboard.press('Enter');
        await playwrightExpect(recheck).toHaveText('확인 중…');
        await playwrightExpect(recheck).toBeFocused();
        await playwrightExpect(recheck).toHaveText('결정 상태 다시 확인');
        await playwrightExpect(recheck).toBeFocused();

        await setFixture(page, { exact: 'ok', delayMs: 0 });
        await page.keyboard.press('Enter');
        await playwrightExpect(page.getByText('최신 이력에서 요청한 결정 상태를 확인했습니다.')).toBeVisible();
        await playwrightExpect(recheck).toHaveCount(0);
        await playwrightExpect(page.locator('#refresh-detail-heading')).toBeFocused();
        expect(await page.evaluate(() => (globalThis as unknown as { __readbackFixture: Fixture }).__readbackFixture.exactReads)).toBe(2);
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
