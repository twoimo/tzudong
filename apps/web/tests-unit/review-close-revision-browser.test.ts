import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle(sourceRoot: string) {
    const source = readFileSync(join(sourceRoot, 'components/reviews/ReviewModal.tsx'), 'utf8');
    const tree = ts.createSourceFile('ReviewModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nodes = new Map<string, string>();
    const lifecycle: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name) nodes.set(node.name.text, node.getText(tree));
        if (ts.isVariableDeclaration(node) && node.initializer) nodes.set(node.name.getText(tree), node.initializer.getText(tree));
        if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useLayoutEffect'
            && /saveOwnerRef|saveOperationRef/.test(node.getText(tree))) lifecycle.push(node.getText(tree));
        ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(lifecycle).toHaveLength(2);
    const handlers = ['autoSave', 'loadDraft', 'clearDraft', 'notifySavedReview', 'handleSubmit', 'handleClose']
        .map(name => { expect(nodes.has(name)).toBe(true); return `const ${name} = ${nodes.get(name)};`; }).join('\n');
    const script = `
        import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import * as db from '@revision/db';
        import { ReviewSaveOperation } from '@revision/operation';
        import { buildReviewPhotoObjectPath, normalizeReviewPhotoFilename, cleanupCanonicalReviewPhotoObjects } from './lib/review-photo-url';
        const prepareDraftDeletion = async (...args) => { const remove = await db.prepareDraftDeletion(...args); return async () => failDeletion ? false : remove(); };
        let heldSave = null, heldLoad = null, heldInsert = null, failDeletion = false;
        const saveDraft = async value => { const result = await db.saveDraft(value); if (heldSave) { heldSave.enter(); await heldSave.wait; } return result; };
        const getDraft = async (...args) => { const result = await db.getDraft(...args); if (heldLoad) { heldLoad.enter(); await heldLoad.wait; } return result; };
        const prepareReceiptImage = async file => file, compressFoodImage = async file => file;
        let owner = 'fixture-owner', mode = 'normal', now = Date.now(), nextRestaurant = 0;
        Date.now = () => now;
        const rows = new Map(), objects = new Set(), registry = new Map();
        const counts = { uploads: 0, inserts: 0, removes: 0, success: 0, closes: 0 };
        const storage = {
            async upload(path) { counts.uploads++; if (mode === 'upload-denied') return { error: { statusCode: '403' } }; objects.add(path); return { error: null }; },
            async remove(paths) { counts.removes++; paths.forEach(path => objects.delete(path)); return { error: null }; },
            async list(directory, { search }) { return { data: objects.has(directory + '/' + search) ? [{ name: search }] : [], error: null }; },
        };
        const supabase = {
            storage: { from: () => storage },
            from: () => ({
                async insert(row) { counts.inserts++; if (mode === 'insert-denied') return { error: { code: '42501' } }; rows.set(row.id, row); if (heldInsert) { heldInsert.enter(); await heldInsert.wait; } return { error: null }; },
                select() { const filters = {}; const q = { eq(key, value) { filters[key] = value; return q; }, async maybeSingle() { return { data: rows.get(filters.id) || null, error: null }; } }; return q; },
            }),
        };
        const useAuth = () => ({ user: { id: owner } });
        const REVIEW_FORM_STEPS = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const toast = () => {};
        ${nodes.get('createReviewSaveOperation')}
        ${nodes.get('ReviewModal')}
        function ReviewComposer({ isOpen, restaurant, label, initialContent }) {
            const { user } = useAuth();
            const selectedRestaurant = null, reviewTargetRestaurant = restaurant;
            const [visitedDate, setVisitedDate] = useState('2026-10-04');
            const [visitedTime, setVisitedTime] = useState('12:00');
            const [categories, setCategories] = useState(['한식']);
            const [content, setContent] = useState(initialContent);
            const [verificationPhoto, replaceVerificationPhoto] = useState(() => new File(['synthetic'], 'receipt.jpg'));
            const [foodPhotos, setFoodPhotos] = useState(() => [new File(['synthetic'], 'food.jpg')]);
            const [currentStep, setCurrentStep] = useState(3);
            const [, setIsSubmitting] = useState(false), [, setIsSaving] = useState(false), [, setLastSavedAt] = useState(null), [, setSaveRecovery] = useState(null);
            const saveOwnerRef = useRef(user.id), saveOperationRef = useRef(null), submitInFlightRef = useRef(false);
            const closeRequestedRef = useRef(false), composerOpenRef = useRef(isOpen), consumerNotifiedRef = useRef(false), autoSaveInFlightRef = useRef(null);
            const draftScopeRef = useRef({ ownerId: user.id, restaurantId: restaurant.id, revision: null });
            const latestSaveInputsRef = useRef({ visitedDate, visitedTime, categories, content, verificationPhoto, foodPhotos, restaurantId: restaurant.id });
            ${lifecycle.join(';\n')};
            const onSuccess = () => { counts.success++; };
            const onClose = () => { counts.closes++; };
            const ocrAbortControllerRef = useRef(null);
            const setVerificationInputMode = () => {}, setForceOcrRefresh = () => {}, setOcrFocusTarget = () => {}, setOcrProgress = () => {}, setOcrFallbackNotice = () => {}, setAiFilledFields = () => {};
            ${handlers}
            useLayoutEffect(() => { registry.set(label, { autoSave, loadDraft, handleSubmit, handleClose, setContent, draftScopeRef, content }); });
            return <output>{content}</output>;
        }
        function mount(label, restaurantId, initialContent = 'Synthetic composer text with sufficient length.') {
            const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
            const render = id => flushSync(() => root.render(<ReviewModal label={label} initialContent={initialContent} isOpen={true} restaurant={{ id, name: 'Fixture' }} />));
            render(restaurantId);
            return { get current() { return registry.get(label); }, render, close() { flushSync(() => root.unmount()); host.remove(); } };
        }
        function barrier() { let enter, release; const entered = new Promise(resolve => { enter = resolve; }); const wait = new Promise(resolve => { release = resolve; }); return { enter, entered, wait, release }; }
        window.run = async () => {
            const result = {};
            const id = () => 'fixture-restaurant-' + (++nextRestaurant);
            const firstId = id(); const a = mount('a', firstId); const b = mount('b', firstId, 'Independent composer B synthetic bounded text.');
            await a.current.autoSave(); now++; await b.current.autoSave();
            const beforeB = await db.getDraft(owner, firstId); await a.current.handleSubmit();
            result.preCaptureBPreserved = JSON.stringify(await db.getDraft(owner, firstId)) === JSON.stringify(beforeB);
            a.close(); b.close();
            for (const kind of ['upload', 'insert']) {
                const restaurant = id(); const composer = mount(kind, restaurant);
                await composer.current.autoSave(); const before = await db.getDraft(owner, restaurant);
                mode = kind + '-denied'; await composer.current.handleSubmit();
                const compensated = objects.size === 2; // Only A's successful review from the prior scene.
                now++; await composer.current.autoSave(); const after = await db.getDraft(owner, restaurant);
                mode = 'normal'; await composer.current.handleSubmit();
                result[kind + 'RetryClearsOwnRevision'] = compensated && before.savedAt !== after.savedAt && await db.getDraft(owner, restaurant) === null;
                composer.close();
                // Keep only first scene's two objects for the next compensation check.
                for (const path of [...objects]) if (rows.get(path.split('/')[2])?.restaurant_id === restaurant) objects.delete(path);
            }
            for (const kind of ['save', 'load']) {
                const restaurant = id(); const composer = mount('late-' + kind, restaurant);
                const input = { userId: owner, restaurantId: restaurant, currentStep: 3, visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'], content: 'Synthetic stored text for delayed load completion.' };
                await db.saveDraft(input); const barrierState = barrier();
                if (kind === 'save') heldSave = barrierState; else heldLoad = barrierState;
                const pending = kind === 'save' ? composer.current.autoSave() : composer.current.loadDraft();
                await barrierState.entered;
                composer.render(id()); composer.render(restaurant);
                barrierState.release(); await pending;
                heldSave = null; heldLoad = null;
                result[kind + 'ScopeFence'] = composer.current.draftScopeRef.current.revision === null;
                composer.close();
            }
            for (const kind of ['no-autosave', 'newer-autosave', 'cleanup-retry', 'unmount-changed']) {
                const restaurant = id(); const composer = mount('close-' + kind, restaurant);
                await composer.current.autoSave(); const savedA = await db.getDraft(owner, restaurant);
                const before = {...counts}; const wait = barrier(); heldInsert = wait;
                const pending = composer.current.handleSubmit(); await wait.entered;
                flushSync(() => composer.current.setContent('Changed synthetic B input while committed A reply is held.'));
                if (kind === 'cleanup-retry') failDeletion = true;
                if (kind === 'unmount-changed') composer.close();
                wait.release(); await pending; heldInsert = null;
                await new Promise(requestAnimationFrame);
                if (kind === 'unmount-changed') {
                    result.unmountChangedClearsOnlyA = await db.getDraft(owner, restaurant) === null && counts.success === before.success && counts.removes === before.removes && counts.inserts === before.inserts + 1;
                    continue;
                }
                if (kind === 'newer-autosave') {
                    now++; await composer.current.autoSave();
                    const savedB = await db.getDraft(owner, restaurant);
                    await composer.current.handleClose();
                    result.newerAutosaveSurvivesClose = savedB?.content.includes('Changed synthetic B') && JSON.stringify(await db.getDraft(owner, restaurant)) === JSON.stringify(savedB);
                } else if (kind === 'cleanup-retry') {
                    await composer.current.handleClose();
                    const blocked = counts.closes === before.closes && JSON.stringify(await db.getDraft(owner, restaurant)) === JSON.stringify(savedA);
                    failDeletion = false; await composer.current.handleClose();
                    result.changedCleanupFailureBlocksAndRetries = blocked && await db.getDraft(owner, restaurant) === null && counts.closes === before.closes + 1 && counts.inserts === before.inserts + 1 && counts.removes === before.removes;
                } else {
                    await composer.current.handleClose();
                    const gone = await db.getDraft(owner, restaurant) === null;
                    composer.close(); const reopened = mount('reopened-close', restaurant, ''); await reopened.current.loadDraft(); await new Promise(requestAnimationFrame);
                    result.changedBeforeAutosaveDoesNotRestoreCommittedA = gone && reopened.current.content === '' && counts.inserts === before.inserts + 1 && counts.removes === before.removes;
                    reopened.close(); continue;
                }
                composer.close();
            }
            const restaurant = id();
            const committed = await db.saveDraft({ userId: owner, restaurantId: restaurant, currentStep: 3, visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'], content: 'Synthetic privacy row', verificationPhoto: new File(['synthetic'], 'receipt.jpg'), foodPhotos: ['blob:excluded'] });
            const database = await new Promise((resolve, reject) => { const request = indexedDB.open('tzudong-review-drafts', 3); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
            const persisted = await new Promise(resolve => { const request = database.transaction('review-drafts').objectStore('review-drafts').get([owner, restaurant]); request.onsuccess = () => resolve(request.result); });
            result.committedBoundedTextOnly = !!committed && Object.keys(committed).sort().join(',') === 'categories,content,currentStep,restaurantId,savedAt,userId,visitedDate,visitedTime'
                && JSON.stringify(committed) === JSON.stringify(await db.getDraft(owner, restaurant));
            result.persistedV3Unchanged = database.version === 3 && Object.keys(persisted).sort().join(',') === 'categories,content,currentStep,expiresAt,restaurantId,savedAt,userId,visitedDate,visitedTime'
                && persisted.expiresAt - Date.parse(persisted.savedAt) === 86400000;
            database.close();
            return { result, counts, cases: Object.keys(result).length };
        };
    `;
    const built = await Bun.build({
        entrypoints: ['review-revision-fixture'], target: 'browser', format: 'iife', write: false,
        plugins: [{ name: 'offline-source-revision', setup(builder) {
            builder.onResolve({ filter: /^review-revision-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: script, loader: 'tsx', resolveDir: appRoot }));
            builder.onResolve({ filter: /^@revision\// }, args => ({ path: args.path, namespace: 'revision' }));
            builder.onLoad({ filter: /.*/, namespace: 'revision' }, args => ({
                contents: readFileSync(join(sourceRoot, args.path.endsWith('/db') ? 'lib/reviewDraftDB.ts' : 'lib/reviews/review-save-operation.ts'), 'utf8'),
                loader: 'ts', resolveDir: appRoot,
            }));
        } }],
    });
    expect(built.success).toBe(true);
    return built.outputs[0].text();
}

