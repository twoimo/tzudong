import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const reviewEntry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { SubmissionListView } from './components/admin/SubmissionListView';
    const review = {
      id: 'review-fixture', user_id: 'user-fixture', restaurant_id: 'restaurant-fixture',
      title: '합성 리뷰', content: '합성 검수 내용', visited_at: '2026-10-01T00:00:00Z',
      verification_photo: '', food_photos: [], category: '한식', is_verified: false,
      admin_note: null, is_pinned: false, is_edited_by_admin: false,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      profiles: { nickname: '합성 작성자' }, restaurants: { name: '합성 식당', address: '' },
    };
    globalThis.fetch = async input => {
      if (input === '/api/admin/ocr-receipts') return new Response('', { status: 503 });
      throw new Error('OFFLINE_ONLY');
    };
    function Fixture() {
      const [state, setState] = useState('error');
      globalThis.__reviewFixture = {
        fail: () => setState('error'),
        success: () => setState('success'),
      };
      return <main>
        <SubmissionListView submissions={[]} reviews={state === 'success' ? [review] : []}
          initialTab="reviews" reviewsLoading={state === 'loading'} reviewsError={state !== 'success'}
          onApprove={() => {}} onReject={() => {}} onDelete={() => {}}
          onRetryReviews={() => setState('loading')} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
const submissionEntry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { SubmissionListView } from './components/admin/SubmissionListView';
    const record = (id, type, name) => ({
      id, user_id: 'user-fixture', submission_type: type, status: 'pending',
      restaurant_name: name, restaurant_address: '합성 주소', restaurant_phone: null, restaurant_categories: ['한식'],
      admin_notes: null, rejection_reason: null, resolved_by_admin_id: null, reviewed_at: null,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      items: [{ id: id + ':item', submission_id: id, youtube_link: '', tzuyang_review: '', target_restaurant_id: null,
        item_status: 'pending', rejection_reason: null, created_at: '2026-10-01T00:00:00Z' }],
      profiles: { nickname: '합성 제보자' }, original_restaurant_data: null,
    });
    const submitted = record('submission-fixture', 'new', '합성 신규 식당');
    const recommended = record('recommend-fixture', 'recommend', '합성 추천 식당');
    globalThis.fetch = async () => { throw new Error('OFFLINE_ONLY'); };
    function Fixture() {
      const [state, setState] = useState('error');
      globalThis.__submissionFixture = {
        fail: () => setState('error'),
        success: () => setState('success'),
      };
      return <main>
        <SubmissionListView submissions={state === 'success' ? [submitted, recommended] : [recommended]} reviews={[]}
          initialTab="new" loading={state === 'loading'} submissionsError={state !== 'success'}
          onApprove={() => {}} onReject={() => {}} onDelete={() => {}}
          onRetrySubmissions={() => setState('loading')} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;

async function bundle(entry: string) {
  const built = await Bun.build({
    entrypoints: ['review-read-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
      'process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME': '"0"' },
    plugins: [{ name: 'review-read-fixture', setup(builder) {
      builder.onResolve({ filter: /^review-read-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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
  if (process.env.TZUDONG_REVIEW_FIXTURE_OUTPUT) await Bun.write(process.env.TZUDONG_REVIEW_FIXTURE_OUTPUT, built.outputs[0]);
  return built.outputs[0].text();
}

(existsSync(chrome) ? test : test.skip)('real moderation component distinguishes retry states and restores focus only from removed review content', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(reviewEntry);
    for (const width of [1280, 1021, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(`${error.name}:${error.message.slice(0, 120)}:${error.stack?.match(/:(\d+):(\d+)/)?.slice(1).join(':') ?? 'no-line'}`));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://review-errors.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.goto('https://review-errors.test/');
    await page.addScriptTag({ content: script });
    const error = page.locator('[data-admin-moderation-read-error="reviews"]');
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(page.locator('select[aria-label="처리 상태"] option[value="all"]')).toHaveText('전체 상태 (미확인)');
    await playwrightExpect(page.locator('[data-admin-review-row]')).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: '리뷰 검색' });
    await error.getByRole('button', { name: '다시 조회' }).click();
    await playwrightExpect(search).toBeFocused();
    await playwrightExpect(error).toContainText('리뷰 목록을 불러오지 못했습니다.');
    await playwrightExpect(page.locator('[aria-label="리뷰 목록 로딩 중"]')).toHaveCount(0);
    await playwrightExpect(page.getByText('조회된 항목이 없습니다.')).toHaveCount(0);
    await playwrightExpect(page.locator('[data-admin-review-row]')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __reviewFixture: { success(): void } }).__reviewFixture.success());
    await playwrightExpect(page.locator('[data-admin-review-row="review-fixture"]')).toBeVisible();
    await playwrightExpect(error).toHaveCount(0);
    await playwrightExpect(search).toBeFocused();

    await search.focus();
    await page.evaluate(() => (window as unknown as { __reviewFixture: { fail(): void } }).__reviewFixture.fail());
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(search).toBeFocused();

    await page.evaluate(() => (window as unknown as { __reviewFixture: { success(): void } }).__reviewFixture.success());
    const row = page.locator('[data-admin-review-row="review-fixture"] button').first();
    await row.click();
    const detail = page.locator('[data-admin-moderation-inspector="true"]');
    await playwrightExpect(detail).toBeVisible();
    await playwrightExpect(page.locator('[data-admin-moderation-drawer]')).toHaveCount(width < 1280 ? 1 : 0);
    await playwrightExpect(detail).toBeFocused();
    await page.evaluate(() => (window as unknown as { __reviewFixture: { fail(): void } }).__reviewFixture.fail());
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(detail).toHaveCount(0);
    await playwrightExpect(error.getByRole('button', { name: '다시 조회' })).toBeFocused();
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
    }
  } finally {
    await browser.close();
  }
}, 30_000);

(existsSync(chrome) ? test : test.skip)('failed submission source shows a retryable error on its own tabs and keeps the healthy tab readable', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(submissionEntry);
    for (const width of [1280, 1021, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(`${error.name}:${error.message.slice(0, 120)}`));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://submission-errors.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.goto('https://submission-errors.test/');
    await page.addScriptTag({ content: script });
    const fixture = (action: 'fail' | 'success') => page.evaluate(name => (window as unknown as { __submissionFixture: Record<string, () => void> }).__submissionFixture[name](), action);
    const error = page.locator('[data-admin-moderation-read-error="new"]');
    await playwrightExpect(error).toContainText('신규 제보 목록을 불러오지 못했습니다.');
    await playwrightExpect(page.locator('select[aria-label="처리 상태"] option[value="all"]')).toHaveText('전체 상태 (미확인)');
    await playwrightExpect(page.locator('select[aria-label="처리 상태"] option[value="pending"]')).toHaveText('대기 (미확인)');
    await playwrightExpect(page.getByText('조회된 항목이 없습니다.')).toHaveCount(0);
    await playwrightExpect(page.locator('[data-admin-submission-queue-reason-filter]')).toHaveCount(0);
    await playwrightExpect(page.getByLabel('대기 건수 조회 실패')).toHaveCount(2);
    await playwrightExpect(page.getByRole('button', { name: /쯔양 제보/ })).toContainText('1');

    await page.getByRole('button', { name: /쯔양 제보/ }).click();
    await playwrightExpect(page.locator('[data-admin-submission-row="recommend-fixture"]')).toBeVisible();
    await playwrightExpect(page.locator('select[aria-label="처리 상태"] option[value="all"]')).toHaveText('전체 상태 (1)');
    await playwrightExpect(page.locator('[data-admin-moderation-read-error]')).toHaveCount(0);
    await page.getByRole('button', { name: /신규 제보/ }).click();

    const search = page.getByRole('searchbox', { name: '제보 검색' });
    await error.getByRole('button', { name: '다시 조회' }).click();
    await playwrightExpect(search).toBeFocused();
    await playwrightExpect(error).toContainText('신규 제보 목록을 불러오지 못했습니다.');
    await playwrightExpect(page.locator('[aria-label="신규 목록 로딩 중"]')).toHaveCount(0);
    await playwrightExpect(page.getByText('조회된 항목이 없습니다.')).toHaveCount(0);
    await playwrightExpect(page.locator('[aria-live="polite"]')).toContainText('조회 실패');
    await playwrightExpect(page.locator('[aria-live="polite"]')).not.toContainText('조회 중');
    await fixture('success');
    await playwrightExpect(page.locator('[data-admin-submission-row="submission-fixture"]')).toBeVisible();
    await playwrightExpect(error).toHaveCount(0);
    await playwrightExpect(page.getByLabel('대기 건수 조회 실패')).toHaveCount(0);

    await page.locator('[data-admin-submission-row="submission-fixture"] button').first().click();
    const detail = page.locator('[data-admin-moderation-inspector="true"]');
    await playwrightExpect(detail).toBeVisible();
    await playwrightExpect(page.locator('[data-admin-moderation-drawer]')).toHaveCount(width < 1280 ? 1 : 0);
    await fixture('fail');
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(detail).toHaveCount(0);
    await playwrightExpect(page.locator('[data-admin-submission-row]')).toHaveCount(0);
    await playwrightExpect(error.getByRole('button', { name: '다시 조회' })).toBeFocused();
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
    }
  } finally {
    await browser.close();
  }
}, 30_000);
