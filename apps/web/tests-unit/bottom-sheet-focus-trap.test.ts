import { describe, expect, test } from 'bun:test';

import {
    BOTTOM_SHEET_BACKDROP_ATTRIBUTE,
    DEFAULT_FOCUS_TRAP_ALLOW_SELECTORS,
    getFocusTrapContainers,
    isInsideAllowedFocusRegion,
    resolveBottomSheetHeightRequest,
    shouldHideModalSibling,
} from '../components/ui/bottom-sheet';

type FakeNode = { id: string };

type FakeContainer = {
    id: string;
    contains: (target: FakeNode) => boolean;
};

function createContainer(id: string, allowedNodeIds: string[]): FakeContainer {
    return {
        id,
        contains: (target: FakeNode) => allowedNodeIds.includes(target.id),
    };
}

describe('bottom sheet focus trap helpers', () => {
    test('collects the primary container first and appends allowed portal containers', () => {
        const primary = createContainer('sheet', ['sheet-button']);
        const portal = createContainer('portal', ['portal-option']);
        const popper = createContainer('popper', ['popper-option']);

        const queryRoot = {
            querySelectorAll(selector: string) {
                if (selector === '[data-radix-portal]') return [portal];
                if (selector === '[data-radix-popper-content-wrapper]') return [popper];
                return [];
            },
        };

        const containers = getFocusTrapContainers(primary, DEFAULT_FOCUS_TRAP_ALLOW_SELECTORS, queryRoot);
        expect(containers).toEqual([primary, portal, popper]);
    });

    test('treats targets inside allowed portal containers as inside the focus region', () => {
        const primary = createContainer('sheet', ['sheet-button']);
        const portal = createContainer('portal', ['portal-option']);

        const queryRoot = {
            querySelectorAll(selector: string) {
                if (selector === '[data-radix-portal]') return [portal];
                return [];
            },
        };

        expect(
            isInsideAllowedFocusRegion({ id: 'portal-option' } as FakeNode as Node, primary, ['[data-radix-portal]'], queryRoot)
        ).toBe(true);

        expect(
            isInsideAllowedFocusRegion({ id: 'outside' } as FakeNode as Node, primary, ['[data-radix-portal]'], queryRoot)
        ).toBe(false);
    });

    test('allows callers to disable portal allowances with an empty selector list', () => {
        const primary = createContainer('sheet', ['sheet-button']);
        const portal = createContainer('portal', ['portal-option']);

        const queryRoot = {
            querySelectorAll() {
                return [portal];
            },
        };

        expect(
            isInsideAllowedFocusRegion({ id: 'portal-option' } as FakeNode as Node, primary, [], queryRoot)
        ).toBe(false);
    });
});

describe('bottom sheet modal sibling hiding', () => {
    const sheet = { id: 'sheet' } as unknown as Node;

    function candidate({
        id,
        tagName = 'DIV',
        containsSheet = false,
        isBackdrop = false,
    }: {
        id: string;
        tagName?: string;
        containsSheet?: boolean;
        isBackdrop?: boolean;
    }) {
        return {
            id,
            tagName,
            contains: (target: Node) => containsSheet && target === sheet,
            hasAttribute: (name: string) => isBackdrop && name === BOTTOM_SHEET_BACKDROP_ATTRIBUTE,
        } as const;
    }

    test('keeps the backdrop interactive while hiding app siblings', () => {
        const current = candidate({ id: 'current-sheet' }) as unknown as Node;

        expect(shouldHideModalSibling(candidate({ id: 'app-root' }), current, sheet)).toBe(true);
        expect(shouldHideModalSibling(candidate({ id: 'backdrop', isBackdrop: true }), current, sheet)).toBe(false);
    });

    test('does not hide the current modal branch or inert-safe document elements', () => {
        const current = candidate({ id: 'current-sheet' });

        expect(shouldHideModalSibling(current, current as unknown as Node, sheet)).toBe(false);
        expect(shouldHideModalSibling(candidate({ id: 'parent', containsSheet: true }), current as unknown as Node, sheet)).toBe(false);
        expect(shouldHideModalSibling(candidate({ id: 'style', tagName: 'STYLE' }), current as unknown as Node, sheet)).toBe(false);
    });
});

describe('bottom sheet height requests', () => {
    test('expands a peek sheet to the requested height without shrinking current height', () => {
        expect(resolveBottomSheetHeightRequest({
            currentHeight: 25,
            requestedHeight: 50,
            minHeight: 25,
            maxHeight: 90,
        })).toBe(50);

        expect(resolveBottomSheetHeightRequest({
            currentHeight: 70,
            requestedHeight: 50,
            minHeight: 25,
            maxHeight: 90,
        })).toBe(70);
    });

    test('clamps requested height inside the sheet bounds', () => {
        expect(resolveBottomSheetHeightRequest({
            currentHeight: 25,
            requestedHeight: 120,
            minHeight: 25,
            maxHeight: 88,
        })).toBe(88);
    });
});
