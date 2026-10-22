import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

mock.module('@/integrations/supabase/client', () => ({ supabase: {} }));

const source = readFileSync(join(import.meta.dir, '../app/admin/evaluations/page.tsx'), 'utf8');
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findQueryFn(name: string): string {
  let queryFn: ts.ArrowFunction | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name
      && node.initializer && ts.isCallExpression(node.initializer)) {
      const options = node.initializer.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(item => ts.isPropertyAssignment(item)
          && item.name.getText(tree) === 'queryFn');
        if (property && ts.isPropertyAssignment(property) && ts.isArrowFunction(property.initializer)) {
          queryFn = property.initializer;
        }
      }
    }
    if (!queryFn) ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!queryFn) throw new Error(`QUERY_BOUNDARY_MISSING:${name}`);
  return new Bun.Transpiler({ loader: 'tsx' }).transformSync(`const queryFn = ${(queryFn as ts.ArrowFunction).getText(tree)};`);
}
const reviewQueryFn = findQueryFn('reviewsQuery');
const submissionQueryFn = findQueryFn('submissionsQuery');

type QueryResult = { data: unknown; error: unknown };
const syntheticReview = {
  id: 'review-fixture', user_id: 'user-fixture', restaurant_id: 'restaurant-fixture',
  title: '합성 리뷰', content: '합성 검수 내용', visited_at: '2026-10-01T00:00:00Z',
  verification_photo: 'fixture-path', food_photos: [], categories: [], is_verified: false,
  admin_note: null, is_pinned: false, is_edited_by_admin: false,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
const syntheticRestaurant = { id: 'restaurant-fixture', approved_name: '합성 식당', road_address: null, jibun_address: null };

function reviewQuery(results: { reviews: QueryResult; restaurants: QueryResult }) {
  const calls: string[] = [];
  const chain = (result: QueryResult) => ({
    select() { return this; }, eq() { return this; }, order() { return this; }, in() { return this; },
    overrideTypes() { return Promise.resolve(result); },
  });
  const dependencies = {
    user: { id: 'admin-fixture' }, isAdmin: true, ADMIN_REVIEW_SELECT: '',
    supabase: { from(table: string) { calls.push(table); return chain(table === 'reviews' ? results.reviews : results.restaurants); } },
    parseReview: (row: unknown) => row,
    parseValidatedRows: (rows: unknown) => rows,
    isReviewRestaurantRow: () => true,
    fetchAdminProfileSummariesLookup: async () => ({ summaries: {}, ok: true }),
    resolveAdminReviewerDisplay: () => ({ nickname: '합성 작성자' }),
  };
  const fn = new Function('dependencies', `const { user, isAdmin, ADMIN_REVIEW_SELECT, supabase, parseReview, parseValidatedRows, isReviewRestaurantRow, fetchAdminProfileSummariesLookup, resolveAdminReviewerDisplay } = dependencies; ${reviewQueryFn} return queryFn;`)(dependencies) as () => Promise<Array<{ restaurants: { name: string } }>>;
  return { run: fn, calls };
}

test('review query keeps a genuine empty read distinct from failed restaurant enrichment', async () => {
  const empty = reviewQuery({ reviews: { data: [], error: null }, restaurants: { data: null, error: null } });
  expect(await empty.run()).toEqual([]);
  expect(empty.calls).toEqual(['reviews']);

  const valid = reviewQuery({ reviews: { data: [syntheticReview], error: null }, restaurants: { data: [syntheticRestaurant], error: null } });
  expect((await valid.run())[0].restaurants.name).toBe('합성 식당');
  expect(valid.calls).toEqual(['reviews', 'restaurants']);

  const removed = reviewQuery({ reviews: { data: [syntheticReview], error: null }, restaurants: { data: [], error: null } });
  expect((await removed.run())[0].restaurants.name).toBe('삭제된 맛집');
  expect(removed.calls).toEqual(['reviews', 'restaurants']);

  const failed = reviewQuery({ reviews: { data: [syntheticReview], error: null }, restaurants: { data: null, error: { message: 'provider detail' } } });
  await expect(failed.run()).rejects.toThrow('admin-review-read-failed');
});

test('primary review transport error has a fixed client boundary', async () => {
  const failed = reviewQuery({ reviews: { data: null, error: { message: 'provider detail' } }, restaurants: { data: null, error: null } });
  await expect(failed.run()).rejects.toThrow('admin-review-read-failed');
  expect(failed.calls).toEqual(['reviews']);
  const malformed = reviewQuery({ reviews: { data: null, error: null }, restaurants: { data: null, error: null } });
  await expect(malformed.run()).rejects.toThrow('admin-review-read-failed');
  expect(malformed.calls).toEqual(['reviews']);
});

function submissionQuery(items: QueryResult) {
  const submission = { id: 'submission-fixture', user_id: 'user-fixture', submission_type: 'new', status: 'pending', restaurant_name: '합성 신규 식당' };
  const chain = { select() { return this; }, in() { return this; }, order() { return this; }, overrideTypes: () => Promise.resolve(items) };
  const dependencies = {
    user: { id: 'admin-fixture' }, isAdmin: true, ADMIN_SUBMISSION_ITEM_SELECT: '',
    fetch: async () => new Response(JSON.stringify({ submissions: [submission] }), { status: 200 }),
    supabase: { from(table: string) { if (table !== 'restaurant_submission_items') throw new Error(`UNEXPECTED_TABLE:${table}`); return chain; } },
    parseValidatedRows: (rows: unknown) => rows,
    isSubmissionRow: () => true, isSubmissionItem: () => true, isRestaurantLookupRow: () => true,
    fetchAdminProfileSummariesLookup: async () => ({ summaries: {}, ok: true }),
    resolveAdminReviewerDisplay: () => ({ nickname: '합성 제보자' }),
  };
  return new Function('dependencies', `const { user, isAdmin, ADMIN_SUBMISSION_ITEM_SELECT, fetch, supabase, parseValidatedRows, isSubmissionRow, isSubmissionItem, isRestaurantLookupRow, fetchAdminProfileSummariesLookup, resolveAdminReviewerDisplay } = dependencies; ${submissionQueryFn} return queryFn;`)(dependencies) as () => Promise<Array<{ items: unknown[] }>>;
}

test('submission query fails closed when its item read fails instead of returning item-less submissions', async () => {
  const item = { id: 'item-fixture', submission_id: 'submission-fixture', youtube_link: '', tzuyang_review: '', target_restaurant_id: null, item_status: 'pending', created_at: '2026-10-01T00:00:00Z' };
  expect((await submissionQuery({ data: [item], error: null })())[0].items).toHaveLength(1);
  expect((await submissionQuery({ data: [], error: null })())[0].items).toEqual([]);
  await expect(submissionQuery({ data: null, error: { message: 'provider detail' } })()).rejects.toThrow('admin-submission-items-failed');
  await expect(submissionQuery({ data: null, error: null })()).rejects.toThrow('admin-submission-items-failed');
});

test('moderation list renders loading, error and genuine empty review states separately', async () => {
  const { SubmissionListView } = await import('../components/admin/SubmissionListView');
  const base = {
    submissions: [], reviews: [], initialTab: 'reviews' as const,
    onApprove() {}, onReject() {}, onDelete() {},
  };
  const render = (changes: Record<string, unknown>) => renderToStaticMarkup(createElement(SubmissionListView, { ...base, ...changes }));
  const loading = render({ reviewsLoading: true });
  expect(loading).toContain('리뷰 목록 로딩 중');
  expect(loading).not.toContain('조회된 항목이 없습니다.');
  const empty = render({});
  expect(empty).toContain('조회된 항목이 없습니다.');
  expect(empty).toContain('전체 상태 (0)');
  const row = { ...syntheticReview, category: '한식', profiles: { nickname: '합성 작성자' },
    restaurants: { name: '합성 식당', address: '' } };
  const success = render({ reviews: [row] });
  expect(success).toContain('data-admin-review-row="review-fixture"');
  expect(success).toContain('합성 식당');
  expect(success).not.toContain('조회된 항목이 없습니다.');
  const failed = render({ reviews: [row], reviewsError: true, onRetryReviews() {} });
  expect(failed).toContain('리뷰 목록을 불러오지 못했습니다.');
  expect(failed).toContain('다시 조회');
  expect(failed).toContain('전체 상태 (미확인)');
  expect(failed).toContain('대기 (미확인)');
  expect(failed).not.toContain('전체 상태 (0)');
  expect(failed).not.toContain('전체 상태 (1)');
  expect(failed).not.toContain('조회된 항목이 없습니다.');
  expect(failed).not.toContain('data-admin-review-row="review-fixture"');
  const retrying = render({ reviewsLoading: true, reviewsError: true, onRetryReviews() {} });
  expect(retrying).toContain('리뷰 목록을 불러오지 못했습니다.');
  expect(retrying).not.toContain('리뷰 목록 로딩 중');
  expect(retrying).not.toContain('조회된 항목이 없습니다.');
});
