import { describe, expect, test } from 'bun:test';

import { buildNaverWindowResizeHandler } from '../lib/naver-map-window-resize-helpers';

describe('naver map window resize helpers', () => {
    test('debounces resize and triggers only the latest scheduled resize', () => {
        const queue: Array<() => void> = [];
        const cleared: number[] = [];
        const calls: string[] = [];

        const helper = buildNaverWindowResizeHandler({
            clearTimeoutFn: (id) => {
                cleared.push(id as unknown as number);
            },
            getMap: () => ({ id: 'map' }),
            setTimeoutFn: ((fn: () => void) => {
                queue.push(fn);
                return queue.length as unknown as ReturnType<typeof setTimeout>;
            }) as typeof setTimeout,
            triggerResize: (map) => {
                calls.push((map as { id: string }).id);
            },
        });

        helper.handleWindowResize();
        helper.handleWindowResize();

        expect(cleared).toEqual([1]);
        expect(calls).toEqual([]);

        queue[1]();
        expect(calls).toEqual(['map']);
    });

    test('cancel clears pending resize', () => {
        const cleared: number[] = [];
        const helper = buildNaverWindowResizeHandler({
            clearTimeoutFn: (id) => {
                cleared.push(id as unknown as number);
            },
            getMap: () => null,
            setTimeoutFn: ((fn: () => void) => {
                void fn;
                return 7 as unknown as ReturnType<typeof setTimeout>;
            }) as typeof setTimeout,
            triggerResize: () => {},
        });

        helper.handleWindowResize();
        helper.cancel();

        expect(cleared).toEqual([7]);
    });
});
