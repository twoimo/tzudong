import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Local isolated browser only; no application server, configured clients, auth
// profiles, remote requests or retained user data. No browser is downloaded.
(existsSync(chrome) ? test : test.skip)('real React owner-key remount clears A inputs, unblocks B, and protects unknown A photos', async () => {
    const source = readFileSync(join(import.meta.dir, '../components/reviews/ReviewModal.tsx'), 'utf8');
    const tree = ts.createSourceFile('ReviewModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let wrapper = '';
    const lifecycle: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'ReviewModal') wrapper = node.getText(tree);
        if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useLayoutEffect'
            && /saveOwnerRef|saveOperationRef/.test(node.getText(tree))) lifecycle.push(node.getText(tree));
        ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(wrapper).toContain('key={user?.id'); expect(lifecycle.length).toBe(2);
    const script = `
        import React, { useState, useRef, useLayoutEffect } from 'react';
        import { createRoot } from 'react-dom/client';
        import { ReviewSaveOperation } from './lib/reviews/review-save-operation';
        let owner = 'owner-a', nextInstance = 0, nextId = 0;
        const rows = new Map(), objects = new Set();
        const counts = { inserts: 0, removes: 0, crossOwnerMutations: 0 };
        const useAuth = () => ({ user: owner ? { id: owner } : null });
        function createReviewSaveOperation(currentOwner) {
            return new ReviewSaveOperation({
                currentOwner, newId: () => 'fixture-review-' + (++nextId),
                prepare: async (draft, id) => [draft.verificationPhoto, ...draft.foodPhotos].map((file, i) => ({
                    file, purpose: i ? 'food' : 'verification',
                    path: draft.ownerId + '/reviews/' + id + '/' + (i ? 'food' : 'verification') + '/fixture_' + i + '.jpg',
                })),
                upload: async item => {
                    if (!item.path.startsWith(owner + '/')) counts.crossOwnerMutations++;
                    objects.add(item.path); return { error: null };
                },
                insert: async (draft, id, uploads) => {
                    counts.inserts++;
                    if (draft.ownerId !== owner) counts.crossOwnerMutations++;
                    rows.set(id, { id, user_id: draft.ownerId, restaurant_id: draft.restaurantId,
                        verification_photo: uploads[0].path, food_photos: uploads.slice(1).map(x => x.path) });
                    return { error: draft.ownerId === 'owner-a' ? { code: 'transport' } : null };
                },
                read: async (ownerId, id) => ownerId === 'owner-a'
                    ? { data: null, error: {} } : { data: rows.get(id) || null, error: null },
                cleanup: async (ownerId, id, uploads) => {
                    counts.removes++;
                    if (ownerId !== owner) counts.crossOwnerMutations++;
                    uploads.forEach(item => objects.delete(item.path)); return true;
                },
            });
        }
        ${wrapper}
        // A small real React composer probe uses the source's actual lifecycle
        // callbacks and controller. The product's auth-key boundary is unchanged.
        function ReviewComposer() {
            const { user } = useAuth();
            const [instance] = useState(() => ++nextInstance);
            const [content, setContent] = useState('');
            const [result, setResult] = useState('idle');
            const visitedDate = '2026-10-04', visitedTime = '12:00', isOpen = true;
            const [categories] = useState(['한식']);
            const [verificationPhoto] = useState(() => new File(['receipt'], 'receipt.jpg'));
            const [foodPhotos] = useState(() => [new File(['food'], 'food.jpg')]);
            const reviewTargetRestaurant = { id: 'fixture-restaurant' };
            const draftScopeRef = useRef({ ownerId: user?.id, restaurantId: reviewTargetRestaurant.id, revision: null });
            const saveOwnerRef = useRef(user?.id), saveOperationRef = useRef(null);
            const composerOpenRef = useRef(isOpen), closeRequestedRef = useRef(false), consumerNotifiedRef = useRef(false);
            const latestSaveInputsRef = useRef(null);
            ${lifecycle.join(';\n')};
            const submit = async () => setResult(await saveOperationRef.current.submit({
                ownerId: user.id, restaurantId: reviewTargetRestaurant.id, title: 'Fixture',
                content, visitedAt: '2026-10-04T12:00:00', categories, verificationPhoto, foodPhotos,
            }));
            return <div data-instance={instance}>
                <input value={content} onChange={event => setContent(event.target.value)} />
                <button id="save" onClick={submit}>save</button>
                <button id="close" onClick={async () => setResult('close-' + (await saveOperationRef.current.cancel()).status)}>close</button>
                <output>{result}</output>
            </div>;
        }
        const root = createRoot(document.getElementById('root'));
        const render = () => root.render(<ReviewModal isOpen={true} restaurant={null} onClose={() => {}} />);
        window.fixture = {
            switchOwner: value => { owner = value; render(); },
            summary: () => ({ ...counts, rows: rows.size, objects: objects.size }),
        };
        render();
    `;
    const bundle = await Bun.build({
        entrypoints: ['review-owner-fixture'], target: 'browser', format: 'iife', write: false,
        define: { 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'offline-fixture', setup(builder) {
            builder.onResolve({ filter: /^review-owner-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: script, loader: 'tsx', resolveDir: join(import.meta.dir, '..') }));
        } }],
    });
    expect(bundle.success).toBe(true);
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(5_000);
        let browserErrors = 0;
        page.on('pageerror', () => { browserErrors++; });
        await page.route('**/*', route => route.abort());
        await page.setContent('<div id="root"></div>');
        await page.addScriptTag({ content: await bundle.outputs[0].text() });
        expect(browserErrors).toBe(0);
        await page.locator('input').fill('Owner A private fixture draft');
        const instanceA = await page.locator('[data-instance]').getAttribute('data-instance');
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('output')?.textContent === 'blocked');
        await page.evaluate(() => (window as unknown as {fixture: {switchOwner(owner: string | null): void}}).fixture.switchOwner('owner-b'));
        await page.waitForFunction(() => document.querySelector('input')?.value === '');
        expect(await page.locator('[data-instance]').getAttribute('data-instance')).not.toBe(instanceA);
        expect(await page.locator('body').textContent()).not.toContain('Owner A private fixture draft');
        await page.locator('input').fill('Owner B private fixture draft');
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('output')?.textContent === 'saved');
        await page.locator('#close').click();
        await page.waitForFunction(() => document.querySelector('output')?.textContent === 'close-saved');
        const summary = await page.evaluate(() => (window as unknown as {fixture: {summary(): unknown}}).fixture.summary());
        expect(summary).toEqual({ inserts: 2, removes: 0, crossOwnerMutations: 0, rows: 2, objects: 4 });
        await page.evaluate(() => (window as unknown as {fixture: {switchOwner(owner: string | null): void}}).fixture.switchOwner(null));
        await page.waitForFunction(() => document.querySelector('input')?.value === '');
        expect(await page.locator('output').textContent()).toBe('idle');
    } finally { await browser.close(); }
}, 20_000);
