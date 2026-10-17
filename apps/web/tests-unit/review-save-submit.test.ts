import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { ReviewDraft } from '../lib/reviewDraftDB';
import { ReviewSaveOperation } from '../lib/reviews/review-save-operation';
import { buildReviewPhotoObjectPath, cleanupCanonicalReviewPhotoObjects, normalizeReviewPhotoFilename } from '../lib/review-photo-url';
import { getEditableFoodPhotoValues } from '../lib/reviews/review-edit-food-values';
import { createLatestSelection, type LatestSelectionLease } from '../lib/ocr/latest-selection';
import { prepareVerificationUploadFile, ReceiptUploadPreparationError } from '../lib/ocr/receipt-upload-preparation';
import { OCR_REVIEW_VERIFICATION_MAX_BYTES } from '../lib/ocr/review-verification-contract';
import { reconcileInterruptedOcrReadback } from '../lib/ocr/review-modal-ocr-ux';

// Run the actual component handlers and Supabase adapter with offline boundaries.
// This avoids global module mocks affecting other unit suites and never imports
// the configured browser client, reads .env, renders React, or calls a service.
const source = readFileSync(process.env.TZUDONG_REVIEW_SUBMIT_SOURCE ?? join(import.meta.dir, '../components/reviews/ReviewModal.tsx'), 'utf8');
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
    const counts = { uploads: 0, inserts: 0, removes: 0, reads: 0, cleared: 0, success: 0, closes: 0 };
    const rows = new Map<string, { id: string; user_id: string; restaurant_id: string; verification_photo: string; food_photos: string[]; is_verified: boolean }>();
    const objects = new Set<string>();
    const metadata = new Map<string, { size: number; contentType: string }>();
    const selected: string[] = [];
    const filters: Record<string, unknown>[] = [];
    let mode: 'normal' | 'denied' | 'lost' | 'lost-read-fails' = 'normal';
    let readFail = false;
    let uploadError: unknown = null;
    let featureReady = true;
    const draftScopeRef = { current: { ownerId: 'fixture-owner', restaurantId: 'fixture-restaurant', revision: null as ReviewDraft | null } };
    let afterInsert: (() => void) | undefined;
    let currentOwner = (): string | undefined => 'fixture-owner';
    let prepareDeletion: (...args: unknown[]) => Promise<() => Promise<boolean>> = async () => async () => { counts.cleared++; return true; };
    const storage = {
        async upload(path: string, file: File, options: unknown) {
            expect(options).toEqual({ cacheControl: '3600', upsert: false });
            counts.uploads++; if (uploadError) return { error: uploadError };
            objects.add(path); metadata.set(path, { size: file.size, contentType: file.type }); return { error: null };
        },
        async info(path: string) { return { data: objects.has(path) ? metadata.get(path) ?? null : null, error: null }; },
        async remove(paths: string[]) { counts.removes++; paths.forEach(path => objects.delete(path)); return { error: null }; },
        async list(directory: string, { search }: {search: string}) { return { data: objects.has(`${directory}/${search}`) ? [{ name: search }] : [], error: null }; },
    };
    const supabase = {
        storage: { from: (bucket: string) => {
            expect(['review-photos', 'review-verifications']).toContain(bucket);
            const bound = (path: string) => expect(bucket).toBe(path.split('/')[3] === 'verification' ? 'review-verifications' : 'review-photos');
            return {
                upload: (path: string, file: File, options: unknown) => { bound(path); return storage.upload(path, file, options); },
                info: (path: string) => { bound(path); return storage.info(path); },
                remove: (paths: string[]) => { paths.forEach(bound); return storage.remove(paths); },
                list: (directory: string, options: { search: string }) => { bound(directory); return storage.list(directory, options); },
            };
        } },
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
        ReviewSaveOperation, supabase, buildReviewPhotoObjectPath, normalizeReviewPhotoFilename, cleanupCanonicalReviewPhotoObjects,
        prepareReceiptImage: async (file: File) => file, compressFoodImage: async (file: File) => file,
        prepareDraftDeletion: (...args: unknown[]) => prepareDeletion(...args),
    }) as (owner: () => string, revision: () => ReviewDraft | null) => ReviewSaveOperation;
    const fields = {
        visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'],
        content: 'Synthetic offline fixture review content only.',
        verificationPhoto: new File(['receipt'], 'receipt.jpg'), foodPhotos: [new File(['food'], 'food.jpg')],
        restaurantId: 'fixture-restaurant',
        ocrResultRef: null as string | null, ocrResultRevision: null as string | null,
    };
    const messages: {title: string; description?: string}[] = [];
    const recoveryStates: (string | null)[] = [];
    const bindings = {
        ...fields, selectedRestaurant: { id: fields.restaurantId, name: 'Fixture' }, restaurant: null,
        user: { id: 'fixture-owner' }, saveOwnerRef: { current: 'fixture-owner' },
        saveOperationRef: { current: create(() => currentOwner()!, () => draftScopeRef.current.revision) },
        draftScopeRef,
        submitInFlightRef: { current: false }, closeRequestedRef: { current: false }, composerOpenRef: { current: true },
        autoSaveInFlightRef: { current: null },
        verificationSelectionRef: { current: { invalidate() {} } },
        latestSaveInputsRef: { current: fields }, setIsSubmitting() {}, toast: (message: {title: string}) => messages.push(message),
        fetchFeatureDatabaseReadiness: async () => featureReady
            ? { schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' }
            : { schemaVersion: 1, status: 'held', code: 'FEATURE_DATABASE_HELD' },
        mutateFeatureReadiness: async () => undefined,
        FEATURE_DATABASE_HELD_MESSAGE: 'FEATURE_HELD_MESSAGE',
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
        setReceiptVerificationInputMode() {}, setForceOcrRefresh() {}, setOcrFocusTarget() {}, setOcrProgress() {},
        setOcrFallbackNotice() {}, setAiFilledFields() {}, setCurrentStep() {},
    }) as () => Promise<void>;
    const submit = evaluate(`${nodeText(source, 'handleSubmit')};`, bindings) as () => Promise<void>;
    return { counts, rows, objects, messages, recoveryStates, selected, filters, bindings, submit, close,
        setMode: (value: typeof mode) => { mode = value; }, failReads: (value: boolean) => { readFail = value; },
        onInsert: (callback: () => void) => { afterInsert = callback; },
        setPrepareDeletion: (callback: typeof prepareDeletion) => { prepareDeletion = callback; },
        setUploadError: (error: unknown) => { uploadError = error; },
        setFeatureReady: (value: boolean) => { featureReady = value; } };
}

