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
    import { RestaurantReviewAutomation } from './components/admin/RestaurantReviewAutomation';
    const fixture = { mode: 'fail' };
    globalThis.__automationStatus = fixture;
    const snapshot = {
      policy: { version: 1, enabled: false, batch_size: 50, daily_limit: 50, last_run_at: null },
      runs: [], items: [], queue: { queued: 0, running: 0, failed: 0 },
    };
    globalThis.fetch = async input => {
      const url = String(input);
      if (url !== '/api/admin/evaluations/automation') return new Response('', { status: 503 });
      if (fixture.mode !== 'ok') return new Response('', { status: 503 });
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    createRoot(document.body.appendChild(document.createElement('div'))).render(<main><RestaurantReviewAutomation onApplied={() => {}} /></main>);
  `;
  const built = await Bun.build({
    entrypoints: ['automation-status-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'automation-status-fixture', setup(builder) {
      builder.onResolve({ filter: /^automation-status-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

const setMode = (page: Page, mode: 'fail' | 'ok') => page.evaluate(next => {
  (globalThis as unknown as { __automationStatus: { mode: string } }).__automationStatus.mode = next;
}, mode);

(existsSync(chrome) ? test : test.skip)('a failed automation status read is not shown as still loading', async () => {
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
          if (route.request().url() === 'https://automation-status.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (new URL(route.request().url()).origin !== 'https://automation-status.test') externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://automation-status.test/admin');
        await page.addScriptTag({ content: script });

        const status = page.getByRole('status');
        await playwrightExpect(page.getByRole('alert')).toHaveText('자동 운영 상태를 불러오지 못했습니다.');
        await playwrightExpect(status).toHaveText('상태 확인 실패');
        await playwrightExpect(page.getByText('상태 확인 중')).toHaveCount(0);

        await setMode(page, 'ok');
        await page.getByRole('button', { name: '자동 운영 상태 새로고침' }).click();
        await playwrightExpect(status).toHaveText('중지됨 · 판단 연결 미확인');
        await playwrightExpect(page.getByRole('alert')).toHaveCount(0);

        await setMode(page, 'fail');
        await page.getByRole('button', { name: '자동 운영 상태 새로고침' }).click();
        await playwrightExpect(page.getByRole('alert')).toHaveText('자동 운영 상태를 불러오지 못했습니다.');
        await playwrightExpect(status).toHaveText('중지됨 · 판단 연결 미확인');
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
