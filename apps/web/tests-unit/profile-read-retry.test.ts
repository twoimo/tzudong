import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Row = Record<string, unknown>;
type Reply = { data: Row[] | null; error: { code: string } | null };
type Query = { queryFn(): Promise<unknown> };
function hooks(reply: (table: string, select: string) => Reply) {
  const supabase = { from(table: string) {
    let select = '';
    const q = { select(value: string) { select = value; return q; }, eq() { return q; }, in() { return q; }, order() { return q; },
      then(resolve: (value: Reply) => unknown) { return Promise.resolve(reply(table, select)).then(resolve); } };
    return q;
  } };
  const exports: Record<string, (...args: string[]) => Query> = {};
  const code = ts.transpileModule(readFileSync(join(import.meta.dir, '../hooks/useUserProfile.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, Promise, Map, Set, Error, require(name: string) {
    if (name === '@tanstack/react-query') return { useQuery: (options: Query) => options };
    if (name === '@/integrations/supabase/client') return { supabase };
    if (name === '@/lib/restaurant-display-name') return { withRestaurantDisplayName: (row: Row) => row };
    if (name === '@/lib/restaurant-visit-matching') return { createCanonicalVisitedLookup: () => () => null };
    if (name === '@/lib/public-profile-read') return { readPublicProfileSummaries: async () => [] };
    throw new Error('UNEXPECTED_IMPORT');
  } });
  return exports;
}
const ok = (data: Row[] = []): Reply => ({ data, error: null });
const failed = (): Reply => ({ data: null, error: { code: 'SYNTHETIC_UNAVAILABLE' } });
describe('profile activity query failures are retryable errors rather than empty successes', () => {
  for (const name of ['useUserStamps', 'useUserReviews', 'useUserLikers']) {
    test(name + ' rejects review lookup failure and accepts a real empty response', async () => {
      let fail = true;
      const api = hooks(() => fail ? failed() : ok());
      await expect(api[name]('owner', 'viewer').queryFn()).rejects.toThrow('USER_PROFILE_REVIEWS_UNAVAILABLE');
      fail = false; expect(await api[name]('owner', 'viewer').queryFn()).toEqual([]);
    });
  }
  test.each(['useUserReviews', 'useUserStamps'])('%s rejects restaurant lookup failures', async name => {
    const api = hooks(table => table === 'reviews' ? ok([{ id: 'review', restaurant_id: 'restaurant' }]) : table === 'restaurants' ? failed() : ok());
    await expect(api[name]('owner', 'viewer').queryFn()).rejects.toThrow('USER_PROFILE_RESTAURANTS_UNAVAILABLE');
  });
  test.each(['useUserReviews', 'useUserLikers'])('%s rejects likes lookup failures', async name => {
    const api = hooks(table => table === 'reviews' ? ok([{ id: 'review', restaurant_id: 'restaurant' }]) : table === 'review_likes' ? failed() : ok());
    await expect(api[name]('owner', 'viewer').queryFn()).rejects.toThrow(/USER_PROFILE_LIKE/);
  });
  test.each(['useUserReviews', 'useUserStamps'])('%s rejects canonical restaurant lookup failures', async name => {
    let restaurantReads = 0;
    const api = hooks(table => table === 'reviews' ? ok([{ id: 'review', restaurant_id: 'restaurant' }]) : table === 'restaurants' ? (++restaurantReads === 1 ? ok([{ id: 'restaurant', approved_name: '합성 식당', status: 'approved' }]) : failed()) : ok());
    await expect(api[name]('owner', 'viewer').queryFn()).rejects.toThrow('USER_PROFILE_RESTAURANTS_UNAVAILABLE');
  });
});
