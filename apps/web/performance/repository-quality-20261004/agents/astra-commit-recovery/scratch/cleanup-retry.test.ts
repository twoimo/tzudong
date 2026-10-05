import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fixture, evaluate, nodeText, source } from './fixture';

// Executes the unchanged source handlers/controller/validator/compare-delete.
// Only the IDB transport is replaced by a deterministic map. No browser/auth/network.
const draftSource = readFileSync('/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/lib/reviewDraftDB.ts', 'utf8');
const readPersistedReviewDraft = evaluate(
    draftSource.replace(/^import .* from 'idb';\n/, '') + '\nreadPersistedReviewDraft;', { TextEncoder },
) as (row: unknown) => unknown;
const observations: unknown[] = [];
const output = new URL('../repro-results.json', import.meta.url).pathname;

function setup() {
    const f = fixture();
    const events: string[] = [];
    const now = Date.now() - 2000;
    let row: Record<string, unknown> | undefined = {
        userId: 'fixture-owner', restaurantId: 'fixture-restaurant', currentStep: 3,
        visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'],
        content: f.bindings.content, savedAt: new Date(now).toISOString(), expiresAt: now + 86400000,
    };
    let failSnapshot = false;
    let failDelete = false;
    const clone = () => row && structuredClone(row);
    const db = {
        get: async () => {
            events.push('snapshot');
            if (failSnapshot) throw Error('synthetic snapshot failure');
            return clone();
        },
        transaction: () => ({
            store: {
                get: async () => { events.push('compare'); return clone(); },
                delete: async () => {
                    events.push('delete');
                    if (failDelete) throw Error('synthetic delete failure');
                    row = undefined;
                },
            },
            done: Promise.resolve(),
        }),
        close() {},
    };
    const prepare = evaluate(nodeText(draftSource, 'prepareDraftDeletion') + '\nprepareDraftDeletion;', {
        initDB: async () => db, STORE_NAME: 'review-drafts', readPersistedReviewDraft,
        isValidIdentifier: (v: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v),
    });
    f.bindings.prepareDraftDeletion = prepare as typeof f.bindings.prepareDraftDeletion;
    f.bindings.clearDraft = evaluate(nodeText(source, 'clearDraft') + ';', {
        ...f.bindings, useCallback: (fn: unknown) => fn, setLastSavedAt() {},
    }) as () => Promise<boolean>;
    const submit = evaluate(nodeText(source, 'handleSubmit') + ';', f.bindings) as () => Promise<void>;
    return {
        f, submit, events,
        row: () => clone(),
        replace() {
            row = { ...row!, content: 'Newer independent composer text, never submitted.',
                savedAt: new Date(now + 1000).toISOString(), expiresAt: now + 86401000 };
            events.push('new-composer-autosave');
        },
        failSnapshot(value: boolean) { failSnapshot = value; },
        failDelete(value: boolean) { failDelete = value; },
    };
}

test('P2 regression: retry must preserve newer draft rejected by the first compare/delete', async () => {
    const s = setup();
    s.f.onInsert(() => { s.events.push('insert-known-success'); s.replace(); });
    await s.submit();
    expect(s.row()?.content).toBe('Newer independent composer text, never submitted.');
    expect(s.f.recoveryStates).toEqual(['draft-cleanup']);
    s.events.push('retry-same-mounted-submitted-inputs');
    await s.submit();
    const result = { case: 'retry-newer-draft', events: s.events, inserts: s.f.counts.inserts,
        uploads: s.f.counts.uploads, deletes: s.events.filter(v => v === 'delete').length,
        newerDraftSurvives: Boolean(s.row()), recoveryStates: s.f.recoveryStates };
    observations.push(result); writeFileSync(output, JSON.stringify(observations, null, 2) + '\n');
    expect(s.f.counts.inserts).toBe(1);
    expect(s.row()?.content).toBe('Newer independent composer text, never submitted.');
});

test.each(['unmounted', 'owner-change'])('control: known success after %s clears snapshot and preserves objects', async state => {
    const s = setup();
    s.f.onInsert(() => {
        s.f.bindings.saveOwnerRef.current = state === 'unmounted' ? undefined as unknown as string : 'other-owner';
        s.f.bindings.composerOpenRef.current = false;
    });
    await s.submit();
    expect(s.row()).toBeUndefined(); expect(s.f.counts.inserts).toBe(1);
    expect(s.f.counts.success).toBe(0); expect(s.f.counts.closes).toBe(0);
    expect(s.f.counts.removes).toBe(0); expect(s.f.objects.size).toBe(2);
});

test('control: newer draft is protected when the original insert finishes after unmount', async () => {
    const s = setup();
    s.f.onInsert(() => {
        s.f.bindings.saveOwnerRef.current = undefined as unknown as string;
        s.replace();
    });
    await s.submit();
    expect(s.row()?.content).toBe('Newer independent composer text, never submitted.');
    expect(s.events.includes('delete')).toBe(false);
});

test('control: unanswered commit after unmount preserves draft and uploaded photos', async () => {
    const s = setup(); s.f.setMode('lost-read-fails');
    s.f.onInsert(() => { s.f.bindings.saveOwnerRef.current = undefined as unknown as string; });
    await s.submit();
    expect(s.row()).toBeDefined(); expect(s.events.includes('delete')).toBe(false);
    expect(s.f.counts.removes).toBe(0); expect(s.f.objects.size).toBe(2);
});

test('control: failed snapshot does not authorize draft deletion after known commit', async () => {
    const s = setup(); s.failSnapshot(true);
    await s.submit();
    expect(s.f.counts.inserts).toBe(1); expect(s.row()).toBeDefined();
    expect(s.f.recoveryStates).toEqual(['draft-cleanup']);
});

test('control: delete failure can retry without a second insert', async () => {
    const s = setup(); s.failDelete(true);
    await s.submit(); expect(s.row()).toBeDefined();
    s.failDelete(false); await s.submit();
    expect(s.row()).toBeUndefined(); expect(s.f.counts.inserts).toBe(1);
});
