import { describe, expect, test } from 'bun:test';

import { createLatestSelection } from '@/lib/ocr/latest-selection';

describe('latest async file selection', () => {
  test('aborts and rejects a deferred older completion after replacement begins', async () => {
    const selection = createLatestSelection();
    const committed: string[] = [];
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstPrepared = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const secondPrepared = new Promise<string>((resolve) => { resolveSecond = resolve; });
    const first = selection.begin();
    const firstCommit = firstPrepared.then((value) => {
      if (first.isCurrent()) committed.push(value);
      first.complete();
    });
    const second = selection.begin();
    const secondCommit = secondPrepared.then((value) => {
      if (second.isCurrent()) committed.push(value);
      second.complete();
    });

    expect(first.signal.aborted).toBe(true);
    resolveSecond('new-receipt');
    resolveFirst('stale-receipt');
    await Promise.all([firstCommit, secondCommit]);

    expect(selection.isCurrent(first.generation)).toBe(false);
    expect(selection.isCurrent(second.generation)).toBe(true);
    expect(committed).toEqual(['new-receipt']);
  });

  test('removal, close and unmount invalidate deferred preparation', async () => {
    for (const boundary of ['removal', 'close', 'unmount']) {
      const selection = createLatestSelection();
      const committed: string[] = [];
      let resolvePrepared!: (value: string) => void;
      const prepared = new Promise<string>((resolve) => { resolvePrepared = resolve; });
      const pending = selection.begin();
      const commit = prepared.then((value) => {
        if (pending.isCurrent()) committed.push(value);
        pending.complete();
      });

      selection.invalidate();
      resolvePrepared(`${boundary}-receipt`);
      await commit;

      expect(pending.signal.aborted).toBe(true);
      expect(selection.isCurrent(pending.generation)).toBe(false);
      expect(committed).toEqual([]);
    }
  });
});
