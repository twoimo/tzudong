import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { setup, readPersistedReviewDraft } from './setup';

const results: unknown[] = [];
function retain(result: unknown) {
    results.push(result);
    writeFileSync(new URL('../repro-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
}
function checkInitialBlock(s: ReturnType<typeof setup>) {
    expect(s.outcomes.at(-1)).toBe('blocked');
    expect(s.f.counts.uploads).toBe(0); expect(s.f.counts.inserts).toBe(0);
    expect(s.f.counts.reads).toBe(0); expect(s.f.counts.removes).toBe(0);
    expect(s.f.counts.success).toBe(0); expect(s.f.counts.closes).toBe(0);
    expect(s.f.rows.size).toBe(0); expect(s.f.objects.size).toBe(0);
    expect(s.f.counts.ids).toBe(1);
    expect(s.captureErrors.at(-1)).toBe('REVIEW_DRAFT_CAPTURE_FAILED');
}

test.each(['io', 'invalid-stored'])('v4 %s capture failure blocks dispatch; recovery finishes original operation', async kind => {
    const s = setup(); const original = s.row();
    if (kind === 'io') s.failSnapshot(true);
    else s.setRow({ ...original!, savedAt: 'invalid' });
    await s.submit(); checkInitialBlock(s);
    const first = { ...s.f.counts, snapshots: s.events.filter(v => v === 'snapshot').length };
    expect(await s.f.bindings.saveOperationRef.current.clearSavedDraft()).toBe(false);
    s.failSnapshot(false); s.setRow(original);
    await s.submit();
    const final = { ...s.f.counts, snapshots: s.events.filter(v => v === 'snapshot').length,
        deletes: s.events.filter(v => v === 'delete').length, draftPresent: Boolean(s.row()) };
    retain({ case: kind + '-capture-recovery', first, final, outcomes: s.outcomes, captureErrors: s.captureErrors });
    expect(s.outcomes).toEqual(['blocked', 'saved']);
    expect(s.f.counts.ids).toBe(1); expect(s.f.counts.uploads).toBe(2); expect(s.f.counts.inserts).toBe(1);
    expect(s.f.counts.success).toBe(1); expect(s.f.counts.closes).toBe(1);
    expect(final.snapshots).toBe(2); expect(final.deletes).toBe(1); expect(s.row()).toBeUndefined();
});

test('v4 capture retries until first valid snapshot, then unknown-write retry preserves B without recapture', async () => {
    const s = setup(); s.failSnapshot(true);
    await s.submit(); checkInitialBlock(s);
    await s.submit(); checkInitialBlock(s);
    const first = { ...s.f.counts, snapshots: s.events.filter(v => v === 'snapshot').length };
    s.failSnapshot(false); s.f.setMode('lost-read-fails');
    await s.submit();
    expect(s.f.counts.inserts).toBe(1); expect(s.f.counts.uploads).toBe(2);
    expect(s.events.filter(v => v === 'snapshot')).toHaveLength(3);
    expect(await s.f.bindings.saveOperationRef.current.clearSavedDraft()).toBe(false);
    s.replace(); const replacement = s.row();
    expect(readPersistedReviewDraft(replacement)).not.toBeNull();
    s.f.setMode('normal'); await s.submit();
    const final = { ...s.f.counts, snapshots: s.events.filter(v => v === 'snapshot').length,
        deletes: s.events.filter(v => v === 'delete').length,
        replacementUnchanged: JSON.stringify(s.row()) === JSON.stringify(replacement) };
    retain({ case: 'two-capture-failures-then-valid-then-unknown-retry', first, final,
        outcomes: s.outcomes, captureErrors: s.captureErrors, events: s.events });
    expect(s.captureErrors).toEqual(['REVIEW_DRAFT_CAPTURE_FAILED', 'REVIEW_DRAFT_CAPTURE_FAILED']);
    expect(s.outcomes).toEqual(['blocked', 'blocked', 'blocked', 'saved']);
    expect(s.f.counts.ids).toBe(1); expect(final.snapshots).toBe(3);
    expect(s.f.counts.inserts).toBe(1); expect(s.f.counts.uploads).toBe(2);
    expect(final.deletes).toBe(0); expect(s.row()).toEqual(replacement);
    expect(s.f.counts.success).toBe(1); expect(s.f.counts.closes).toBe(1);
});

test('v4 capture recovery followed by replacement during known insert preserves B and closes', async () => {
    const s = setup(); s.failSnapshot(true);
    await s.submit(); checkInitialBlock(s);
    const first = { ...s.f.counts };
    s.failSnapshot(false);
    let replacement: ReturnType<typeof s.row>;
    s.f.onInsert(() => { s.replace(); replacement = s.row(); });
    await s.submit();
    const final = { ...s.f.counts, snapshots: s.events.filter(v => v === 'snapshot').length,
        deletes: s.events.filter(v => v === 'delete').length,
        replacementUnchanged: JSON.stringify(s.row()) === JSON.stringify(replacement) };
    retain({ case: 'capture-recovery-known-commit-preserves-B', first, final, outcomes: s.outcomes });
    expect(s.outcomes).toEqual(['blocked', 'saved']); expect(final.snapshots).toBe(2);
    expect(s.f.counts.ids).toBe(1); expect(s.f.counts.inserts).toBe(1);
    expect(final.deletes).toBe(0); expect(s.row()).toEqual(replacement);
    expect(s.f.counts.success).toBe(1); expect(s.f.counts.closes).toBe(1);
});
