import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { getOwnedReviewPhotoObjectPath } from '../lib/review-photo-url';
import { getEditableFoodPhotoValues, restoreEditableFoodPhotoValues } from '../lib/reviews/review-edit-food-values';

const origin = 'https://project-ref.supabase.co';
const ownership = { ownerId: 'fixture-owner', reviewId: 'fixture-review', purpose: 'food' as const };
const ownedKey = 'fixture-owner/reviews/fixture-review/food/existing.webp';
const addedKey = 'fixture-owner/reviews/fixture-review/food/new.webp';
const foreignKey = 'other-owner/reviews/fixture-review/food/old.webp';
const foreignUrl = 'https://historical.example/old-photo.jpg';
const opaque = ' opaque historical value ';
const ownedUrl = `${origin}/storage/v1/object/public/review-photos/${ownedKey}`;
const originals = [ownedKey, ownedUrl, foreignKey, foreignUrl, opaque];
const source = readFileSync(new URL('../components/reviews/ReviewEditModal.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('ReviewEditModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function snippet(name: string): string {
    let found: string | undefined;
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = `${node.getText(tree)}\n${name};`;
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) found = node.initializer.getText(tree);
        if (!found) ts.forEachChild(node, visit);
    }
    visit(tree);
    if (!found) throw new Error('FIXTURE_NODE_MISSING');
    return found;
}

function effect(marker: string): string {
    let found: string | undefined;
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
            && node.arguments[0]?.getText(tree).includes(marker)) found = node.arguments[0].getText(tree);
        if (!found) ts.forEachChild(node, visit);
    }
    visit(tree);
    if (!found) throw new Error('FIXTURE_EFFECT_MISSING');
    return found;
}

