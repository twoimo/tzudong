import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { StoryboardProjectLibrary } from './components/admin/storyboard/StoryboardProjectLibrary';
    const statusLabels = {
      waiting_worker: '워커 대기', generating: '생성 중', awaiting_import: '가져오기 대기',
      partial: '일부 저장', ready: '준비됨', failed: '실패', cancelled: '취소',
    };
    const project = {
      id: 'project-fixture', title: '이전 프로젝트', status: 'ready', revision: 2, updatedAt: '2026-10-01T00:00:00Z',
    };
    function Fixture() {
      const [busy, setBusy] = useState(false);
      globalThis.__storyboardLibraryStatus = { hold() { setBusy(true); }, release() { setBusy(false); } };
      return <main style={{ height: '100vh' }}>
        <StoryboardProjectLibrary projects={[project]} selectedId={null} statusLabels={statusLabels}
          busy={busy} error={null} countUnknown={false} onRefresh={() => {}} onSelect={() => {}} onStart={() => {}} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['storyboard-library-status-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'storyboard-library-status-fixture', setup(builder) {
      builder.onResolve({ filter: /^storyboard-library-status-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global {
  interface Window {
    __storyboardLibraryStatus: { hold: () => void; release: () => void };
  }
}

(existsSync(chrome) ? test : test.skip)('a visible storyboard library keeps its status while the list is read again', async () => {
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
          if (route.request().url() === 'https://storyboard-library-status.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://storyboard-library-status.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://storyboard-library-status.test/admin');
        await page.addScriptTag({ content: script });

        const status = page.getByRole('status');
        const row = page.getByRole('button', { name: /이전 프로젝트/ });
        await playwrightExpect(row).toBeVisible();
        await playwrightExpect(status).toHaveText('최근 수정 순');

        await page.evaluate(() => window.__storyboardLibraryStatus.hold());
        await playwrightExpect(row).toBeVisible();
        await playwrightExpect(status).toHaveText('최근 수정 순');
        await playwrightExpect(page.getByText('프로젝트 목록 확인 중…')).toHaveCount(0);

        await page.evaluate(() => window.__storyboardLibraryStatus.release());
        await playwrightExpect(row).toBeVisible();
        await playwrightExpect(status).toHaveText('최근 수정 순');
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);
