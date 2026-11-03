import { describe, expect, test } from 'bun:test';
import { isReviewAutomationCoverage, readReviewAutomationCoverage } from '@/lib/admin/review-automation-coverage';
import { parseReviewAutomationSnapshot } from '@/lib/admin/restaurant-review-automation';

const at = '2026-10-25T02:14:36.13876+00:00';
const source = () => ({
  count: async (status: 'pending' | 'hold') => ({ count: status === 'pending' ? 0 : 14, error: null }),
  latest: async () => ({ data: { created_at: at }, error: null }),
});
const snapshot = { policy: { version: 2, enabled: true, batch_size: 50, daily_limit: 50, last_run_at: null }, runs: [], items: [], queue: { queued: 0, running: 0, failed: 1 } };

describe('review coverage does not confuse an enabled policy with healthy intake', () => {
  test('retains held backlog and input timestamp when the pending queue is empty', async () => {
    expect(await readReviewAutomationCoverage(source())).toEqual({ state: 'available', pendingRows: 0, heldRows: 14, latestInputAt: at });
  });

  test('confirmed empty storage is distinct from unavailable metadata', async () => {
    const empty = await readReviewAutomationCoverage({ count: async () => ({ count: 0, error: null }), latest: async () => ({ data: null, error: null }) });
    expect(empty).toEqual({ state: 'available', pendingRows: 0, heldRows: 0, latestInputAt: null });
    expect(await readReviewAutomationCoverage({ ...source(), count: async () => ({ count: null, error: null }) })).toEqual({ state: 'unavailable' });
  });

  test('one failed count cannot turn the held backlog into zero', async () => {
    const result = await readReviewAutomationCoverage({ ...source(), count: async status => status === 'hold' ? { count: null, error: { message: 'private-provider-diagnostic' } } : { count: 0, error: null } });
    expect(result).toEqual({ state: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private-provider');
  });

  test('latest-input failure and rejected reads remain unavailable without retry', async () => {
    expect(await readReviewAutomationCoverage({ ...source(), latest: async () => ({ data: null, error: { code: 'private-error' } }) })).toEqual({ state: 'unavailable' });
    let attempts = 0;
    expect(await readReviewAutomationCoverage({ ...source(), latest: async () => { attempts++; throw new Error('private-error'); } })).toEqual({ state: 'unavailable' });
    expect(attempts).toBe(1);
  });

  test.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid count %s', async count => {
    expect(await readReviewAutomationCoverage({ ...source(), count: async () => ({ count, error: null }) })).toEqual({ state: 'unavailable' });
  });

  test('a malformed existing row never becomes a claim that no input exists', async () => {
    for (const created_at of [undefined, null, '', 'not-a-time']) {
      expect(await readReviewAutomationCoverage({ ...source(), latest: async () => ({ data: { created_at }, error: null }) })).toEqual({ state: 'unavailable' });
    }
  });

  test('validates the optional response extension while retaining older responses', () => {
    expect(parseReviewAutomationSnapshot(snapshot)).toEqual(snapshot);
    const coverage = { state: 'available', pendingRows: 0, heldRows: 14, latestInputAt: at };
    expect(parseReviewAutomationSnapshot({ ...snapshot, coverage }).coverage).toEqual(coverage);
    expect(parseReviewAutomationSnapshot({ ...snapshot, coverage: { state: 'unavailable' } }).coverage).toEqual({ state: 'unavailable' });
    expect(() => parseReviewAutomationSnapshot({ ...snapshot, coverage: { ...coverage, heldRows: null } })).toThrow();
    expect(isReviewAutomationCoverage({ state: 'unavailable', heldRows: 0 })).toBe(false);
    expect(isReviewAutomationCoverage({ ...coverage, inferredCollectorHealthy: true })).toBe(false);
  });
});
