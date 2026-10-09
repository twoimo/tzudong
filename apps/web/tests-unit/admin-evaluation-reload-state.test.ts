import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/admin/evaluations/page.tsx', import.meta.url), 'utf8');
// Execute the actual paged branch, keeping the callback's epoch/abort/error logic.
const start = source.indexOf('  const loadAllRecords = useCallback(async () => {');
const end = source.indexOf('\n    try {\n      setLoading(true);', start + 1);
if (start < 0 || end < 0) throw new Error('PAGED_RELOAD_BRANCH_NOT_FOUND');
const body = source.slice(start + '  const loadAllRecords = useCallback(async () => {'.length, end)
  .replace('(record): record is EvaluationRecord =>', '(record) =>');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

type Page = { records: Array<{ id: string }>; warnings: Record<string, unknown>; revision: string; stats: Record<string, number>; filteredTotal: number; nextCursor: string | null };
const page = (id: string, revision: string): Page => ({ records: [{ id }], warnings: { [id]: { marker: revision } }, revision,
  stats: { total: 9, pending: 8, approved: 1, deleted: 0 }, filteredTotal: 8, nextCursor: 'next-' + revision });
function harness(fetcher: (...args: unknown[]) => Promise<Page>) {
  const state: Record<string, unknown> = { allRecords: [{ id: 'old' }], displayedRecords: [{ id: 'old' }], warnings: { old: {} },
    stats: { total: 999 }, total: 999, hasMore: true, loading: false, readError: false, slide: 4 };
  const refs = { pageEpochRef: { current: 0 }, pageAbortRef: { current: null as AbortController | null }, loadingMoreRef: { current: false },
    nextCursorRef: { current: 'old-cursor' as string | null }, pageRevisionRef: { current: 'old-revision' as string | null },
    detailRequestsRef: { current: new Map([['old', {}]]) }, hasMoreRef: { current: true } };
  const notices: unknown[] = [];
  const deps = { ...refs, legacyEvaluationLoad: false, evaluationPageQuery: 'search=current', fetchAdminEvaluationPage: fetcher,
    normalizeEvaluationRecord: (row: unknown) => row, withAdminEvaluationDisplayName: (row: unknown) => row,
    toast: (notice: unknown) => notices.push(notice),
    setLoadingMore: (v: unknown) => { state.loadingMore = v; }, setLoading: (v: unknown) => { state.loading = v; },
    setPageReadError: (v: unknown) => { state.readError = v; }, setAllRecords: (v: unknown) => { state.allRecords = v; },
    setDisplayedRecords: (v: unknown) => { state.displayedRecords = v; }, setPageWarnings: (v: unknown) => { state.warnings = v; },
    setServerFilteredTotal: (v: unknown) => { state.total = v; }, setStats: (v: unknown) => { state.stats = v; },
    setHasMore: (v: unknown) => { state.hasMore = v; }, setCurrentSlideIndex: (v: unknown) => { state.slide = v; } };
  const run = new AsyncFunction('deps', `const {${Object.keys(deps).join(',')}} = deps; ${body}`);
  return { state, refs, notices, reload: () => run(deps) as Promise<void> };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('evaluation reload publication boundary', () => {
  test('clears old totals, warnings, revision, cursors and detail requests before a new request completes', async () => {
    const work = deferred<Page>(); const h = harness(() => work.promise); const pending = h.reload();
    expect(h.state.allRecords).toEqual([]); expect(h.state.displayedRecords).toEqual([]); expect(h.state.warnings).toEqual({});
    expect(h.state.total).toBe(0); expect(Object.values(h.state.stats as object).every(value => value === 0)).toBe(true);
    expect(h.refs.pageRevisionRef.current).toBeNull(); expect(h.refs.nextCursorRef.current).toBeNull();
    expect(h.refs.detailRequestsRef.current.size).toBe(0); expect(h.state.slide).toBe(0); expect(h.state.loading).toBe(true);
    work.resolve(page('fresh', '2')); await pending;
    expect(h.state.allRecords).toEqual([{ id: 'fresh' }]); expect(h.state.total).toBe(8); expect(h.refs.pageRevisionRef.current).toBe('2');
    expect(h.state.loading).toBe(false); expect(h.state.readError).toBe(false);
  });
  test('a failed reload cannot leave an old revision or statistics published and a retry only publishes fresh data', async () => {
    let attempts = 0; const h = harness(async () => { if (++attempts === 1) throw new Error('synthetic failure'); return page('retry', '3'); });
    await h.reload(); expect(h.state.readError).toBe(true); expect(h.state.total).toBe(0); expect(h.state.warnings).toEqual({});
    expect(h.refs.pageRevisionRef.current).toBeNull(); expect(h.refs.nextCursorRef.current).toBeNull(); expect(h.state.hasMore).toBe(false);
    expect(h.notices.length).toBe(1); await h.reload(); expect(h.state.readError).toBe(false); expect(h.state.allRecords).toEqual([{ id: 'retry' }]);
    expect(h.refs.pageRevisionRef.current).toBe('3'); expect(h.state.total).toBe(8);
  });
  test('late success and late failure from the previous epoch cannot restore or clear the new page', async () => {
    for (const lateFailure of [false, true]) {
      const first = deferred<Page>(); let calls = 0; const h = harness(() => ++calls === 1 ? first.promise : Promise.resolve(page('latest', '9')));
      const old = h.reload(); const signal = h.refs.pageAbortRef.current!.signal; await h.reload(); expect(signal.aborted).toBe(true);
      if (lateFailure) first.reject(new Error('old failed')); else first.resolve(page('obsolete', '1'));
      await old; expect(h.state.allRecords).toEqual([{ id: 'latest' }]); expect(h.refs.pageRevisionRef.current).toBe('9');
      expect(h.state.total).toBe(8); expect(h.state.readError).toBe(false); expect(h.state.loading).toBe(false); expect(h.notices.length).toBe(0);
    }
  });
});
