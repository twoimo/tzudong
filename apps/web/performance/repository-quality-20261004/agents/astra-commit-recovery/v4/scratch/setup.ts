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
    const captureErrors: string[] = [];
    const outcomes: string[] = [];
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
    f.setPrepareDeletion(async () => {
        try { return await (prepare as (owner: string, restaurant: string) => Promise<() => Promise<boolean>>)('fixture-owner', 'fixture-restaurant'); }
        catch (error) { captureErrors.push((error as Error).message); throw error; }
    });
    const originalSubmit = f.bindings.saveOperationRef.current.submit.bind(f.bindings.saveOperationRef.current);
    f.bindings.saveOperationRef.current.submit = async draft => { const result = await originalSubmit(draft); outcomes.push(result); return result; };
    f.bindings.clearDraft = evaluate(nodeText(source, 'clearDraft') + ';', {
        ...f.bindings, useCallback: (fn: unknown) => fn, setLastSavedAt() {},
    }) as () => Promise<boolean>;
    f.bindings.handleClose = f.close();
    const submit = evaluate(nodeText(source, 'handleSubmit') + ';', f.bindings) as () => Promise<void>;
    return {
        f, submit, events, captureErrors, outcomes,
        prepare: () => (prepare as (a: string, b: string) => Promise<() => Promise<boolean>>)('fixture-owner', 'fixture-restaurant'),
        row: () => clone(),
        setRow(value: Record<string, unknown> | undefined) { row = value && structuredClone(value); },
        rewriteOwnAutosave() {
            const savedNow = Date.now();
            row = { ...row!, savedAt: new Date(savedNow).toISOString(), expiresAt: savedNow + 86400000 };
            events.push('same-input-autosave-new-timestamp');
        },
        replace() {
            row = { ...row!, content: 'Newer independent composer text, never submitted.',
                savedAt: new Date(now + 1000).toISOString(), expiresAt: now + 86401000 };
            events.push('new-composer-autosave');
        },
        failSnapshot(value: boolean) { failSnapshot = value; },
        failDelete(value: boolean) { failDelete = value; },
    };
}


export { setup, readPersistedReviewDraft };