// One isolated browser process, no configured SDK, server, profile or remote I/O.
// Optional frozen baseline comparison stays inside this same process.
(existsSync(chrome) ? test : test.skip)('real React and IDB composer revision orderings', async () => {
    const roots = [{ phase: 'after', root: appRoot }];
    if (process.env.TZUDONG_REVIEW_CLOSE_BASELINE) roots.unshift({ phase: 'baseline', root: process.env.TZUDONG_REVIEW_CLOSE_BASELINE });
    const scripts = await Promise.all(roots.map(async entry => ({ ...entry, script: await bundle(entry.root) })));
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const reports: unknown[] = [];
    try {
        for (const entry of scripts) {
            const context = await browser.newContext(); const page = await context.newPage();
            let externalRequests = 0, pageErrors = 0;
            page.on('pageerror', () => { pageErrors++; });
            await page.route('**/*', route => {
                if (route.request().url() === 'https://draft-revision.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
                externalRequests++; return route.abort();
            });
            await page.goto('https://draft-revision.test/'); await page.addScriptTag({ content: entry.script });
            const report = await page.evaluate(async () => (window as unknown as { run(): Promise<{ result: Record<string, boolean>; cases: number }> }).run());
            reports.push({ phase: entry.phase, ...report, externalRequests, pageErrors });
            expect(externalRequests).toBe(0); expect(pageErrors).toBe(0);
            expect(report.cases).toBe(11);
            if (entry.phase === 'baseline') {
                expect(report.result.preCaptureBPreserved).toBe(true);
                expect(report.result.uploadRetryClearsOwnRevision).toBe(true);
                expect(report.result.insertRetryClearsOwnRevision).toBe(true);
                expect(report.result.changedBeforeAutosaveDoesNotRestoreCommittedA).toBe(false);
                expect(report.result.unmountChangedClearsOnlyA).toBe(false);
                expect(report.result.changedCleanupFailureBlocksAndRetries).toBe(false);
            } else for (const passed of Object.values(report.result)) expect(passed).toBe(true);
            await context.close();
        }
    } finally {
        await browser.close();
        if (process.env.TZUDONG_REVIEW_CLOSE_EVIDENCE) writeFileSync(process.env.TZUDONG_REVIEW_CLOSE_EVIDENCE, JSON.stringify({ browserProcesses: 1, reports }, null, 2) + '\n');
    }
}, 30_000);
