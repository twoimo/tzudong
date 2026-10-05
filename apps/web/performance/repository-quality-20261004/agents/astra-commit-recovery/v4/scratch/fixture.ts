import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/node_modules/typescript/lib/typescript.js';
import * as jsxRuntime from '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/node_modules/react/jsx-runtime.js';
import { renderToStaticMarkup } from '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/node_modules/react-dom/server.js';
import type { ReactNode } from 'react';
import { ReviewSaveOperation } from '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/lib/reviews/review-save-operation';
import { buildReviewPhotoObjectPath, cleanupCanonicalReviewPhotoObjects, normalizeReviewPhotoFilename, getCanonicalReviewPhotoObjectPaths } from '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/lib/review-photo-url';

// Run the actual component handlers and Supabase adapter with offline boundaries.
// This avoids global module mocks affecting other unit suites and never imports
// the configured browser client, reads .env, renders React, or calls a service.
const source = readFileSync(process.env.TZUDONG_REVIEW_SUBMIT_SOURCE ?? '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong/apps/web/components/reviews/ReviewModal.tsx', 'utf8');
function nodeText(text: string, name: string): string {
    const tree = ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found: ts.Node | undefined;
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) found = node.initializer;
        if (!found) ts.forEachChild(node, visit);
    }
    visit(tree);
    if (!found) throw new Error('FIXTURE_NODE_MISSING');
    return found.getText(tree);
}
function evaluate(text: string, bindings: Record<string, unknown>) {
    const moduleFixture = { exports: {} };
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    return vm.runInNewContext(js, { module: moduleFixture, exports: moduleFixture.exports, File, crypto, Date, Promise,
        require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw new Error('OFFLINE_IMPORT'); },
        console: { error() {}, warn() {} }, fetch: () => { throw new Error('OFFLINE_ONLY'); }, ...bindings });
}
function fixture() {
    const counts = { ids: 0, uploads: 0, inserts: 0, removes: 0, reads: 0, cleared: 0, success: 0, closes: 0 };
    const rows = new Map<string, { id: string; user_id: string; restaurant_id: string; verification_photo: string; food_photos: string[]; is_verified: boolean }>();
    const objects = new Set<string>();
    const selected: string[] = [];
    const filters: Record<string, unknown>[] = [];
    let mode: 'normal' | 'denied' | 'lost' | 'lost-read-fails' = 'normal';
    let readFail = false;
    let afterInsert: (() => void) | undefined;
    let currentOwner = (): string | undefined => 'fixture-owner';
    let prepareDeletion: () => Promise<() => Promise<boolean>> = async () => async () => { counts.cleared++; return true; };
    const storage = {
        async upload(path: string, _file: File, options: unknown) {
            expect(options).toEqual({ cacheControl: '3600', upsert: false });
            counts.uploads++; objects.add(path); return { error: null };
        },
        async remove(paths: string[]) { counts.removes++; paths.forEach(path => objects.delete(path)); return { error: null }; },
        async list(directory: string, { search }: {search: string}) { return { data: objects.has(`${directory}/${search}`) ? [{ name: search }] : [], error: null }; },
    };
    const supabase = {
        storage: { from: (bucket: string) => { expect(bucket).toBe('review-photos'); return storage; } },
        from: (table: string) => {
            expect(table).toBe('reviews');
            return {
                async insert(row: typeof rows extends Map<string, infer Row> ? Row : never) {
                    counts.inserts++;
                    if (mode === 'denied') return { error: { code: '42501' } };
                    if (rows.has(row.id)) return { error: { code: '23505' } };
                    rows.set(row.id, row);
                    afterInsert?.();
                    if (mode === 'lost' || mode === 'lost-read-fails') return { error: { code: 'transport' } };
                    return { error: null };
                },
                select(columns: string) {
                    selected.push(columns); const values: Record<string, unknown> = {}; filters.push(values);
                    const query = {
                        eq(key: string, value: unknown) { values[key] = value; return query; },
                        async maybeSingle() {
                            counts.reads++;
                            if (readFail || mode === 'lost-read-fails') return { data: null, error: {} };
                            const row = rows.get(String(values.id));
                            return { data: row?.user_id === values.user_id ? row : null, error: null };
                        },
                    };
                    return query;
                },
            };
        },
    };
    const create = evaluate(`${nodeText(source, 'createReviewSaveOperation')}\ncreateReviewSaveOperation;`, {
        crypto: { randomUUID: () => { counts.ids++; return crypto.randomUUID(); } },
        ReviewSaveOperation, supabase, buildReviewPhotoObjectPath, normalizeReviewPhotoFilename, cleanupCanonicalReviewPhotoObjects,
        prepareReceiptImage: async (file: File) => file, compressFoodImage: async (file: File) => file,
        prepareDraftDeletion: () => prepareDeletion(),
    }) as (owner: () => string) => ReviewSaveOperation;
    const fields = {
        visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'],
        content: 'Synthetic offline fixture review content only.',
        verificationPhoto: new File(['receipt'], 'receipt.jpg'), foodPhotos: [new File(['food'], 'food.jpg')],
        restaurantId: 'fixture-restaurant',
    };
    const messages: {title: string; description?: string}[] = [];
    const recoveryStates: (string | null)[] = [];
    const bindings = {
        ...fields, selectedRestaurant: { id: fields.restaurantId, name: 'Fixture' }, restaurant: null,
        user: { id: 'fixture-owner' }, saveOwnerRef: { current: 'fixture-owner' },
        saveOperationRef: { current: create(() => currentOwner()!) },
        submitInFlightRef: { current: false }, closeRequestedRef: { current: false }, composerOpenRef: { current: true },
        autoSaveInFlightRef: { current: null },
        latestSaveInputsRef: { current: fields }, setIsSubmitting() {}, toast: (message: {title: string}) => messages.push(message),
        clearDraft: async () => { counts.cleared++; return true; }, onSuccess: () => { counts.success++; },
        consumerNotifiedRef: { current: false }, setSaveRecovery: (value: string | null) => { recoveryStates.push(value); },
        notifySavedReview: () => { counts.success++; },
        handleClose: async () => { counts.closes++; },
    };
    currentOwner = () => bindings.saveOwnerRef.current;
    bindings.notifySavedReview = evaluate(`${nodeText(source, 'notifySavedReview')};`, {
        ...bindings, useCallback: (callback: unknown) => callback,
    }) as () => void;
    const close = () => evaluate(`${nodeText(source, 'handleClose')};`, {
        ...bindings, useCallback: (callback: unknown) => callback, onClose: () => { counts.closes++; },
        ocrAbortControllerRef: { current: null }, replaceVerificationPhoto() {},
        setVisitedDate() {}, setVisitedTime() {}, setCategories() {}, setContent() {}, setFoodPhotos() {},
        setVerificationInputMode() {}, setForceOcrRefresh() {}, setOcrFocusTarget() {}, setOcrProgress() {},
        setOcrFallbackNotice() {}, setAiFilledFields() {}, setCurrentStep() {},
    }) as () => Promise<void>;
    const submit = evaluate(`${nodeText(source, 'handleSubmit')};`, bindings) as () => Promise<void>;
    return { counts, rows, objects, messages, recoveryStates, selected, filters, bindings, submit, close,
        setMode: (value: typeof mode) => { mode = value; }, failReads: (value: boolean) => { readFail = value; },
        onInsert: (callback: () => void) => { afterInsert = callback; },
        setPrepareDeletion: (callback: typeof prepareDeletion) => { prepareDeletion = callback; } };
}


export { fixture, evaluate, nodeText, source };
