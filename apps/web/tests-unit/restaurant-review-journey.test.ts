import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import ts from 'typescript';
import { Button } from '../components/ui/button';
import {
    collectDirectRestaurantReviewIds,
    getRestaurantReviewLookupName,
    selectRelatedRestaurantReviewIds,
} from '../lib/restaurant-review-lookup';
import { getRestaurantSubmissionFieldErrors, validateRestaurantSubmissionStep } from '../lib/restaurant-submission-flow';

const parse = (path: string) => ts.createSourceFile(path,
    readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const detail = parse('../components/restaurant/RestaurantDetailPanel.tsx');
const card = parse('../components/reviews/ReviewCard.tsx');
const composer = parse('../components/reviews/ReviewModal.tsx');
const editor = parse('../components/reviews/ReviewEditModal.tsx');
const submission = parse('../components/modals/RestaurantSubmissionModal.tsx');

// Execute production closures without mounting auth, map or media services.
// Boundaries contain only synthetic, in-memory data and never make requests.
function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
    let match: ts.Node | undefined;
    function visit(node: ts.Node) {
        if (!match && predicate(node)) match = node;
        if (!match) ts.forEachChild(node, visit);
    }
    visit(source);
    if (!match) throw new Error('Missing production test boundary');
    return match;
}

function execute<T>(node: ts.Node, source: ts.SourceFile, bindings: Record<string, unknown>): T {
    const compiled = ts.transpileModule(`return (${node.getText(source)});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'createElement' },
    }).outputText;
    return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T;
}

function callback(source: ts.SourceFile, name: string) {
    const declaration = find(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration;
    const initializer = declaration.initializer!;
    return ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer;
}

function reviewQuery(result: { data: unknown[] | null; error: unknown }) {
    const queryFn = find(detail, node => ts.isPropertyAssignment(node) && node.name.getText(detail) === 'queryFn'
        && node.initializer.getText(detail).includes('REVIEW_PAGE_SIZE')) as ts.PropertyAssignment;
    const filters: Array<[string, unknown]> = [];
    const chain = {
        select: () => chain,
        in: (column: string, values: unknown) => { filters.push([column, values]); return chain; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
        order: () => chain,
        range: async () => result,
    };
    const run = execute<(page: { pageParam?: number }) => Promise<unknown>>(queryFn.initializer, detail, {
        restaurant: { id: 'synthetic-restaurant', name: '', mergedRestaurants: [] },
        collectDirectRestaurantReviewIds, getRestaurantReviewLookupName, selectRelatedRestaurantReviewIds,
        supabase: { from: () => chain },
        RESTAURANT_DETAIL_REVIEW_SELECT: 'id',
    });
    return { run, filters };
}

describe('restaurant review read recovery', () => {
    test('an unavailable read rejects safely instead of becoming an empty review list', async () => {
        const { run } = reviewQuery({ data: null, error: { message: 'synthetic provider diagnostic' } });
        await expect(run({})).rejects.toThrow('RESTAURANT_REVIEWS_UNAVAILABLE');
    });

    test('a successful empty read remains empty and retains the approved restaurant scope', async () => {
        const { run, filters } = reviewQuery({ data: [], error: null });
        expect(await run({})).toEqual({ restaurantId: 'synthetic-restaurant', reviews: [], nextCursor: null });
        expect(filters).toContainEqual(['restaurant_id', ['synthetic-restaurant']]);
        expect(filters).toContainEqual(['is_verified', true]);
    });

    test('a failed next page waits for deliberate retry instead of repeating intersection requests', () => {
        for (const isFetchNextPageError of [false, true]) {
            let calls = 0;
            const run = execute<() => void>(callback(detail, 'handleLoadMoreReviews'), detail, {
                hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError,
                fetchNextPage: () => { calls += 1; },
            });
            run();
            expect(calls).toBe(isFetchNextPageError ? 0 : 1);
        }
    });

    test('retry returns to the failed read boundary and is disabled during a request', () => {
        for (const isFetchNextPageError of [false, true]) {
            for (const reviewsFetching of [false, true]) {
                const calls: string[] = [];
                const render = execute<() => ReactElement<{ children: ReactNode }>>(callback(detail, 'renderReviewLoadFailure'), detail, {
                    createElement, Button, isFetchNextPageError, reviewsFetching,
                    fetchNextPage: () => { calls.push('next'); },
                    refetchReviews: () => { calls.push('initial'); },
                });
                const button = Children.toArray(render().props.children).find(child => isValidElement(child) && child.type === Button) as ReactElement<{ disabled: boolean; onClick: () => void }>;
                expect(button.props.disabled).toBe(reviewsFetching);
                if (!reviewsFetching) button.props.onClick();
                expect(calls).toEqual(reviewsFetching ? [] : [isFetchNextPageError ? 'next' : 'initial']);
            }
        }
    });
});

function shareHandler(writeText: () => Promise<void>, isSharing = false) {
    const state: { copied: boolean[]; sharing: boolean[]; failed: boolean[]; requests: number } = {
        copied: [], sharing: [], failed: [], requests: 0,
    };
    const run = execute<(event: { stopPropagation: () => void }) => Promise<void>>(callback(card, 'handleShareClick'), card, {
        isSharing,
        review: { id: 'synthetic-review', restaurantId: 'synthetic-restaurant', restaurantName: '테스트 식당' },
        setIsSharing: (value: boolean) => state.sharing.push(value),
        setIsShareCopied: (value: boolean) => state.copied.push(value),
        setShareFailed: (value: boolean) => state.failed.push(value),
        window: { location: { origin: 'https://fixture.example' } },
        navigator: { clipboard: { writeText } },
        fetch: async () => { state.requests += 1; return { ok: false }; },
        setTimeout: () => 0,
    });
    return { run, state };
}

describe('review share feedback', () => {
    test('reports success only after the clipboard write completes', async () => {
        let complete!: () => void;
        let clipboardStarted!: () => void;
        const started = new Promise<void>(resolve => { clipboardStarted = resolve; });
        const clipboard = new Promise<void>(resolve => { complete = resolve; });
        const { run, state } = shareHandler(() => { clipboardStarted(); return clipboard; });
        const pending = run({ stopPropagation: () => {} });
        await started;
        expect(state.copied).toEqual([false]);
        expect(state.sharing).toEqual([true]);
        complete();
        await pending;
        expect(state.copied).toEqual([false, true]);
        expect(state.sharing).toEqual([true, false]);
        expect(state.failed).toEqual([false]);
    });

    test('clipboard failure provides recovery without claiming that the link was copied', async () => {
        const { run, state } = shareHandler(async () => { throw new Error('synthetic clipboard denial'); });
        await run({ stopPropagation: () => {} });
        expect(state.copied).not.toContain(true);
        expect(state.failed).toEqual([false, true]);
        expect(state.sharing).toEqual([true, false]);
    });

    test('a request already in progress does not create another short link', async () => {
        const { run, state } = shareHandler(async () => {}, true);
        await run({ stopPropagation: () => {} });
        expect(state.requests).toBe(0);
        expect(state.copied).toEqual([]);
    });
});

describe('form keyboard recovery', () => {
    test('a controlled review edit dialog restores the actual opener without a DialogTrigger', () => {
        const open = find(editor, node => ts.isJsxAttribute(node) && node.name.getText(editor) === 'onOpenAutoFocus') as ts.JsxAttribute;
        const close = find(editor, node => ts.isJsxAttribute(node) && node.name.getText(editor) === 'onCloseAutoFocus') as ts.JsxAttribute;
        class ElementBoundary {
            isConnected = true;
            focused = 0;
            focus() { this.focused += 1; }
        }
        const opener = new ElementBoundary();
        const dialogOpenerRef = { current: null as ElementBoundary | null };
        const bindings = { document: { activeElement: opener }, HTMLElement: ElementBoundary, dialogOpenerRef };
        execute<() => void>((open.initializer as ts.JsxExpression).expression!, editor, bindings)();
        let prevented = false;
        execute<(event: unknown) => void>((close.initializer as ts.JsxExpression).expression!, editor, bindings)({
            preventDefault: () => { prevented = true; },
        });
        expect(opener.focused).toBe(1);
        expect(prevented).toBe(true);
        expect(dialogOpenerRef.current).toBeNull();
    });

    test('a held review service cannot open its receipt input or accept a dropped receipt', () => {
        const input = find(composer, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(composer) === 'input'
            && node.getText(composer).includes('ref={verificationFileInputRef}'));
        const drop = find(composer, node => ts.isJsxAttribute(node) && node.name.getText(composer) === 'onDrop'
            && node.getText(composer).includes('handleVerificationDrop')) as ts.JsxAttribute;
        const handleVerificationDrop = () => {};
        for (const featureHeld of [false, true]) {
            const element = execute<ReactElement<{ disabled: boolean }>>(input, composer, {
                createElement, featureHeld, verificationFileInputRef: { current: null },
                RECEIPT_IMAGE_ACCEPT: 'image/png', handleVerificationPhotoChange: () => {},
            });
            expect(element.props.disabled).toBe(featureHeld);
            const handler = execute<unknown>((drop.initializer as ts.JsxExpression).expression!, composer, { featureHeld, handleVerificationDrop });
            expect(handler).toBe(featureHeld ? undefined : handleVerificationDrop);
        }
    });

    test('Escape uses the normal safe-close path while nested or consumed keys stay local', () => {
        for (const source of [composer, submission]) {
            const name = source === composer ? 'handleDesktopReviewDialogKeyDown' : 'handleDesktopSubmissionDialogKeyDown';
            for (const [key, defaultPrevented, contained, expected] of [
                ['Escape', false, true, 1], ['Escape', true, true, 0],
                ['Escape', false, false, 0], ['Enter', false, true, 0],
            ] as const) {
                let closed = 0;
                let prevented = 0;
                let stopped = 0;
                const run = execute<(event: unknown) => void>(callback(source, name), source, {
                    handleClose: () => { closed += 1; },
                });
                run({ key, defaultPrevented, target: {}, currentTarget: { contains: () => contained },
                    preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
                expect([closed, prevented, stopped]).toEqual([expected, expected, expected]);
            }
        }
    });

    test('closing an unmounted map composer returns focus to its connected opener', () => {
        const effect = find(composer, node => ts.isCallExpression(node) && node.expression.getText(composer) === 'useEffect'
            && node.arguments[0]?.getText(composer).includes('desktopReviewMapPanelOpenerRef.current = document.activeElement')) as ts.CallExpression;
        class ElementBoundary {
            isConnected = true;
            focused = 0;
            focus() { this.focused += 1; }
        }
        const opener = new ElementBoundary();
        const panel = new ElementBoundary();
        const openerRef = { current: null as ElementBoundary | null };
        const cancellations: number[] = [];
        const mount = execute<() => () => void>(effect.arguments[0], composer, {
            shouldRenderMapPanel: true, inline: false, isOpen: true,
            document: { activeElement: opener }, HTMLElement: ElementBoundary,
            desktopReviewMapPanelOpenerRef: openerRef,
            desktopReviewMapPanelRef: { current: panel },
            window: { requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
                cancelAnimationFrame: (id: number) => cancellations.push(id) },
        });
        const unmount = mount();
        expect(panel.focused).toBe(1);
        expect(opener.focused).toBe(0);
        unmount();
        expect(opener.focused).toBe(1);
        expect(openerRef.current).toBeNull();
        expect(cancellations).toEqual([1]);
    });

    test('submission errors identify real invalid fields using the same rules as step validation', () => {
        const valid = { restaurant_name: '테스트 식당', address: '서울특별시 테스트로 123', phone: '',
            categories: ['한식'], youtube_link: 'https://www.youtube.com/watch?v=fixture0001', description: '' };
        expect(getRestaurantSubmissionFieldErrors('new', valid)).toEqual({});
        for (const field of ['restaurant_name', 'address', 'categories', 'youtube_link'] as const) {
            const invalid = { ...valid, [field]: field === 'categories' ? [] : '' };
            expect(Object.keys(getRestaurantSubmissionFieldErrors('new', invalid))).toEqual([field]);
            expect(validateRestaurantSubmissionStep(field === 'youtube_link' ? 2 : 1, 'new', invalid)).not.toBeNull();
        }
        expect(Object.keys(getRestaurantSubmissionFieldErrors('new', { ...valid, restaurant_name: 'asdf' }))).toEqual(['restaurant_name']);
        expect(Object.keys(getRestaurantSubmissionFieldErrors('request', { ...valid, youtube_link: '' }))).toEqual(['description']);
    });

    test('failed submission focuses and reveals the first invalid field in visual order', () => {
        const actions: string[] = [];
        const focus = execute<() => void>(callback(submission, 'focusFirstInvalidField'), submission, {
            window: { requestAnimationFrame: (callback: () => void) => callback() },
            mobileFormRef: { current: { querySelector: (selector: string) => {
                expect(selector).toBe('[aria-invalid="true"]');
                return { focus: () => actions.push('focus'), scrollIntoView: () => actions.push('reveal') };
            } } },
        });
        focus();
        expect(actions).toEqual(['focus', 'reveal']);
    });
});