describe('actual receipt result recovery', () => {
    test('switching to photo-only during deferred compression preserves the attachment without starting OCR', async () => {
        const verificationSelectionRef = { current: createLatestSelection() };
        const receiptOcrSelection = createLatestSelection();
        let ocrPreparationLease: LatestSelectionLease | null = null;
        const receiptOcrPreparationRef = {
            current: {
                ...receiptOcrSelection,
                begin: () => {
                    ocrPreparationLease = receiptOcrSelection.begin();
                    return ocrPreparationLease;
                },
            },
        };
        const verificationInputModeRef = { current: 'ai' as 'ai' | 'manual' };
        const ocrRunGenerationRef = { current: 0 };
        const ocrAbortControllerRef: { current: AbortController | null } = { current: null };
        const userStepOverrideDuringOcrRef = { current: false };
        let renderedMode: 'ai' | 'manual' = 'ai';
        let attached: File | null = null;
        let analyzeCalls = 0;
        let compressorSignal: AbortSignal | undefined;
        let enterCompressor!: () => void;
        let finishCompression!: (blob: Blob) => void;
        const compressorEntered = new Promise<void>(resolve => { enterCompressor = resolve; });
        const compressed = new Promise<Blob>(resolve => { finishCompression = resolve; });

        const setMode = evaluate(`${nodeText(source, 'setReceiptVerificationInputMode')};`, {
            useCallback: (callback: unknown) => callback,
            verificationInputModeRef, receiptOcrPreparationRef, ocrRunGenerationRef, ocrAbortControllerRef,
            userStepOverrideDuringOcrRef, latestSaveInputsRef: { current: {} },
            setVerificationInputMode(value: 'ai' | 'manual') { renderedMode = value; },
            setOcrResultRef() {}, setOcrResultRevision() {},
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {},
        }) as (mode: 'ai' | 'manual') => void;
        const selectPhoto = evaluate(`${nodeText(source, 'handleVerificationPhotoSelected')};`, {
            verificationSelectionRef, receiptOcrPreparationRef, verificationInputModeRef,
            ocrRunGenerationRef, ocrAbortControllerRef,
            setIsAnalyzing() {}, setOcrProgress() {}, featureHeld: false,
            isSupportedReceiptImage: () => true, toast() {}, FEATURE_DATABASE_HELD_MESSAGE: 'held',
            generateSafeFilename: () => 'prepared.jpg', prepareVerificationUploadFile,
            imageCompression: async (_file: File, options: { signal?: AbortSignal }) => {
                compressorSignal = options.signal;
                enterCompressor();
                return compressed;
            },
            replaceVerificationPhoto(file: File, generation: number) {
                expect(verificationSelectionRef.current.isCurrent(generation)).toBe(true);
                attached = file;
                return true;
            },
            verificationFileInputRef: { current: null },
            window: { setTimeout: (callback: () => void) => globalThis.setTimeout(callback, 0) },
            analyzeReceipt() { analyzeCalls += 1; }, ReceiptUploadPreparationError,
        }) as (file: File) => Promise<void>;
        const original = new File(
            [new Uint8Array(OCR_REVIEW_VERIFICATION_MAX_BYTES + 1)],
            'slow-receipt.jpg',
            { type: 'image/jpeg' },
        );

        const selection = selectPhoto(original);
        await compressorEntered;
        setMode('manual');
        expect(ocrPreparationLease?.signal.aborted).toBe(true);
        expect(compressorSignal?.aborted).toBe(false);
        finishCompression(new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }));
        await selection;
        await new Promise(resolve => globalThis.setTimeout(resolve, 0));

        expect(attached?.size).toBe(1024);
        expect(analyzeCalls).toBe(0);
        expect(renderedMode).toBe('manual');
        expect(verificationInputModeRef.current).toBe('manual');
        expect(userStepOverrideDuringOcrRef.current).toBe(true);
    });

    test('removing a receipt cancels analysis and clears its busy state', () => {
        const controller = new AbortController();
        const generation = { current: 4 };
        const recovery = { current: { file: new File(['old'], 'old.jpg') } as unknown };
        let analyzing = true;
        let progress: unknown = { stage: 'model_start' };
        const replace = evaluate(`${nodeText(source, 'replaceVerificationPhoto')};`, {
            useCallback: (callback: unknown) => callback,
            verificationSelectionRef: { current: { invalidate() {} } },
            receiptOcrPreparationRef: { current: { invalidate() {} } },
            verificationPhotoUrlRef: { current: null },
            ocrRunGenerationRef: generation, ocrAbortControllerRef: { current: controller },
            ocrRecoveryContextRef: recovery,
            setIsAnalyzing(value: boolean) { analyzing = value; },
            setOcrProgress(value: unknown) { progress = value; },
            setVerificationPhotoUrl() {}, setVerificationPhoto() {},
            setOcrResultRef() {}, setOcrResultRevision() {},
        }) as (file: File | null) => boolean;
        expect(replace(null)).toBe(true);
        expect(controller.signal.aborted).toBe(true);
        expect(generation.current).toBe(5);
        expect(recovery.current).toBeNull();
        expect(analyzing).toBe(false);
        expect(progress).toBeNull();
    });

    test('a buffered stream frame cannot patch fields after cancellation', async () => {
        let finishRead!: (value: unknown) => void;
        let enteredRead!: () => void;
        const started = new Promise<void>(resolve => { enteredRead = resolve; });
        const pending = new Promise(resolve => { finishRead = resolve; });
        const controller = new AbortController();
        const context = { id: 'original-restaurant', categories: ['한식'] };
        const recoveryRef = { current: null as unknown };
        let patches = 0;
        const stream = evaluate(`${nodeText(source, 'analyzeReceiptWithStream')};`, {
            useCallback: (callback: unknown) => callback, FormData, TextDecoder,
            selectedRestaurant: context, restaurant: null, ocrRecoveryContextRef: recoveryRef,
            appendSelectedRestaurantOcrContext() {},
            fetch: async () => ({ ok: true, body: { getReader: () => ({ read: () => { enteredRead(); return pending; } }) } }),
            parseOcrStreamFrame: () => ({ event: 'field_patch', payload: { data: { date: '2026-10-15' } } }),
            handleOcrStreamEvent() { patches++; },
        }) as (file: File, token: string, signal: AbortSignal, force: boolean) => Promise<unknown>;
        const file = new File(['receipt'], 'receipt.jpg');
        const run = stream(file, 'offline-session-token', controller.signal, false);
        await started;
        controller.abort();
        finishRead({ done: false, value: new TextEncoder().encode('event: field_patch\ndata: {}\n\n') });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        expect(patches).toBe(0);
        expect(recoveryRef.current).toEqual({ file, restaurant: context });
    });

    test('status readback keeps the original restaurant context after form edits', async () => {
        const file = new File(['same receipt'], 'receipt.jpg');
        const original = { id: 'original-restaurant', name: 'Original' };
        const current = { id: 'edited-restaurant', name: 'Edited' };
        let sentContext: unknown;
        let requests = 0;
        const read = evaluate(`${nodeText(source, 'readReceiptOcrStatus')};`, {
            useCallback: (callback: unknown) => callback, FormData,
            selectedRestaurant: current, restaurant: null,
            ocrRecoveryContextRef: { current: { file, restaurant: original } },
            appendSelectedRestaurantOcrContext(_form: FormData, context: unknown) { sentContext = context; },
            fetch: async (url: string) => {
                expect(url).toBe('/api/ocr/results/status'); requests++;
                return { status: 200, json: async () => ({}) };
            },
        }) as (file: File, token: string, signal: AbortSignal) => Promise<unknown>;
        await read(file, 'offline-session-token', new AbortController().signal);
        expect(requests).toBe(1);
        expect(sentContext).toBe(original);
        await read(new File(['new receipt'], 'new.jpg'), 'offline-session-token', new AbortController().signal);
        expect(requests).toBe(2);
        expect(sentContext).toBe(current);
    });

    test('a late stored result cannot update a newer receipt selection', async () => {
        const ocrRunGenerationRef = { current: 0 };
        const ocrAbortControllerRef: { current: AbortController | null } = { current: null };
        let finishRead!: (value: unknown) => void;
        let enteredRead!: () => void;
        const started = new Promise<void>(resolve => { enteredRead = resolve; });
        const pending = new Promise(resolve => { finishRead = resolve; });
        const effects = { result: 0, fields: 0, notices: 0 };
        const receiptOcrPreparationRef = { current: createLatestSelection() };
        const verificationInputModeRef = { current: 'ai' as 'ai' | 'manual' };
        const userStepOverrideDuringOcrRef = { current: false };
        const setMode = evaluate(`${nodeText(source, 'setReceiptVerificationInputMode')};`, {
            useCallback: (callback: unknown) => callback,
            verificationInputModeRef, receiptOcrPreparationRef, ocrRunGenerationRef, ocrAbortControllerRef,
            userStepOverrideDuringOcrRef, latestSaveInputsRef: { current: {} },
            setVerificationInputMode() {}, setOcrResultRef() {}, setOcrResultRevision() {},
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {},
        }) as (mode: 'ai' | 'manual') => void;
        const analyze = evaluate(`${nodeText(source, 'analyzeReceipt')}\nanalyzeReceipt;`, {
            AbortController, featureHeld: false, user: { id: 'fixture-owner' },
            canForceOcrRefresh: false, forceOcrRefresh: false,
            ocrRunGenerationRef, ocrAbortControllerRef,
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {},
            supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'offline-session-token' } } }) } },
            readReceiptOcrStatus: () => { enteredRead(); return pending; },
            setOcrResultRef() { effects.result++; }, setOcrResultRevision() { effects.result++; },
            applyOcrFieldPatch() { effects.fields++; }, revealOcrAutoFillSequence() { effects.fields++; },
            manuallyEditedOcrFieldsRef: { current: new Set() },
            canReplaceSelectedRestaurantFromOcr: () => false,
            selectedRestaurant: null, restaurant: null, mutateQuota() {},
            isAbortError: (error: unknown) => error instanceof Error && error.name === 'AbortError',
            isPendingOcrStreamError: () => false,
            toast() { effects.notices++; },
        }) as (file: File, generation: number | undefined, statusOnly: boolean) => Promise<void>;
        const run = analyze(new File(['old receipt'], 'old.jpg'), undefined, true);
        await started;
        setMode('manual');
        // A completed request can settle after cancellation; its payload must
        // still be ignored even if a transport/mock does not reject on abort.
        finishRead({ ocr_result_ref: '11111111-1111-4111-8111-111111111111',
            ocr_result_revision: '22222222-2222-4222-8222-222222222222' });
        await run;
        expect(effects).toEqual({ result: 0, fields: 0, notices: 0 });
        expect(verificationInputModeRef.current).toBe('manual');
        expect(userStepOverrideDuringOcrRef.current).toBe(true);
        expect(ocrAbortControllerRef.current).toBeNull();
    });

    test('direct input cancels deferred status readback after an interrupted SSE stream', async () => {
        const ocrRunGenerationRef = { current: 0 };
        const ocrAbortControllerRef: { current: AbortController | null } = { current: null };
        const receiptOcrPreparationRef = { current: createLatestSelection() };
        const verificationInputModeRef = { current: 'ai' as 'ai' | 'manual' };
        const userStepOverrideDuringOcrRef = { current: false };
        const manuallyEditedOcrFieldsRef = { current: new Set<string>() };
        const lastManualOcrInteractionAtRef = { current: 0 };
        const lastOcrRevealSignatureRef = { current: null as string | null };
        let finishRead!: (value: unknown) => void;
        let enterRead!: () => void;
        const readStarted = new Promise<void>(resolve => { enterRead = resolve; });
        const delayedStatus = new Promise(resolve => { finishRead = resolve; });
        const effects = { result: 0, fields: 0, navigation: 0 };
        const setMode = evaluate(`${nodeText(source, 'setReceiptVerificationInputMode')};`, {
            useCallback: (callback: unknown) => callback,
            verificationInputModeRef, receiptOcrPreparationRef, ocrRunGenerationRef, ocrAbortControllerRef,
            userStepOverrideDuringOcrRef, latestSaveInputsRef: { current: {} },
            setVerificationInputMode() {}, setOcrResultRef() {}, setOcrResultRevision() {},
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {},
        }) as (mode: 'ai' | 'manual') => void;
        const analyze = evaluate(`${nodeText(source, 'analyzeReceipt')}\nanalyzeReceipt;`, {
            AbortController, featureHeld: false, user: { id: 'fixture-owner' },
            canForceOcrRefresh: false, forceOcrRefresh: false,
            ocrRunGenerationRef, ocrAbortControllerRef, manuallyEditedOcrFieldsRef,
            lastManualOcrInteractionAtRef, lastOcrRevealSignatureRef, userStepOverrideDuringOcrRef,
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {}, setAiFilledFields() {},
            supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'offline-session-token' } } }) } },
            analyzeReceiptWithStream: async () => { throw new Error('synthetic interrupted stream'); },
            readReceiptOcrStatus: () => { enterRead(); return delayedStatus; },
            reconcileInterruptedOcrReadback,
            isTerminalOcrStreamError: () => false,
            isPendingOcrStreamError: () => false,
            isAbortError: (error: unknown) => error instanceof Error && error.name === 'AbortError',
            setOcrResultRef() { effects.result += 1; }, setOcrResultRevision() { effects.result += 1; },
            applyOcrFieldPatch() { effects.fields += 1; },
            revealOcrAutoFillSequence() { effects.navigation += 1; },
            canReplaceSelectedRestaurantFromOcr: () => false,
            selectedRestaurant: null, restaurant: null, mutateQuota() {}, toast() {},
        }) as (file: File) => Promise<void>;

        const run = analyze(new File(['receipt'], 'receipt.jpg'));
        await readStarted;
        setMode('manual');
        finishRead({
            ocr_result_ref: '11111111-1111-4111-8111-111111111111',
            ocr_result_revision: '22222222-2222-4222-8222-222222222222',
        });
        await run;

        expect(effects).toEqual({ result: 0, fields: 0, navigation: 0 });
        expect(verificationInputModeRef.current).toBe('manual');
        expect(userStepOverrideDuringOcrRef.current).toBe(true);
        expect(ocrAbortControllerRef.current).toBeNull();
    });

    test('status-only readback preserves manual edits and navigation without another model request', async () => {
        const edits = new Set(['date', 'review']);
        const manuallyEditedOcrFieldsRef = { current: edits };
        const lastManualOcrInteractionAtRef = { current: 1234 };
        const userStepOverrideDuringOcrRef = { current: true };
        const lastOcrRevealSignatureRef = { current: 'previous-reveal' };
        const stopped = new DOMException('Offline readback stopped', 'AbortError');
        let reads = 0;
        let modelRequests = 0;
        let markerResets = 0;
        const analyze = evaluate(`${nodeText(source, 'analyzeReceipt')}\nanalyzeReceipt;`, {
            AbortController,
            featureHeld: false,
            user: { id: 'fixture-owner' },
            canForceOcrRefresh: false,
            forceOcrRefresh: false,
            manuallyEditedOcrFieldsRef,
            lastManualOcrInteractionAtRef,
            userStepOverrideDuringOcrRef,
            lastOcrRevealSignatureRef,
            ocrRunGenerationRef: { current: 0 },
            ocrAbortControllerRef: { current: null },
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {},
            setAiFilledFields() { markerResets++; },
            supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'offline-session-token' } } }) } },
            readReceiptOcrStatus: async () => { reads++; throw stopped; },
            analyzeReceiptWithStream: async () => { modelRequests++; throw new Error('UNEXPECTED_MODEL_REQUEST'); },
            isAbortError: (error: unknown) => error === stopped,
        }) as (file: File, generation: number | undefined, statusOnly: boolean) => Promise<void>;

        await analyze(new File(['receipt'], 'receipt.jpg'), undefined, true);

        expect(reads).toBe(1);
        expect(modelRequests).toBe(0);
        expect(markerResets).toBe(0);
        expect(manuallyEditedOcrFieldsRef.current).toBe(edits);
        expect([...manuallyEditedOcrFieldsRef.current]).toEqual(['date', 'review']);
        expect(lastManualOcrInteractionAtRef.current).toBe(1234);
        expect(userStepOverrideDuringOcrRef.current).toBe(true);
        expect(lastOcrRevealSignatureRef.current).toBe('previous-reveal');
    });
});

