import { describe, expect, test } from 'bun:test';

import {
    DEFAULT_FOCUS_TRAP_ALLOW_SELECTORS,
    getFocusTrapContainers,
    isInsideAllowedFocusRegion,
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

