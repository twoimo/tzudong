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
    const submitted = {
      id: 'submission-fixture', user_id: 'user-fixture', submission_type: 'new', status: 'pending',
      restaurant_name: '이전 식당', restaurant_address: '합성 주소', restaurant_phone: null, restaurant_categories: ['한식'],
      admin_notes: null, rejection_reason: null, resolved_by_admin_id: null, reviewed_at: null,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      items: [{ id: 'submission-fixture:item', submission_id: 'submission-fixture', youtube_link: '', tzuyang_review: '', target_restaurant_id: null,
        item_status: 'pending', rejection_reason: null, created_at: '2026-10-01T00:00:00Z' }],
      profiles: { nickname: '합성 제보자' }, original_restaurant_data: null,
    };
    function Fixture() {
      const [loading, setLoading] = useState(false);
      globalThis.__submissionListCount = { hold() { setLoading(true); }, release() { setLoading(false); } };
      return <main style={{ height: '100vh' }}>
        <SubmissionListView submissions={[submitted]} reviews={[]} initialTab="new" loading={loading}
          onApprove={() => {}} onReject={() => {}} onDelete={() => {}} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['submission-list-count-fixture'], target: 'browser', format: 'iife', write: false,
    define: {
      'process.env.NODE_ENV': '"test"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
      'process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME': '"0"',
    },
    plugins: [{ name: 'submission-list-count-fixture', setup(builder) {
      builder.onResolve({ filter: /^submission-list-count-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : args.path === 'navigation'
        ? "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

declare global {
  interface Window {
    __submissionListCount: { hold: () => void; release: () => void };
  }
}

(existsSync(chrome) ? test : test.skip)('a visible submission list keeps its count while another read is still loading', async () => {
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
          if (route.request().url() === 'https://submission-list-count.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://submission-list-count.test/')) externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://submission-list-count.test/admin');
        await page.addScriptTag({ content: script });

        const footer = page.locator('.admin-cms-footer');
        const row = page.getByRole('button', { name: /이전 식당/ });
        await playwrightExpect(row).toBeVisible();
        await playwrightExpect(footer).toContainText('1 / 1건');
        await playwrightExpect(page.getByText('신규 제보').first()).toBeVisible();

        await page.evaluate(() => window.__submissionListCount.hold());
        await playwrightExpect(row).toBeVisible();
        await playwrightExpect(footer).toContainText('1 / 1건');
        await playwrightExpect(footer).not.toContainText('조회 중');

        await page.evaluate(() => window.__submissionListCount.release());
        await playwrightExpect(row).toBeVisible();
        await playwrightExpect(footer).toContainText('1 / 1건');
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
