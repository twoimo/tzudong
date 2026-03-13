import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import {
    getAdjacentRestaurantByStep,
    getDesktopArrowNavigationStep,
    handleDesktopArrowNavigationEvent,
    isEditableOrInteractiveKeyboardTarget,
} from '../lib/home-map-keyboard-navigation';

const makeRestaurant = (id: string, name: string): Restaurant => ({
    id,
    name,
    lat: 37.5,
    lng: 127.0,
} as Restaurant);

describe('home map keyboard navigation guards', () => {
    test('returns step for ArrowRight when guard passes', () => {
        const step = getDesktopArrowNavigationStep({
            event: { key: 'ArrowRight' },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
        });

        expect(step).toBe(1);
    });

    test('returns step for ArrowLeft when guard passes', () => {
        const step = getDesktopArrowNavigationStep({
            event: { key: 'ArrowLeft' },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 3,
        });

        expect(step).toBe(-1);
    });

    test('returns null for editable target', () => {
        const step = getDesktopArrowNavigationStep({
            event: {
                key: 'ArrowRight',
                target: { tagName: 'input' },
            },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
        });

        expect(step).toBeNull();
    });

    test('returns null for interactive target', () => {
        const step = getDesktopArrowNavigationStep({
            event: {
                key: 'ArrowRight',
                target: {
                    tagName: 'DIV',
                    closest: (selector: string) => (selector.includes('[role="button"]') ? {} : null),
                },
            },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
        });

        expect(step).toBeNull();
    });

    test('returns null when modifiers or composition are active', () => {
        const cases = [
            { key: 'ArrowRight', isComposing: true },
            { key: 'ArrowRight', metaKey: true },
            { key: 'ArrowRight', ctrlKey: true },
            { key: 'ArrowRight', altKey: true },
            { key: 'ArrowRight', defaultPrevented: true },
        ];

        for (const eventCase of cases) {
            const step = getDesktopArrowNavigationStep({
                event: eventCase,
                isDesktop: true,
                isPanelOpen: true,
                hasCurrentRestaurant: true,
                swipeableCount: 2,
            });
            expect(step).toBeNull();
        }
    });

    test('recognizes contenteditable target', () => {
        expect(isEditableOrInteractiveKeyboardTarget({ isContentEditable: true })).toBe(true);
        expect(
            isEditableOrInteractiveKeyboardTarget({
                tagName: 'DIV',
                closest: (selector: string) => (selector === '[contenteditable]' ? {} : null),
            })
        ).toBe(true);
    });
});

describe('home map keyboard adjacent restaurant selection', () => {
    test('selects next and previous restaurant by step', () => {
        const r1 = makeRestaurant('r1', 'one');
        const r2 = makeRestaurant('r2', 'two');
        const r3 = makeRestaurant('r3', 'three');
        const restaurants = [r1, r2, r3];
        const isSameRestaurant = (a: Restaurant, b: Restaurant) => a.id === b.id;

        const next = getAdjacentRestaurantByStep({
            restaurants,
            currentRestaurant: r2,
            step: 1,
            isSameRestaurant,
        });
        const prev = getAdjacentRestaurantByStep({
            restaurants,
            currentRestaurant: r2,
            step: -1,
            isSameRestaurant,
        });

        expect(next?.id).toBe('r3');
        expect(prev?.id).toBe('r1');
    });

    test('returns null on boundary and never selects outside current list (mode boundary safety)', () => {
        const domestic1 = makeRestaurant('d1', 'domestic-1');
        const domestic2 = makeRestaurant('d2', 'domestic-2');
        const overseas1 = makeRestaurant('o1', 'overseas-1');
        const domesticList = [domestic1, domestic2];
        const isSameRestaurant = (a: Restaurant, b: Restaurant) => a.id === b.id;

        const boundaryNext = getAdjacentRestaurantByStep({
            restaurants: domesticList,
            currentRestaurant: domestic2,
            step: 1,
            isSameRestaurant,
        });

        const boundaryPrev = getAdjacentRestaurantByStep({
            restaurants: domesticList,
            currentRestaurant: domestic1,
            step: -1,
            isSameRestaurant,
        });

        const resultFromCurrentList = getAdjacentRestaurantByStep({
            restaurants: domesticList,
            currentRestaurant: domestic1,
            step: 1,
            isSameRestaurant,
        });

        expect(boundaryNext).toBeNull();
        expect(boundaryPrev).toBeNull();
        expect(resultFromCurrentList?.id).toBe('d2');
        expect(resultFromCurrentList?.id).not.toBe(overseas1.id);
    });
});

describe('desktop arrow event handler', () => {
    test('moves to next and previous restaurants according to arrow key when enabled', () => {
        const steps: (-1 | 1)[] = [];
        const handled = handleDesktopArrowNavigationEvent({
            event: {
                key: 'ArrowLeft',
            },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
            onNavigate: (step) => {
                steps.push(step);
                return true;
            },
        });

        const handledNext = handleDesktopArrowNavigationEvent({
            event: {
                key: 'ArrowRight',
            },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
            onNavigate: (step) => {
                steps.push(step);
                return true;
            },
        });

        expect(handled).toBe(true);
        expect(handledNext).toBe(true);
        expect(steps).toEqual([-1, 1]);
    });

    test('does not process when desktop=false', () => {
        let called = false;
        const result = handleDesktopArrowNavigationEvent({
            event: { key: 'ArrowRight' },
            isDesktop: false,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 3,
            onNavigate: () => {
                called = true;
                return true;
            },
        });

        expect(result).toBe(false);
        expect(called).toBe(false);
    });

    test('does not process when panel is closed', () => {
        let called = false;
        const result = handleDesktopArrowNavigationEvent({
            event: { key: 'ArrowLeft' },
            isDesktop: true,
            isPanelOpen: false,
            hasCurrentRestaurant: true,
            swipeableCount: 3,
            onNavigate: () => {
                called = true;
                return true;
            },
        });

        expect(result).toBe(false);
        expect(called).toBe(false);
    });

    test('does not process when no current restaurant exists', () => {
        let called = false;
        const result = handleDesktopArrowNavigationEvent({
            event: { key: 'ArrowRight' },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: false,
            swipeableCount: 3,
            onNavigate: () => {
                called = true;
                return true;
            },
        });

        expect(result).toBe(false);
        expect(called).toBe(false);
    });

    test('does not process when swipeable count is 1', () => {
        let called = false;
        const result = handleDesktopArrowNavigationEvent({
            event: { key: 'ArrowRight' },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 1,
            onNavigate: () => {
                called = true;
                return true;
            },
        });

        expect(result).toBe(false);
        expect(called).toBe(false);
    });

    test('calls preventDefault only when movement happened', () => {
        let preventedOnMove = false;
        const moved = handleDesktopArrowNavigationEvent({
            event: {
                key: 'ArrowRight',
                preventDefault: () => {
                    preventedOnMove = true;
                },
            },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
            onNavigate: () => true,
        });

        let preventedWithoutMove = false;
        const notMoved = handleDesktopArrowNavigationEvent({
            event: {
                key: 'ArrowRight',
                preventDefault: () => {
                    preventedWithoutMove = true;
                },
            },
            isDesktop: true,
            isPanelOpen: true,
            hasCurrentRestaurant: true,
            swipeableCount: 2,
            onNavigate: () => false,
        });

        expect(moved).toBe(true);
        expect(preventedOnMove).toBe(true);
        expect(notMoved).toBe(false);
        expect(preventedWithoutMove).toBe(false);
    });
});
