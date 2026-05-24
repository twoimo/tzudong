import { describe, expect, test } from 'bun:test';

import {
    buildNaverMapToastTrigger,
    resolveNaverAnnouncementToastClickPlan,
    resolveNaverAnnouncementToastCleanupPlan,
    resolveNaverAnnouncementToastInactivePlan,
    resolveNaverAnnouncementToastPlan,
    resolveNaverAnnouncementToastSchedulePlan,
} from '../lib/naver-map-toast-helpers';

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
            hideDelayMs: 4200,
            nextIndex: 0,
            shouldShow: true,
        });
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
            initialDelayMs: 9000,
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
