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
    import { SubmissionListView } from './components/admin/SubmissionListView';
    function Fixture() {
      const [loading, setLoading] = useState(false);
      globalThis.__submissionRefresh = { release: () => setLoading(false) };
      return <main style={{ height: '100vh' }}>
        <SubmissionListView submissions={[]} reviews={[]} initialTab="new" loading={loading} submissionsError
          onRefresh={() => setLoading(true)} onApprove={() => {}} onReject={() => {}} onDelete={() => {}} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['submission-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
      'process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME': '"0"' },
    plugins: [{ name: 'submission-refresh-fixture', setup(builder) {
      builder.onResolve({ filter: /^submission-refresh-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : args.path === 'navigation'
        ? "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs[0].text();
}

declare global { interface Window { __submissionRefresh: { release: () => void } } }

(existsSync(chrome) ? test : test.skip)('submission list refresh keeps keyboard focus while the list reloads', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://submission-refresh.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://submission-refresh.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://submission-refresh.test/');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByText('신규 제보 목록을 불러오지 못했습니다.')).toBeVisible();
        const refresh = page.getByRole('button', { name: '목록 새로고침' });
        await refresh.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(refresh).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(refresh).toBeFocused();
        await playwrightExpect(refresh).not.toHaveAttribute('disabled');
        await page.evaluate(() => window.__submissionRefresh.release());
        await playwrightExpect(refresh).toBeFocused();
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toEqual(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
