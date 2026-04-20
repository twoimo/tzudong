import { describe, expect, test } from 'bun:test';

import { buildNaverResizeObserverHandler } from '../lib/naver-map-resize-observer-helpers';

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
});