describe('actual ReviewModal submit and Supabase adapter', () => {
    test('receipt selection and preparation enforce the private bucket MIME allowlist', () => {
        expect(source).toContain('SUPPORTED_RECEIPT_MIME_TYPES.has(file.type)');
        expect(source).toContain('preparedFile = await prepareVerificationUploadFile({');
        expect(source).toContain('분석 요청은 전송되지 않았습니다.');
        expect(source).not.toContain('영수증 리사이즈 실패, 원본 사용');
        expect(source.match(/accept=\{RECEIPT_IMAGE_ACCEPT\}/g)?.length).toBe(3);
        expect(source).toContain('const imageFiles = files.filter(isSupportedReceiptImage);');
    });
    test('saved cleanup owns its revision even after the current restaurant selection is cleared', async () => {
        const f = fixture(); await f.submit();
        const clear = evaluate(`${nodeText(source, 'clearDraft')};`, {
            ...f.bindings, selectedRestaurant: null, restaurant: null,
            setLastSavedAt() {}, useCallback: (callback: unknown) => callback,
        }) as () => Promise<boolean>;
        expect(await clear()).toBe(true);
        expect(f.rows.size).toBe(1); expect(f.counts.inserts).toBe(1);
        expect(f.counts.removes).toBe(0); expect(f.objects.size).toBe(2);
    });
    test('known success writes pending review with canonical owner/review-bound photos', async () => {
        const f = fixture(); await f.submit();
        expect(f.rows.size).toBe(1); expect(f.objects.size).toBe(2);
        expect(f.counts).toEqual({ uploads: 2, inserts: 1, removes: 0, reads: 0, cleared: 1, success: 1, closes: 1 });
        const row = [...f.rows.values()][0]; expect(row.is_verified).toBe(false); expect(row.user_id).toBe('fixture-owner');
        expect(row.verification_photo.startsWith(`${row.user_id}/reviews/${row.id}/verification/`)).toBe(true);
        expect(row.food_photos[0].startsWith(`${row.user_id}/reviews/${row.id}/food/`)).toBe(true);
    });
    test('photo-only mode clears a completed OCR binding and uses the standard review insert', async () => {
        const f = fixture();
        f.bindings.latestSaveInputsRef.current = {
            ...f.bindings.latestSaveInputsRef.current,
            ocrResultRef: '11111111-1111-4111-8111-111111111111',
            ocrResultRevision: '22222222-2222-4222-8222-222222222222',
        };
        const cleared = { ref: false, revision: false };
        const setMode = evaluate(`${nodeText(source, 'setReceiptVerificationInputMode')};`, {
            useCallback: (callback: unknown) => callback,
            verificationInputModeRef: { current: 'ai' },
            receiptOcrPreparationRef: { current: createLatestSelection() },
            ocrRunGenerationRef: { current: 0 }, ocrAbortControllerRef: { current: null },
            userStepOverrideDuringOcrRef: { current: false },
            latestSaveInputsRef: f.bindings.latestSaveInputsRef,
            setVerificationInputMode() {},
            setOcrResultRef(value: null) { cleared.ref = value === null; },
            setOcrResultRevision(value: null) { cleared.revision = value === null; },
            setIsAnalyzing() {}, setOcrProgress() {}, setOcrFallbackNotice() {},
        }) as (mode: 'ai' | 'manual') => void;

        setMode('manual');
        expect(cleared).toEqual({ ref: true, revision: true });
        expect(f.bindings.latestSaveInputsRef.current.ocrResultRef).toBeNull();
        expect(f.bindings.latestSaveInputsRef.current.ocrResultRevision).toBeNull();

        await f.submit();
        expect(f.rows.size).toBe(1);
        expect(f.counts).toEqual({ uploads: 2, inserts: 1, removes: 0, reads: 0, cleared: 1, success: 1, closes: 1 });
        expect([...f.rows.values()][0]).not.toHaveProperty('receipt_data');
    });
    test('held feature readiness stops before draft capture, upload, or review insert', async () => {
        const f = fixture(); f.setFeatureReady(false); await f.submit();
        expect(f.rows.size).toBe(0); expect(f.objects.size).toBe(0);
        expect(f.counts.uploads).toBe(0); expect(f.counts.inserts).toBe(0); expect(f.counts.cleared).toBe(0);
        expect(f.messages).toEqual([{ title: '리뷰 기능 준비 중', description: 'FEATURE_HELD_MESSAGE' }]);
    });
    test('definite insert denial compensates and keeps input draft', async () => {
        const f = fixture(); f.setMode('denied'); await f.submit(); await f.submit();
        expect(f.rows.size).toBe(0); expect(f.objects.size).toBe(0); expect(f.counts.cleared).toBe(0);
        expect(f.counts.closes).toBe(0); expect(f.messages.every(item => item.title === '리뷰 등록 실패')).toBe(true);
    });
    test('lost commit reply reads by owner AND ID before reporting success', async () => {
        const f = fixture(); f.setMode('lost'); await f.submit(); await f.submit();
        expect(f.rows.size).toBe(1); expect(f.counts.inserts).toBe(1); expect(f.counts.uploads).toBe(2); expect(f.counts.removes).toBe(0);
        expect(f.filters[0]).toEqual({ id: [...f.rows.keys()][0], user_id: 'fixture-owner' });
        expect(f.selected[0]).toBe('id, user_id, restaurant_id, verification_photo, food_photos, receipt_data, ocr_processed_at');
    });
    test('unavailable readback blocks duplicate write and leaves draft/photos intact', async () => {
        const f = fixture(); f.setMode('lost-read-fails'); await f.submit(); await f.submit();
        expect(f.rows.size).toBe(1); expect(f.counts.inserts).toBe(1); expect(f.counts.uploads).toBe(2);
        expect(f.counts.cleared).toBe(0); expect(f.counts.closes).toBe(0); expect(f.counts.removes).toBe(0);
        expect(f.messages.every(item => item.title === '저장 상태 확인 필요')).toBe(true);
        f.setMode('normal'); await f.submit(); expect(f.counts.success).toBe(1);
    });
    test('actual submit ref rejects same-tick double submit', async () => {
        const f = fixture(); await Promise.all([f.submit(), f.submit()]);
        expect(f.counts.inserts).toBe(1); expect(f.counts.uploads).toBe(2); expect(f.counts.success).toBe(1);
    });
    test('changed input during submit is preserved after committed original draft', async () => {
        const f = fixture(); const pending = f.submit();
        f.bindings.latestSaveInputsRef.current = { ...f.bindings.latestSaveInputsRef.current, content: 'Changed during submission' };
        await pending;
        expect(f.rows.size).toBe(1); expect(f.counts.cleared).toBe(1); expect(f.counts.closes).toBe(0);
        expect(f.messages[0].title).toBe('이전 내용으로 등록되었습니다');
        expect(f.recoveryStates).toEqual(['edit']);
        expect(f.counts.success).toBe(0); // An onSuccess consumer is allowed to unmount the form.
        await f.close()();
        expect(f.counts.success).toBe(1); expect(f.counts.cleared).toBe(2);
    });
    test('close during committed insert reports success and notifies consumers once', async () => {
        const f = fixture();
        let closing: Promise<void> | undefined;
        f.onInsert(() => { closing = f.close()(); });
        await f.submit(); await closing;
        expect(f.rows.size).toBe(1); expect(f.counts.cleared).toBe(1); expect(f.counts.success).toBe(1);
        expect(f.counts.closes).toBe(1); expect(f.counts.removes).toBe(0);
        expect(f.messages.some(item => item.title === '리뷰가 등록되었습니다')).toBe(true);
    });
    test.each(['unmounted', 'different-owner'])('known commit completes scoped draft cleanup after %s without callbacks or photo removal', async (state) => {
        const f = fixture();
        f.onInsert(() => {
            f.bindings.saveOwnerRef.current = state === 'unmounted' ? undefined as unknown as string : 'different-owner';
            f.bindings.composerOpenRef.current = false;
        });
        await f.submit();
        expect(f.rows.size).toBe(1); expect(f.counts.cleared).toBe(1);
        expect(f.counts.success).toBe(0); expect(f.counts.closes).toBe(0);
        expect(f.counts.removes).toBe(0); expect(f.objects.size).toBe(2);
    });
    test('unmount with unanswered insert never clears its draft or saved photos', async () => {
        const f = fixture(); f.setMode('lost-read-fails');
        f.onInsert(() => { f.bindings.saveOwnerRef.current = undefined as unknown as string; });
        await f.submit();
        expect(f.rows.size).toBe(1); expect(f.counts.cleared).toBe(0);
        expect(f.counts.removes).toBe(0); expect(f.counts.success).toBe(0);
    });
    test('unmount during draft snapshot capture cannot dispatch a review write', async () => {
        const f = fixture();
        f.setPrepareDeletion(async () => {
            f.bindings.saveOwnerRef.current = undefined as unknown as string;
            return async () => { f.counts.cleared++; return true; };
        });
        const submit = evaluate(`${nodeText(source, 'handleSubmit')};`, f.bindings) as () => Promise<void>;
        await submit();
        expect(f.rows.size).toBe(0); expect(f.counts.uploads).toBe(0); expect(f.counts.inserts).toBe(0);
    });
    test('close readback can discover earlier commit and notify consumers', async () => {
        const f = fixture(); f.setMode('lost-read-fails'); await f.submit();
        f.setMode('normal'); await f.close()();
        expect(f.rows.size).toBe(1); expect(f.counts.success).toBe(1); expect(f.counts.closes).toBe(1);
        expect(f.counts.cleared).toBe(1); expect(f.counts.removes).toBe(0);
    });
    test('callback failure never reports database failure or permits a duplicate retry', async () => {
        const f = fixture();
        f.bindings.onSuccess = () => { throw new Error('synthetic'); };
        f.bindings.notifySavedReview = evaluate(`${nodeText(source, 'notifySavedReview')};`, {
            ...f.bindings, useCallback: (callback: unknown) => callback,
        }) as () => void;
        // Evaluate after replacing the callback because VM globals are copied.
        const submit = evaluate(`${nodeText(source, 'handleSubmit')};`, f.bindings) as () => Promise<void>;
        await submit(); await submit();
        expect(f.rows.size).toBe(1); expect(f.counts.inserts).toBe(1); expect(f.counts.uploads).toBe(2);
        expect(f.messages.some(item => item.title === '리뷰 등록 실패')).toBe(false);
    });
    test('draft deletion failure offers cleanup retry with the original saved operation', async () => {
        const f = fixture();
        f.bindings.clearDraft = async () => false;
        const failedCleanupSubmit = evaluate(`${nodeText(source, 'handleSubmit')};`, f.bindings) as () => Promise<void>;
        await failedCleanupSubmit();
        expect(f.recoveryStates).toEqual(['draft-cleanup']); expect(f.counts.closes).toBe(0);
        f.bindings.clearDraft = async () => { f.counts.cleared++; return true; };
        const retry = evaluate(`${nodeText(source, 'handleSubmit')};`, f.bindings) as () => Promise<void>;
        await retry();
        expect(f.counts.inserts).toBe(1); expect(f.counts.uploads).toBe(2); expect(f.counts.closes).toBe(1);
    });
    test('recovery renders an accessible new-tab edit destination and disables every create control', () => {
        const notice = evaluate(`${nodeText(source, 'saveRecoveryNotice')};`, { saveRecovery: 'edit' }) as ReactNode;
        const html = renderToStaticMarkup(notice);
        expect(html).toContain('role="status"'); expect(html).toContain('href="/mypage/reviews"');
        expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"');
        expect(source.match(/\{saveRecoveryNotice\}/g)?.length).toBe(3);
        expect(source.match(/disabled=\{featureHeld \|\| !isFormValid \|\| isSubmitting \|\| saveRecovery === 'edit'\}/g)?.length).toBe(3);
    });
    test('actual close handler retains form and blocks close for unresolved write', async () => {
        const f = fixture(); f.setMode('lost-read-fails'); await f.submit();
        const close = evaluate(`${nodeText(source, 'handleClose')};`, {
            ...f.bindings, useCallback: (callback: unknown) => callback, onClose: () => { f.counts.closes++; }, replaceVerificationPhoto() {},
            setReceiptVerificationInputMode() {},
        }) as () => Promise<void>;
        await close(); expect(f.counts.closes).toBe(0); expect(f.objects.size).toBe(2);
        expect(f.bindings.closeRequestedRef.current).toBe(false);
    });
    test('actual edit handler binds the owner and original snapshot to the atomic mutation', async () => {
        const edit = readFileSync(join(import.meta.dir, '../components/reviews/ReviewEditModal.tsx'), 'utf8');
        const calls = { update: 0, close: 0, draft: 0, success: 0 };
        let submitted: Record<string, unknown> = {};
        const ownership = { ownerId: 'fixture-owner', reviewId: 'fixture-review', purpose: 'food' as const };
        const existing = buildReviewPhotoObjectPath(ownership, 'existing.jpg')!;
        const original = { content: 'Original fixture review content.', categories: ['한식'], foodPhotos: [existing] };
        const execute = evaluate(`${nodeText(edit, 'executeMutation')};`, {
            review: { id: 'fixture-review', ...original }, user: { id: 'fixture-owner' }, foodPhotoOwnership: ownership,
            isSubmitting: false, isDeleting: false, ownerRef: { current: 'fixture-owner' },
            mutationRef: { current: { pending: false, pendingKind: null, canCancelConfirmedMissingUpload: false, run: async (input: Record<string, unknown>) => {
                calls.update++; submitted = input; return { committed: true, code: 'REVIEW_COMMITTED' };
            } } },
            content: 'Synthetic existing review content for edit regression.', categories: ['한식'],
            existingFoodPhotos: [existing], removedPhotos: [], newFoodPhotos: [],
            getEditableFoodPhotoValues,
            setIsSubmitting() {}, setIsDeleting() {}, setCleanupFailureMessage() {}, setRetryKind() {}, setCanCancelMissingUpload() {}, reviewMutationMessage: () => 'COMMITTED',
            toast() {}, deleteEditDraft: async () => { calls.draft++; }, onSuccess: () => { calls.success++; },
            handleClose: () => { calls.close++; },
        }) as (kind: string) => Promise<void>;
        await execute('edit');
        expect(calls).toEqual({ update: 1, close: 1, draft: 1, success: 1 });
        expect(submitted.ownerId).toBe('fixture-owner'); expect(submitted.reviewId).toBe('fixture-review'); expect(submitted.kind).toBe('edit');
        expect(submitted.edit).toEqual({ content: 'Synthetic existing review content for edit regression.', categories: ['한식'],
            foodPhotos: [existing], files: [], original });
    });
});

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

