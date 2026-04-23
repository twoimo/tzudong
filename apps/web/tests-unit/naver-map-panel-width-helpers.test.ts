import { describe, expect, test } from 'bun:test';

import { buildNaverPanelWidthObserver } from '../lib/naver-map-panel-width-helpers';

describe('naver map panel width helpers', () => {
    test('batches width updates via requestAnimationFrame and cancels previous frame', () => {
        const calls: number[] = [];
        const cancelled: number[] = [];
        const queue: Array<() => void> = [];

        const helper = buildNaverPanelWidthObserver({
            cancelAnimationFrameFn: (id) => {
                cancelled.push(id);
            },
            requestAnimationFrameFn: ((callback: FrameRequestCallback) => {
                queue.push(() => callback(0));
                return queue.length;
            }) as typeof requestAnimationFrame,
            setPanelWidth: (width) => {
                calls.push(width);
            },
        });

        helper.observerCallback([{ contentRect: { width: 320 } }]);
        helper.observerCallback([{ contentRect: { width: 360 } }]);

        expect(cancelled).toEqual([1]);
        expect(calls).toEqual([]);

        queue[1]();
        expect(calls).toEqual([360]);
    });

    test('cancels pending frame on cleanup', () => {
        const cancelled: number[] = [];

        const helper = buildNaverPanelWidthObserver({
            cancelAnimationFrameFn: (id) => {
                cancelled.push(id);
            },
            requestAnimationFrameFn: (() => 7) as typeof requestAnimationFrame,
            setPanelWidth: () => {},
        });

        helper.observerCallback([{ contentRect: { width: 400 } }]);
        helper.cancelPending();

        expect(cancelled).toEqual([7]);
    });
});