function evaluate<T>(text: string, bindings: Record<string, unknown>): T {
    const compiled = ts.transpileModule(text, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    return vm.runInNewContext(compiled, {
        exports: {},
        useCallback: (callback: unknown) => callback,
        useMemo: (callback: () => unknown) => callback(),
        getEditableFoodPhotoValues, restoreEditableFoodPhotoValues,
        fetch: () => { throw new Error('OFFLINE_ONLY'); },
        console: { error() {} },
        require: (name: string) => {
            if (name === 'react/jsx-runtime') return jsxRuntime;
            throw new Error('OFFLINE_IMPORT');
        },
        ...bindings,
    }) as T;
}

describe('authoritative food values in review editing', () => {
    test('preserves every original string exactly, including opaque and foreign values', () => {
        expect(getEditableFoodPhotoValues(originals, originals, ownership)).toEqual(originals);
        expect(getEditableFoodPhotoValues([opaque, opaque], [opaque], ownership)).toEqual([opaque]);
    });

    test('drafts admit original values and new canonical owned keys, never injected URLs or opaque values', () => {
        expect(getEditableFoodPhotoValues(
            [...originals, addedKey, 'new opaque', 'https://new.example/photo.jpg', `${origin}/storage/v1/object/public/review-photos/${addedKey}`, 'other-owner/reviews/fixture-review/food/new.webp'],
            originals, ownership,
        )).toEqual([...originals, addedKey]);
    });

    test('old filtered drafts cannot implicitly delete historical originals', () => {
        expect(restoreEditableFoodPhotoValues(originals, [ownedKey], [], ownership)).toEqual(originals);
        expect(restoreEditableFoodPhotoValues(originals, [], undefined, ownership)).toEqual(originals);
    });

    test('explicit historical removal survives draft restoration without adding foreign inputs', () => {
        expect(restoreEditableFoodPhotoValues(
            originals, [ownedKey, addedKey, 'injected opaque'], [foreignUrl, opaque, 'unknown value'], ownership,
        )).toEqual([ownedKey, ownedUrl, foreignKey, addedKey]);
        expect(restoreEditableFoodPhotoValues([opaque, opaque], [], [opaque], ownership)).toEqual([opaque]);
    });

    test('actual preview and validation keep placeholder items in the count and enforce ten total values', () => {
        const bindings = { existingFoodPhotos: originals, review: { foodPhotos: originals }, foodPhotoOwnership: ownership,
            resolveReviewPhotoUrl: (value: string) => {
                const path = getOwnedReviewPhotoObjectPath(value, ownership, origin);
                return path ? `${origin}/storage/v1/object/public/review-photos/${path}` : null;
            } };
        const previews = evaluate<Array<{ storedValue: string; url: string | null }>>(snippet('existingFoodPhotoPreviews'), bindings);
        expect(previews.map(item => item.storedValue)).toEqual(originals);
        expect(previews.slice(2).map(item => item.url)).toEqual([null, null, null]);
        const isValid = (values: string[]) => evaluate<boolean>(snippet('isFormValid'), {
            ...bindings, existingFoodPhotos: values, categories: ['한식'], content: 'A complete synthetic review content.', newFoodPhotos: [], MAX_FOOD_PHOTOS: 10,
        });
        expect(isValid([opaque])).toBe(true);
        expect(isValid([])).toBe(false);
        expect(isValid(Array(11).fill(ownedKey))).toBe(false);
    });

    test('actual placeholder renders a labelled removal control and no external image or link', () => {
        const photo = evaluate<(props: { url: string | null; index: number; disabled: boolean; onRemove: () => void }) => ReactElement>(snippet('ExistingFoodPhoto'), {
            Image: () => { throw new Error('UNEXPECTED_IMAGE'); }, XIcon: () => null,
        });
        const markup = renderToStaticMarkup(createElement(photo, { url: null, index: 2, disabled: false, onRemove() {} }));
        expect(markup).toContain('role="img"');
        expect(markup).toContain('aria-label="기존 음식 사진 3: 미리보기 없음"');
        expect(markup).toContain('aria-label="기존 음식 사진 3 제거"');
        expect(markup).not.toMatch(/<(?:img|a)\b|\bsrc=|\bhref=/);
    });

    test('actual removal removes an opaque item by index, never a Storage object, and honors pending freeze', () => {
        let existing = [...originals]; let removed: string[] = [];
        const mutationRef = { current: { pending: true } };
        const remove = evaluate<(value: string, index: number) => void>(snippet('removeExistingFoodPhoto'), {
            existingFoodPhotos: originals, mutationRef,
            setExistingFoodPhotos: (update: (values: string[]) => string[]) => { existing = update(existing); },
            setRemovedPhotos: (update: (values: string[]) => string[]) => { removed = update(removed); },
        });
        remove(opaque, 4);
        expect(existing).toEqual(originals); expect(removed).toEqual([]);
        mutationRef.current.pending = false;
        remove(opaque, 4);
        expect(existing).toEqual(originals.slice(0, 4)); expect(removed).toEqual([opaque]);
        expect(snippet('removeExistingFoodPhoto')).not.toMatch(/storage|\.remove\(/);
    });

    test('actual autosave passes exact historical values and explicit removals to the existing draft boundary', async () => {
        let scheduled: (() => Promise<void>) | undefined; let saved: Record<string, unknown> | undefined;
        const autosave = evaluate<() => () => void>(effect('saveEditDraft'), {
            isOpen: true, review: { id: ownership.reviewId, foodPhotos: originals }, user: { id: ownership.ownerId },
            isSubmitting: false, isDeleting: false, mutationRef: { current: { pending: false } },
            content: 'Synthetic text', categories: ['한식'], existingFoodPhotos: originals.slice(0, 4), removedPhotos: [opaque], foodPhotoOwnership: ownership,
            setTimeout: (callback: () => Promise<void>) => { scheduled = callback; return 1; }, clearTimeout() {},
            saveEditDraft: async (input: Record<string, unknown>) => { saved = input; }, setLastSavedAt() {},
        });
        autosave(); await scheduled!();
        expect(saved?.existingFoodPhotos).toEqual(originals.slice(0, 4)); expect(saved?.removedPhotos).toEqual([opaque]);
    });

    test('actual async draft loading restores omitted originals and blocks pending-operation state changes', async () => {
        for (const pending of [false, true]) {
            let restored: string[] | undefined;
            const mutationRef = { current: { pending: false } };
            let resolveDraft!: (draft: unknown) => void;
            const draft = new Promise(resolve => { resolveDraft = resolve; });
            const load = evaluate<() => Promise<void>>(snippet('loadDraft'), {
                isOpen: true, review: { id: ownership.reviewId, foodPhotos: originals }, user: { id: ownership.ownerId },
                ownerRef: { current: ownership.ownerId }, mutationRef, foodPhotoOwnership: ownership, cancelled: false,
                getEditDraft: () => draft, setLastSavedAt() {}, setContent() {}, setCategories() {}, setRemovedPhotos() {},
                setExistingFoodPhotos: (values: string[]) => { restored = values; },
            });
            const loading = load(); mutationRef.current.pending = pending;
            resolveDraft({ savedAt: '2026-10-09T00:00:00Z', existingFoodPhotos: [ownedKey, 'injected value'], removedPhotos: [] });
            await loading;
            expect(restored).toEqual(pending ? undefined : originals);
        }
    });

    test('actual submit preserves foreign and opaque originals and omits only the selected removal', async () => {
        let submitted: { edit: { foodPhotos: string[]; original: { foodPhotos: string[] } } } | undefined;
        const remaining = originals.filter(value => value !== foreignUrl);
        const submit = evaluate<(kind: string) => Promise<void>>(snippet('executeMutation'), {
            review: { id: ownership.reviewId, foodPhotos: originals, content: 'Original synthetic content', categories: ['한식'] },
            user: { id: ownership.ownerId }, foodPhotoOwnership: ownership, ownerRef: { current: ownership.ownerId },
            content: 'Edited synthetic content', categories: ['한식'], existingFoodPhotos: [...remaining, 'injected value'], newFoodPhotos: [],
            isSubmitting: false, isDeleting: false,
            mutationRef: { current: { pendingKind: 'edit', canCancelConfirmedMissingUpload: false, run: async (input: typeof submitted) => {
                submitted = input; return { committed: false, code: 'REVIEW_NOT_CONFIRMED' };
            } } },
            setIsSubmitting() {}, setIsDeleting() {}, setRetryKind() {}, setCanCancelMissingUpload() {}, setCleanupFailureMessage() {},
            reviewMutationMessage: () => 'UNCONFIRMED', toast() {},
        });
        await submit('edit');
        expect(submitted?.edit.foodPhotos).toEqual(remaining);
        expect(submitted?.edit.original.foodPhotos).toEqual(originals);
    });
});