describe('actual draft handlers and IndexedDB deletion boundary', () => {
    test('awaits in-flight autosave then prepared cleanup and suppresses late autosave', async () => {
        const writeEntered = gate(); const writeDone = gate(); const deleteEntered = gate(); const deleteDone = gate();
        let exists = false; let writes = 0; let deletes = 0; let completed = false;
        const draftModule = readFileSync(join(import.meta.dir, '../lib/reviewDraftDB.ts'), 'utf8');
        const deleteDraft = evaluate(`${nodeText(draftModule, 'deleteDraft')}\ndeleteDraft;`, {
            isValidIdentifier: () => true, STORE_NAME: 'review-drafts',
            initDB: async () => ({ delete: async () => { deletes++; deleteEntered.resolve(); await deleteDone.promise; exists = false; } }),
        }) as (owner: string, restaurant: string) => Promise<void>;
        const bindings = {
            user: { id: 'fixture-owner' }, selectedRestaurant: { id: 'fixture-restaurant' }, restaurant: null,
            visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'], content: 'Synthetic draft text',
            verificationPhoto: null, foodPhotos: [], currentStep: 3, useCallback: (callback: unknown) => callback,
            submitInFlightRef: { current: false }, closeRequestedRef: { current: false },
            autoSaveInFlightRef: { current: null as Promise<void> | null },
            draftScopeRef: { current: { ownerId: 'fixture-owner', restaurantId: 'fixture-restaurant', revision: null } },
            saveOwnerRef: { current: 'fixture-owner' }, composerOpenRef: { current: true },
            saveOperationRef: { current: { clearSavedDraft: async () => { await deleteDraft('fixture-owner', 'fixture-restaurant'); return true; } } },
            setIsSaving() {}, setLastSavedAt() {}, deleteDraft,
            saveDraft: async () => { writes++; writeEntered.resolve(); await writeDone.promise; exists = true; },
        };
        const autoSave = evaluate(`${nodeText(source, 'autoSave')};`, bindings) as () => Promise<void>;
        const clearDraft = evaluate(`${nodeText(source, 'clearDraft')};`, bindings) as () => Promise<boolean>;
        const earlySave = autoSave(); await writeEntered.promise;
        bindings.submitInFlightRef.current = true;
        const clearing = clearDraft().then(value => { completed = true; return value; });
        await autoSave(); expect(writes).toBe(1); expect(deletes).toBe(0);
        writeDone.resolve(); await earlySave; await deleteEntered.promise;
        expect(exists).toBe(true); expect(completed).toBe(false);
        deleteDone.resolve(); expect(await clearing).toBe(true); expect(exists).toBe(false);
        bindings.closeRequestedRef.current = true; bindings.submitInFlightRef.current = false;
        await autoSave(); expect(writes).toBe(1); expect(exists).toBe(false);
    });
    test('clearDraft reports deletion failure rather than acknowledging cleanup', async () => {
        const clearDraft = evaluate(`${nodeText(source, 'clearDraft')};`, {
            useCallback: (callback: unknown) => callback, user: { id: 'fixture-owner' },
            selectedRestaurant: { id: 'fixture-restaurant' }, restaurant: null,
            autoSaveInFlightRef: { current: null }, setLastSavedAt() {},
            saveOperationRef: { current: { clearSavedDraft: async () => { throw new Error('synthetic'); } } },
        }) as () => Promise<boolean>;
        expect(await clearDraft()).toBe(false);
    });
});


