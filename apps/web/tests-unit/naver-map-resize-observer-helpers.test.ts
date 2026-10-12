import { describe, expect, test } from 'bun:test';

import {
    buildNaverResizeObserverCleanup,
    buildNaverResizeObserverHandler,
    shouldResizeNaverObservedMap,
} from '../lib/naver-map-resize-observer-helpers';

describe('naver observed map size', () => {
    const size = () => ({ map: {}, target: {} as Element, width: 390, height: 784 });

    test('skips only repeated size reports of the same map and element', () => {
        const current = size();
        expect(shouldResizeNaverObservedMap(null, current)).toBe(true);
        expect(shouldResizeNaverObservedMap(current, { ...current })).toBe(false);
        expect(shouldResizeNaverObservedMap(current, { ...current, map: {} })).toBe(true);
        expect(shouldResizeNaverObservedMap(current, { ...current, target: {} as Element })).toBe(true);
    });

    test('preserves actual resizing, subpixel changes and hide/reveal dimensions', () => {
        const current = size();
        for (const next of [{ width: 844 }, { height: 390 }, { width: 390.25 }, { width: 0, height: 0 }]) {
            expect(shouldResizeNaverObservedMap(current, { ...current, ...next })).toBe(true);
        }
        expect(shouldResizeNaverObservedMap({ ...current, width: 0, height: 0 }, current)).toBe(true);
    });

    test('keeps unknown measurements on the existing resize path', () => {
        const current = size();
        expect(shouldResizeNaverObservedMap(current, { ...current, width: NaN })).toBe(true);
        expect(shouldResizeNaverObservedMap(current, { ...current, height: Infinity })).toBe(true);
    });

    test('unchanged size still runs post-transition centering without SDK resize', () => {
        const current = size();
        const callbacks: Array<() => void> = [];
        const calls: string[] = [];
        const helper = buildNaverResizeObserverHandler({
            runAfterTransition: () => calls.push('center'),
            clearTimeoutFn: () => {},
            requestAnimationFrameFn: (callback) => { callback(0); return 1; },
            setTimeoutFn: ((callback: () => void) => { callbacks.push(callback); return 1; }) as typeof setTimeout,
            triggerResize: () => { if (shouldResizeNaverObservedMap(current, { ...current })) calls.push('SDK resize'); },
        });
        helper.observerCallback();
        expect(calls).toEqual([]);
        callbacks[0]();
        expect(calls).toEqual(['center']);
        helper.cancel();
    });
});

describe('naver map resize observer helpers', () => {
    test('triggers immediate resize and debounced post-transition work', () => {
        const queue: Array<() => void> = [];
        const cleared: number[] = [];
        const calls: string[] = [];

        const helper = buildNaverResizeObserverHandler({
            clearTimeoutFn: (id) => {
                cleared.push(id as unknown as number);
            },
            requestAnimationFrameFn: ((cb: FrameRequestCallback) => {
                queue.push(() => cb(0));
                return queue.length;
            }) as typeof requestAnimationFrame,
            runAfterTransition: () => calls.push('after'),
            setTimeoutFn: ((fn: () => void) => {
                queue.push(fn);
                return queue.length as unknown as ReturnType<typeof setTimeout>;
            }) as typeof setTimeout,
            triggerResize: () => calls.push('resize'),
        });

        helper.observerCallback();
        helper.observerCallback();

        expect(calls).toEqual(['resize', 'resize']);
        expect(cleared).toEqual([1]);

        queue[1]();
        queue[2]();

        expect(calls).toEqual(['resize', 'resize', 'after']);
    });

    test('cancel clears pending debounce', () => {
        const cleared: number[] = [];
        const helper = buildNaverResizeObserverHandler({
            clearTimeoutFn: (id) => {
                cleared.push(id as unknown as number);
            },
            runAfterTransition: () => {},
            setTimeoutFn: (() => 7 as unknown as ReturnType<typeof setTimeout>) as typeof setTimeout,
            triggerResize: () => {},
        });

        helper.observerCallback();
        helper.cancel();

        expect(cleared).toEqual([7]);
    });

    test('cleanup disconnects observer before cancelling debounce', () => {
        const calls: string[] = [];
        const cleanup = buildNaverResizeObserverCleanup({
            cancel: () => calls.push('cancel'),
            disconnect: () => calls.push('disconnect'),
        });

        cleanup();

        expect(calls).toEqual(['disconnect', 'cancel']);
    });
});
