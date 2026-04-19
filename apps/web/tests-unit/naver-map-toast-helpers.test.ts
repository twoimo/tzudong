import { describe, expect, test } from 'bun:test';

import { buildNaverMapToastTrigger } from '../lib/naver-map-toast-helpers';

describe('naver map toast helpers', () => {
    test('shows toast immediately and schedules hide update', () => {
        const calls: Array<any> = [];
        const originalSetTimeout = globalThis.setTimeout;

        globalThis.setTimeout = ((fn: TimerHandler) => {
            if (typeof fn === 'function') {
                fn();
            }
            return 0 as any;
        }) as typeof setTimeout;

        try {
            const trigger = buildNaverMapToastTrigger((value) => calls.push(value));
            trigger('완료', 'success');

            expect(calls[0]).toEqual({ message: '완료', type: 'success', isVisible: true });
            expect(typeof calls[1]).toBe('function');
            expect(calls[1]({ message: '완료', type: 'success', isVisible: true })).toEqual({
                message: '완료',
                type: 'success',
                isVisible: false,
            });
        } finally {
            globalThis.setTimeout = originalSetTimeout;
        }
    });
});