// Execute the real DB validators/save/read/compare-delete with a deterministic
// transaction transport. The companion browser regression uses actual IDB.
function revisionFixture() {
    const f = fixture();
    let now = Date.now() - 1000;
    let stored: Record<string, unknown> | undefined;
    let failCapture = false;
    let failDelete = false;
    const events = { captures: 0, deletes: 0 };
    const read = () => stored && structuredClone(stored);
    const db = {
        get: async () => { if (failCapture) throw Error('SYNTHETIC_IO'); return read(); },
        transaction: () => ({
            store: {
                put: async (row: Record<string, unknown>) => { stored = structuredClone(row); },
                get: async () => read(),
                delete: async () => { if (failDelete) throw Error('SYNTHETIC_IO'); events.deletes++; stored = undefined; },
            }, done: Promise.resolve(),
        }), close() {},
    };
    const draftSource = readFileSync(join(import.meta.dir, '../lib/reviewDraftDB.ts'), 'utf8');
    const api = evaluate(draftSource.replace(/^import .* from 'idb';\n/, '') + `
        initDB = async () => fixtureDB;
        sweepExpiredOrInvalidDrafts = async () => {};
        enforceUserDraftLimit = async () => {};
        ({ saveDraft, getDraft, prepareDraftDeletion });`, {
        fixtureDB: db, TextEncoder, Date: class extends Date { static now() { return now; } },
    }) as Pick<typeof import('../lib/reviewDraftDB'), 'saveDraft' | 'getDraft' | 'prepareDraftDeletion'>;
    f.setPrepareDeletion(async (...args) => { events.captures++; return Reflect.apply(api.prepareDraftDeletion, null, args); });
    const bindings = {
        ...f.bindings, currentStep: 3, useCallback: (fn: unknown) => fn,
        ...api, setIsSaving() {}, setLastSavedAt() {},
        setVisitedDate() {}, setVisitedTime() {}, setCategories() {}, setContent() {}, setCurrentStep() {},
        replaceVerificationPhoto() {}, setFoodPhotos() {}, REVIEW_FORM_STEPS: [{ id: 1 }, { id: 2 }, { id: 3 }],
    };
    bindings.clearDraft = evaluate(nodeText(source, 'clearDraft') + ';', bindings) as () => Promise<boolean>;
    const submit = () => (evaluate(nodeText(source, 'handleSubmit') + ';', bindings) as () => Promise<void>)();
    const autoSave = () => (evaluate(nodeText(source, 'autoSave') + ';', bindings) as () => Promise<void>)();
    const load = () => (evaluate(nodeText(source, 'loadDraft') + ';', bindings) as () => Promise<void>)();
    const input = (content = f.bindings.content) => ({ userId: 'fixture-owner', restaurantId: 'fixture-restaurant',
        visitedDate: f.bindings.visitedDate, visitedTime: f.bindings.visitedTime, categories: ['한식'], content, currentStep: 3 as const });
    return { f, bindings, api, events, submit, autoSave, load, input, read,
        tick: (ms = 1) => { now += ms; }, failCapture: (value: boolean) => { failCapture = value; },
        failDelete: (value: boolean) => { failDelete = value; } };
}

