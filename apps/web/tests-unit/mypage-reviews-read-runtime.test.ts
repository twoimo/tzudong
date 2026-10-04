import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';

// Run the page's actual query function without importing its browser/auth dependencies.
const source = readFileSync(join(import.meta.dir, '../app/mypage/reviews/page.tsx'), 'utf8');
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression: string | undefined;
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'queryFn') {
    expression = node.initializer.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!expression) throw new Error('Missing my-reviews query function');
const compiled = ts.transpileModule(`module.exports = ${expression};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
type Page = { reviews: { id: string }[]; nextCursor: number | null };
type Mode = 'empty' | 'success' | 'returned-error' | 'thrown-error' | 'restaurant-error' | 'canonical-error';

function query(mode: Mode) {
  const review = {
    id: 'fixture-review', restaurant_id: 'fixture-restaurant', title: 'Fixture', content: '',
    visited_at: '2026-10-04', created_at: '2026-10-04T00:00:00Z', is_verified: false,
    admin_note: null, is_pinned: false, is_edited_by_admin: false, food_photos: [], categories: [],
  };
  let restaurantCalls = 0;
  const supabase = {
    from(table: string) {
      const chain = {
        select() { return chain; }, eq() { return chain; }, order() { return chain; },
        range() { return chain; }, in() { return chain; },
        async returns() {
          if (table === 'reviews') {
            if (mode === 'thrown-error') throw new Error('fixture-private-provider-diagnostic');
            if (mode === 'returned-error') return { data: null, error: { message: 'fixture-private-provider-diagnostic' } };
            return { data: mode === 'empty' ? [] : [review], error: null };
          }
          restaurantCalls++;
          if ((mode === 'restaurant-error' && restaurantCalls === 1)
            || (mode === 'canonical-error' && restaurantCalls === 2)) {
            return { data: null, error: { message: 'fixture-private-provider-diagnostic' } };
          }
          return { data: [{ id: 'fixture-restaurant', name: 'Fixture', approved_name: 'Fixture', status: 'approved' }], error: null };
        },
      };
      return chain;
    },
  };
  const exportsHolder = { exports: null as unknown };
  const make = new Function('module', 'user', 'supabase', 'MY_REVIEWS_SELECT', 'PAGE_SIZE',
    'createCanonicalVisitedLookup', 'getRestaurantDisplayName', compiled);
  make(exportsHolder, { id: 'fixture-owner' }, supabase, 'id', 15,
    () => () => null, (restaurant: { name?: string } | null) => restaurant?.name ?? '알 수 없음');
  return () => (exportsHolder.exports as (input: { pageParam: number }) => Promise<Page>)({ pageParam: 0 });
}

describe('my-reviews read status and retry', () => {
  test('a successful empty result stays distinct from a read failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
      expect(await client.fetchQuery({ queryKey: ['fixture'], queryFn: query('empty') }))
        .toEqual({ reviews: [], nextCursor: null });
      expect(client.getQueryState(['fixture'])?.status).toBe('success');
    } finally { client.clear(); }
  });

  for (const mode of ['returned-error', 'thrown-error', 'restaurant-error', 'canonical-error'] as const) {
    test(`${mode} rejects with a fixed error and a retry recovers the saved review`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      try {
        await expect(client.fetchQuery({ queryKey: ['fixture'], queryFn: query(mode) }))
          .rejects.toThrow('MY_REVIEWS_READ_FAILED');
        expect(client.getQueryState(['fixture'])?.status).toBe('error');
        expect(client.getQueryState(['fixture'])?.error?.message).toBe('MY_REVIEWS_READ_FAILED');
        const recovered = await client.fetchQuery({ queryKey: ['fixture'], queryFn: query('success') });
        expect(recovered.reviews.map(row => row.id)).toEqual(['fixture-review']);
        expect(client.getQueryState(['fixture'])?.status).toBe('success');
      } finally { client.clear(); }
    });
  }

  test('a failed refresh keeps prior successful data available rather than replacing it with empty data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
      const before = await client.fetchQuery({ queryKey: ['fixture'], queryFn: query('success') });
      await expect(client.fetchQuery({ queryKey: ['fixture'], queryFn: query('returned-error') }))
        .rejects.toThrow('MY_REVIEWS_READ_FAILED');
      expect(client.getQueryData(['fixture'])).toEqual(before);
      expect(client.getQueryState(['fixture'])?.status).toBe('error');
    } finally { client.clear(); }
  });
});
