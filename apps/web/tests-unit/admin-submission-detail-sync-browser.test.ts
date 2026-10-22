import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { SubmissionListView } from './components/admin/SubmissionListView';
    const record = status => ({
      id: 'submission-fixture', user_id: 'user-fixture', submission_type: 'new', status,
      restaurant_name: '합성 신규 식당', restaurant_address: '합성 주소', restaurant_phone: null, restaurant_categories: ['한식'],
      admin_notes: null, rejection_reason: null, resolved_by_admin_id: null, reviewed_at: status === 'pending' ? null : '2026-10-21T00:00:00Z',
      created_at: '2026-10-01T00:00:00Z', updated_at: status === 'pending' ? '2026-10-01T00:00:00Z' : '2026-10-21T00:00:00Z',
      items: [{ id: 'submission-fixture:item', submission_id: 'submission-fixture', youtube_link: '', tzuyang_review: '', target_restaurant_id: null,
        item_status: status === 'pending' ? 'pending' : status, rejection_reason: null, created_at: '2026-10-01T00:00:00Z' }],
      profiles: { nickname: '합성 제보자' }, original_restaurant_data: null,
    });
    globalThis.fetch = async () => { throw new Error('OFFLINE_ONLY'); };
    function Fixture() {
      const [rows, setRows] = useState([record('pending')]);
      globalThis.__submissionSync = {
        approveElsewhere: () => setRows([record('approved')]),
        removeElsewhere: () => setRows([]),
      };
      return <main style={{ height: '100vh' }}>
        <SubmissionListView submissions={rows} reviews={[]} initialTab="new"
          onApprove={() => {}} onReject={() => {}} onDelete={() => {}} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['submission-sync-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
      'process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME': '"0"' },
    plugins: [{ name: 'submission-sync-fixture', setup(builder) {
      builder.onResolve({ filter: /^submission-sync-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : args.path === 'navigation'
        ? "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  expect(built.success).toBe(true);
  return built.outputs[0].text();
}

const act = (page: Page, name: 'approveElsewhere' | 'removeElsewhere') =>
  page.evaluate(key => (globalThis as unknown as { __submissionSync: Record<string, () => void> }).__submissionSync[key](), name);

(existsSync(chrome) ? test : test.skip)('an open submission detail follows the latest list read', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const [width, change] of [[1440, 'approveElsewhere'], [390, 'approveElsewhere'], [1440, 'removeElsewhere']] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://submission-sync.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          externalRequests++;
          return route.abort();
        });
        await page.goto('https://submission-sync.test/');
        await page.addScriptTag({ content: script });

        await page.locator('[data-admin-submission-row="submission-fixture"] button, [data-admin-submission-card="submission-fixture"] button').filter({ visible: true }).first().click();
        const detail = page.locator('[data-admin-moderation-inspector="true"]');
        const summary = detail.locator('.admin-detail-section').first();
        await playwrightExpect(summary.getByText('대기', { exact: true })).toBeVisible();
        const reject = detail.getByRole('button', { name: '전체 거부' });
        await reject.focus();

        await act(page, change);
        if (change === 'approveElsewhere') {
          await playwrightExpect(summary.getByText('승인', { exact: true })).toBeVisible();
        } else {
          await playwrightExpect(detail.getByRole('status').filter({ hasText: '최신 목록에 없습니다' })).toBeVisible();
        }
        await playwrightExpect(detail.getByRole('button', { name: '전체 거부' })).toHaveCount(0);
        await playwrightExpect(detail).toBeFocused();
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
