import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
const source = readFileSync(new URL('../app/admin/evaluations/page.tsx', import.meta.url), 'utf8');
const begin = source.indexOf('  const invalidateRecordViews =');
const end = source.indexOf('  useEffect(() => {', begin);
const code = source.slice(begin, end);
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const queryClient = new QueryClient();
  const keys = ['admin-submissions-inline', 'admin-restaurant-requests-inline', 'admin-reviews-inline', 'admin-pending-counts', 'admin-shared-pending-counts'];
  for (const key of keys) queryClient.setQueryData([key, 'actor'], [{ id: 'old' }]);
  const state: Record<string, unknown> = {};
  const refs = { recordViewsFenceRef: { current: false }, recordViewsEpochRef: { current: 0 }, recordViewsRefreshRef: { current: null as null | { epoch: number; promise: Promise<void> } }, pageEpochRef: { current: 0 }, pageAbortRef: { current: new AbortController() }, nextCursorRef: { current: 'old' as string | null }, pageRevisionRef: { current: 'old' as string | null }, detailRequestsRef: { current: new Map([['old', {}]]) }, loadingMoreRef: { current: true }, hasMoreRef: { current: true } };
  const reads: Array<() => Promise<void>> = Array.from({ length: 5 }, () => async () => {}); let readCount = 0;
  const deps: Record<string, unknown> = { ...refs, queryClient, ADMIN_SHARED_PENDING_COUNTS_QUERY_KEY: [keys[4]], legacyEvaluationLoad: false, useCallback: (fn: unknown) => fn,
    loadAllRecords: async () => { readCount++; const epoch = refs.pageEpochRef.current; await reads[4](); if (epoch === refs.pageEpochRef.current) refs.pageRevisionRef.current = 'fresh'; },
  };
  for (const [i, name] of ['submissionsQuery', 'recommendationRequestsQuery', 'reviewsQuery', 'pendingCountsQuery'].entries()) deps[name] = { refetch: async (options: { throwOnError: boolean }) => { expect(options.throwOnError).toBe(true); readCount++; await reads[i](); } };
  for (const name of ['AllRecords', 'DisplayedRecords', 'PageWarnings', 'ServerFilteredTotal', 'HasMore', 'LoadingMore', 'Loading', 'CurrentSlideIndex', 'PageReadError', 'RecordViewsInvalidated', 'Stats', 'RecordViewsRefreshing']) { state[name] = 'old'; deps[`set${name}`] = (value: unknown) => { state[name] = value; }; }
  const compiled = new Bun.Transpiler({ loader: 'tsx' }).transformSync(`const {${Object.keys(deps).join(',')}}=deps; ${code};return {invalidateRecordViews,refreshRecordViews};`);
  const actions = new Function('deps', compiled)(deps) as { invalidateRecordViews: () => void; refreshRecordViews: () => Promise<void> };
  return { ...actions, state, refs, reads, queryClient, keys, readCount: () => readCount };
}
describe('actual page record read publication fence', () => {
  test('invalidating removes all background models, statistics, warnings, revision and pending query cache; aborts in-flight page work', () => {
    const h = harness(); const signal = h.refs.pageAbortRef.current.signal;
    h.invalidateRecordViews();
    for (const name of ['AllRecords', 'DisplayedRecords']) expect(h.state[name]).toEqual([]);
    expect(h.state.PageWarnings).toEqual({}); expect(h.state.ServerFilteredTotal).toBe(0);
    expect(Object.values(h.state.Stats as object).every(value => value === 0)).toBe(true);
    expect(h.state.RecordViewsInvalidated).toBe(true); expect(h.state.PageReadError).toBe(true); expect(h.refs.recordViewsFenceRef.current).toBe(true);
    expect(h.refs.pageRevisionRef.current).toBeNull(); expect(h.refs.nextCursorRef.current).toBeNull(); expect(h.refs.detailRequestsRef.current.size).toBe(0); expect(signal.aborted).toBe(true);
    for (const key of h.keys) expect(h.queryClient.getQueryData([key, 'actor'])).toBeUndefined();
    h.queryClient.clear();
  });
  test('same-epoch refresh is deduplicated and cannot reveal data until all five fresh reads succeed', async () => {
    const h = harness(), last = deferred(); h.reads[2] = () => last.promise; h.invalidateRecordViews();
    const first = h.refreshRecordViews(); expect(h.refreshRecordViews()).toBe(first); await Bun.sleep(1);
    expect(h.readCount()).toBe(5); expect(h.state.RecordViewsInvalidated).toBe(true);
    last.resolve(); await first; expect(h.state.RecordViewsInvalidated).toBe(false); expect(h.refs.recordViewsFenceRef.current).toBe(false); expect(h.refs.pageRevisionRef.current).toBe('fresh'); expect(h.state.RecordViewsRefreshing).toBe(false); h.queryClient.clear();
  });
  test('a partial or failed fresh read clears all models again and only a successful retry opens the fence', async () => {
    const h = harness(); h.invalidateRecordViews(); h.reads[1] = async () => { throw Error('synthetic failure'); };
    await h.refreshRecordViews(); expect(h.state.RecordViewsInvalidated).toBe(true); expect(h.refs.pageRevisionRef.current).toBeNull(); expect(h.state.PageWarnings).toEqual({}); expect(h.state.ServerFilteredTotal).toBe(0);
    h.reads[1] = async () => {}; await h.refreshRecordViews(); expect(h.state.RecordViewsInvalidated).toBe(false); expect(h.refs.pageRevisionRef.current).toBe('fresh'); h.queryClient.clear();
  });
  test('invalidation during a fresh read prevents late results from reopening the new fence', async () => {
    const h = harness(), waiting = deferred(); h.reads[4] = () => waiting.promise; h.invalidateRecordViews(); const pending = h.refreshRecordViews();
    h.invalidateRecordViews(); waiting.resolve(); await pending;
    expect(h.state.RecordViewsInvalidated).toBe(true); expect(h.refs.pageRevisionRef.current).toBeNull(); expect(h.refs.recordViewsFenceRef.current).toBe(true); h.queryClient.clear();
  });
});
