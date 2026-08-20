import { describe, expect, test } from 'bun:test';

import {
    buildNaverMapToastTrigger,
    resolveNaverAnnouncementToastClickPlan,
    resolveNaverAnnouncementToastCleanupPlan,
    resolveNaverAnnouncementToastInactivePlan,
    resolveNaverAnnouncementToastPlan,
    resolveNaverAnnouncementToastSchedulePlan,
} from '../lib/naver-map-toast-helpers';
import {
    NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS,
    NAVER_MAP_ONLINE_USERS_HIDE_DELAY_MS,
    NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES,
    NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS,
    NAVER_MAP_TOAST_HIDE_DELAY_MS,
} from '../lib/naver-map-overlay-timings';

describe('naver map toast helpers', () => {
    test('shows toast immediately and schedules the hide update on a fake timer', () => {
        const calls: Array<any> = [];
        const timers: Array<{ callback: () => void; delayMs: number | undefined }> = [];
        const fakeSetTimeout = ((callback: () => void, delayMs?: number) => {
            timers.push({ callback, delayMs });
            return 1 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout;
        const trigger = buildNaverMapToastTrigger((value) => calls.push(value), {
            setTimeoutFn: fakeSetTimeout,
        });

        trigger('완료', 'success');

        expect(calls).toEqual([{ message: '완료', type: 'success', isVisible: true }]);
        expect(timers).toHaveLength(1);
        expect(timers[0].delayMs).toBe(NAVER_MAP_TOAST_HIDE_DELAY_MS);

        timers[0].callback();
        expect(typeof calls[1]).toBe('function');
        expect(calls[1]({ message: '완료', type: 'success', isVisible: true })).toEqual({
            message: '완료',
            type: 'success',
            isVisible: false,
        });
    });

    test('cancels and version-fences an older hide timer across retrigger and disposal', () => {
        type ToastState = { message: string; type: 'success' | 'error' | 'info'; isVisible: boolean } | null;
        let state: ToastState = null;
        let nextTimerId = 0;
        const callbacks = new Map<number, () => void>();
        const clearedTimerIds: number[] = [];
        const setTimeoutFn = ((callback: () => void) => {
            nextTimerId += 1;
            callbacks.set(nextTimerId, callback);
            return nextTimerId as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout;
        const clearTimeoutFn = ((timerId: ReturnType<typeof setTimeout>) => {
            clearedTimerIds.push(timerId as unknown as number);
        }) as typeof clearTimeout;
        const trigger = buildNaverMapToastTrigger((value) => {
            state = typeof value === 'function' ? value(state) : value;
        }, { clearTimeoutFn, setTimeoutFn });

        trigger('첫 알림', 'info');
        trigger('둘째 알림', 'success');
        expect(clearedTimerIds).toEqual([1]);
        expect(state).toEqual({ message: '둘째 알림', type: 'success', isVisible: true });

        callbacks.get(1)?.();
        expect(state).toEqual({ message: '둘째 알림', type: 'success', isVisible: true });
        callbacks.get(2)?.();
        expect(state).toEqual({ message: '둘째 알림', type: 'success', isVisible: false });

        trigger('언마운트 직전', 'error');
        trigger.dispose();
        expect(clearedTimerIds).toEqual([1, 3]);
        callbacks.get(3)?.();
        expect(state).toEqual({ message: '언마운트 직전', type: 'error', isVisible: true });

        trigger('정리 뒤 무시', 'info');
        expect(state).toEqual({ message: '언마운트 직전', type: 'error', isVisible: true });
        expect(callbacks.has(4)).toBe(false);

        trigger.activate();
        trigger('Strict Mode 재활성화', 'info');
        expect(state).toEqual({ message: 'Strict Mode 재활성화', type: 'info', isVisible: true });
        expect(callbacks.has(4)).toBe(true);
    });

    test('resolves rotating announcement toast display plan', () => {
        const announcements = [
            { id: 'a1', title: '첫 공지' },
            { id: 'a2', title: '둘째 공지' },
        ];

        expect(resolveNaverAnnouncementToastPlan({
            announcements,
            currentIndex: 3,
        })).toEqual({
            announcement: announcements[1],
            hideDelayMs: NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS,
            nextIndex: 0,
            shouldShow: true,
        });
    });

    test('keeps temporary overlay animation durations equal to their hide timers', () => {
        expect(NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES.announcement).toContain(
            `mapOverlayFade_${NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS / 1000}s`,
        );
        expect(NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES.restaurantCount).toContain(
            `mapOverlayFade_${NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS / 1000}s`,
        );
        expect(NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES.onlineUsers).toContain(
            `mapOverlayFade_${NAVER_MAP_ONLINE_USERS_HIDE_DELAY_MS / 1000}s`,
        );
    });

    test('rotates through every banner announcement when multiple notices are exposed', () => {
        const announcements = [
            { id: 'a1', title: '첫 공지' },
            { id: 'a2', title: '둘째 공지' },
            { id: 'a3', title: '셋째 공지' },
        ];
        let currentIndex = 0;
        const visibleTitles: string[] = [];

        for (let count = 0; count < announcements.length * 2; count += 1) {
            const plan = resolveNaverAnnouncementToastPlan({
                announcements,
                currentIndex,
            });
            if (plan.announcement) {
                visibleTitles.push(plan.announcement.title);
            }
            currentIndex = plan.nextIndex;
        }

        expect(visibleTitles).toEqual([
            '첫 공지',
            '둘째 공지',
            '셋째 공지',
            '첫 공지',
            '둘째 공지',
            '셋째 공지',
        ]);
    });

    test('does not show announcement toast when there are no announcements', () => {
        expect(resolveNaverAnnouncementToastPlan({
            announcements: [],
            currentIndex: 3,
            hideDelayMs: 1000,
        })).toEqual({
            announcement: null,
            hideDelayMs: 1000,
            nextIndex: 0,
            shouldShow: false,
        });
    });

    test('resolves inactive announcement toast state and timer cleanup flags', () => {
        expect(resolveNaverAnnouncementToastInactivePlan({
            hasHideTimer: true,
            hasInitialTimer: false,
        })).toEqual({
            nextTitle: '',
            shouldClearHideTimer: true,
            shouldClearInitialTimer: false,
            shouldShowAnnouncementToast: false,
        });
    });

    test('resolves announcement toast initial and interval schedule policy', () => {
        expect(resolveNaverAnnouncementToastSchedulePlan({
            hasExistingInitialTimer: true,
            intervalMs: 60000,
        })).toEqual({
            initialDelayMs: 0,
            intervalMs: 60000,
            shouldClearExistingInitialTimer: true,
        });
    });

    test('resolves announcement cleanup flags for interval and timers', () => {
        expect(resolveNaverAnnouncementToastCleanupPlan({
            hasHideTimer: false,
            hasInitialTimer: true,
        })).toEqual({
            shouldClearHideTimer: false,
            shouldClearInitialTimer: true,
            shouldClearInterval: true,
        });
    });

    test('resolves announcement click target for active toast id', () => {
        const announcements = [
            { id: 'a1', title: '첫 공지' },
            { id: 'a2', title: '둘째 공지' },
        ];

        expect(resolveNaverAnnouncementToastClickPlan({
            announcementToastId: 'a2',
            announcements,
        })).toEqual({
            targetAnnouncement: announcements[1],
            shouldDispatch: true,
        });

        expect(resolveNaverAnnouncementToastClickPlan({
            announcementToastId: 'missing',
            announcements,
        })).toEqual({
            targetAnnouncement: null,
            shouldDispatch: false,
        });

        expect(resolveNaverAnnouncementToastClickPlan({
            announcementToastId: null,
            announcements,
        })).toEqual({
            targetAnnouncement: null,
            shouldDispatch: false,
        });
    });
});