describe('composer-owned draft revisions', () => {
    test('pre-capture B saved at the same key survives A submit', async () => {
        const s = revisionFixture(); await s.autoSave(); s.tick();
        await s.api.saveDraft(s.input('Independent composer B synthetic text'));
        const replacement = s.read(); await s.submit();
        expect(s.f.counts.inserts).toBe(1); expect(s.f.counts.success).toBe(1);
        expect(s.read()).toEqual(replacement); expect(s.events.deletes).toBe(0);
    });
    test.each(['upload', 'insert'])('fully compensated %s rejection refreshes same-composer autosave timestamp on retry', async kind => {
        const s = revisionFixture(); await s.autoSave();
        if (kind === 'upload') s.f.setUploadError({ statusCode: '403' }); else s.f.setMode('denied');
        await s.submit(); expect(s.f.objects.size).toBe(0); expect(s.f.counts.success).toBe(0);
        const before = s.read(); s.tick(); await s.autoSave();
        expect(s.read()?.savedAt).not.toBe(before?.savedAt);
        s.f.setUploadError(null); s.f.setMode('normal'); await s.submit();
        expect(s.read()).toBeUndefined(); expect(s.f.rows.size).toBe(1);
        expect(s.f.counts.success).toBe(1); expect(s.events.captures).toBe(2);
    });
    test('no own revision cannot delete an existing row; restored revision can', async () => {
        const unowned = revisionFixture(); await unowned.api.saveDraft(unowned.input());
        const row = unowned.read(); await unowned.submit();
        expect(unowned.read()).toEqual(row); expect(unowned.events.deletes).toBe(0);
        const restored = revisionFixture(); await restored.api.saveDraft(restored.input());
        await restored.load(); await restored.submit();
        expect(restored.read()).toBeUndefined(); expect(restored.events.deletes).toBe(1);
    });
    test('absent owned row never authorizes a subsequently saved row', async () => {
        const s = revisionFixture();
        const cleanup = await s.api.prepareDraftDeletion('fixture-owner', 'fixture-restaurant', null);
        await s.autoSave(); const row = s.read();
        expect(await cleanup()).toBe(true); expect(s.read()).toEqual(row);
    });
    test('B timestamp-only replacement before capture survives', async () => {
        const s = revisionFixture(); await s.autoSave(); s.tick();
        await s.api.saveDraft(s.input()); const row = s.read(); await s.submit();
        expect(s.read()).toEqual(row); expect(s.events.deletes).toBe(0);
    });
    test('compensated retry cannot acquire B revision from the current IDB row', async () => {
        const s = revisionFixture(); await s.autoSave(); s.f.setMode('denied'); await s.submit();
        s.tick(); await s.api.saveDraft(s.input('Composer B after compensation'));
        const row = s.read(); s.f.setMode('normal'); await s.submit();
        expect(s.read()).toEqual(row); expect(s.events.captures).toBe(2);
    });
    test.each(['unknown-insert', 'unanswered-upload'])('%s never refreshes to a later same-composer autosave', async kind => {
        const s = revisionFixture(); await s.autoSave();
        if (kind === 'unknown-insert') s.f.setMode('lost-read-fails'); else s.f.setUploadError({ statusCode: '503' });
        await s.submit(); s.tick(); await s.autoSave(); const row = s.read();
        s.f.setMode('normal'); s.f.setUploadError(null); await s.submit();
        expect(s.f.counts.success).toBe(1); expect(s.events.captures).toBe(1);
        expect(s.read()).toEqual(row); expect(s.events.deletes).toBe(0);
    });
    test('known commit cleanup retry retains original revision after later autosave', async () => {
        const s = revisionFixture(); await s.autoSave(); s.failDelete(true); await s.submit();
        expect(s.f.recoveryStates).toEqual(['draft-cleanup']);
        s.tick(); await s.autoSave(); const row = s.read(); s.failDelete(false); await s.submit();
        expect(s.events.captures).toBe(1); expect(s.f.counts.inserts).toBe(1);
        expect(s.read()).toEqual(row); expect(s.f.counts.success).toBe(1);
    });
    test('capture IO failure blocks writes and retry uses only the remembered revision', async () => {
        const s = revisionFixture(); await s.autoSave(); s.failCapture(true); await s.submit();
        expect(s.f.counts.uploads).toBe(0); expect(s.f.counts.inserts).toBe(0);
        s.failCapture(false); s.tick(); await s.api.saveDraft(s.input('Composer B during capture failure'));
        const row = s.read(); await s.submit();
        expect(s.f.counts.success).toBe(1); expect(s.events.captures).toBe(2); expect(s.read()).toEqual(row);
    });
    test('scope mismatch cannot grant cleanup authority', async () => {
        const s = revisionFixture(); await s.autoSave(); const row = s.read();
        const other = { ...s.f.bindings.draftScopeRef.current.revision!, restaurantId: 'another-restaurant' };
        const cleanup = await s.api.prepareDraftDeletion('fixture-owner', 'fixture-restaurant', other);
        expect(await cleanup()).toBe(true); expect(s.read()).toEqual(row);
    });
    test.each(['autoSave', 'loadDraft'])('late %s completion cannot restore old scope authority', async name => {
        const s = revisionFixture(); await s.autoSave(); const entered = gate(); const done = gate();
        const local = { ...s.bindings,
            saveDraft: async () => { entered.resolve(); await done.promise; return s.api.getDraft('fixture-owner', 'fixture-restaurant'); },
            getDraft: async () => { entered.resolve(); await done.promise; return s.api.getDraft('fixture-owner', 'fixture-restaurant'); },
        };
        const run = evaluate(nodeText(source, name) + ';', local) as () => Promise<void>;
        const pending = run(); await entered.promise;
        // Even A -> B -> A receives a fresh scope object.
        s.bindings.draftScopeRef.current = { ownerId: 'fixture-owner', restaurantId: 'fixture-restaurant', revision: null };
        done.resolve(); await pending;
        expect(s.bindings.draftScopeRef.current.revision).toBeNull();
    });

    test('expired owned revision cannot block submit or acquire a fresh B row', async () => {
        const s = revisionFixture(); await s.autoSave(); s.tick(86_400_001);
        await s.api.saveDraft(s.input('Fresh composer B after TTL')); const row = s.read();
        await s.submit(); expect(s.f.counts.success).toBe(1); expect(s.read()).toEqual(row);
    });

});
