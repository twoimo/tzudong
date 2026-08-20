import { describe, expect, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    NAVER_MAP_TIMED_OVERLAY_LIFECYCLE_POLICY,
    NaverMapOverlayStack,
    resolveNaverMapOverlayKind,
    resolveNaverMapTimedOverlayDropPlan,
} from '../components/map/naver-map-overlay-stack';
import {
    NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS,
    NAVER_MAP_ONLINE_USERS_HIDE_DELAY_MS,
    NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS,
    NAVER_MAP_TOAST_HIDE_DELAY_MS,
} from '../lib/naver-map-overlay-timings';

const baseProps: ComponentProps<typeof NaverMapOverlayStack> = {
    announcementToastTitle: '',
    badgePositionClass: 'fixture-position',
    count: 2,
    isLoaded: true,
    isLoadingRestaurants: false,
    mapToast: null,
    restaurantCountToastCount: 3,
    restaurantsLength: 3,
    showAnnouncementToast: false,
    showOnlineUsers: false,
    showRestaurantCount: false,
};

function renderOverlay(overrides: Partial<ComponentProps<typeof NaverMapOverlayStack>> = {}) {
    return renderToStaticMarkup(<NaverMapOverlayStack {...baseProps} {...overrides} />);
}

describe('NaverMapOverlayStack', () => {
    test('mounts exactly the loading notice at the highest priority', () => {
        const html = renderOverlay({
            announcementToastTitle: '공지',
            isLoadingRestaurants: true,
            mapToast: { message: '저장 완료', type: 'success', isVisible: true },
            showAnnouncementToast: true,
            showOnlineUsers: true,
            showRestaurantCount: true,
        });

        expect(html).toContain('data-map-overlay-kind="loading"');
        expect(html).toContain('맛집 핀 배치 중');
        expect(html).not.toContain('<button');
        expect(html).not.toContain('저장 완료');
        expect(html).not.toContain('공지사항 열기');
    });

    test('lets an active map toast replace the interactive announcement', () => {
        const html = renderOverlay({
            announcementToastTitle: '중요 공지',
            mapToast: { message: '저장 실패', type: 'error', isVisible: true },
            showAnnouncementToast: true,
        });

        expect(html).toContain('data-map-overlay-kind="map-toast"');
        expect(html).toContain('저장 실패');
        expect(html).toContain('role="alert"');
        expect(html).not.toContain('<button');
        expect(html).not.toContain('중요 공지');
    });

    test('mounts the announcement button only while it owns the visible slot', () => {
        const html = renderOverlay({
            announcementToastTitle: '중요 공지',
            showAnnouncementToast: true,
            showOnlineUsers: true,
            showRestaurantCount: true,
        });

        expect(html).toContain('data-map-overlay-kind="announcement"');
        expect(html.match(/<button/g)).toHaveLength(1);
        expect(html).toContain('pointer-events-auto');
        expect(html).toContain('mapOverlayFade_12s');
        expect(html).not.toContain('3개의 맛집 발견');
        expect(html).not.toContain('2명이 함께 보는 중');
    });

    test('keeps the empty state persistent and non-interactive', () => {
        const html = renderOverlay({ restaurantsLength: 0 });

        expect(html).toContain('data-map-overlay-kind="empty"');
        expect(html).toContain('이 지역에 등록된 맛집이 없습니다');
        expect(html).not.toContain('mapOverlayFade');
        expect(html).not.toContain('<button');
    });

    test('drops preempted timed occurrences without stale resume under fake timers', () => {
        type TimerTask = { at: number; callback: () => void; cancelled: boolean };
        let now = 0;
        let nextTimerId = 0;
        const tasks = new Map<number, TimerTask>();
        const schedule = (delayMs: number, callback: () => void) => {
            nextTimerId += 1;
            tasks.set(nextTimerId, { at: now + delayMs, callback, cancelled: false });
            return nextTimerId;
        };
        const cancel = (timerId: number | null) => {
            if (timerId === null) return;
            const task = tasks.get(timerId);
            if (task) task.cancelled = true;
        };
        const advanceBy = (delayMs: number) => {
            const target = now + delayMs;
            for (const task of [...tasks.values()].sort((left, right) => left.at - right.at)) {
                if (!task.cancelled && task.at <= target) {
                    now = task.at;
                    task.callback();
                    task.cancelled = true;
                }
            }
            now = target;
        };
        const state = {
            announcement: false,
            mapToast: false,
            onlineUsers: false,
            restaurantCount: false,
        };
        const timerIds: Record<keyof typeof state, number | null> = {
            announcement: null,
            mapToast: null,
            onlineUsers: null,
            restaurantCount: null,
        };
        const show = (kind: keyof typeof state, durationMs: number) => {
            state[kind] = true;
            cancel(timerIds[kind]);
            timerIds[kind] = schedule(durationMs, () => {
                state[kind] = false;
                timerIds[kind] = null;
            });
        };
        const drop = (kind: keyof typeof state) => {
            state[kind] = false;
            cancel(timerIds[kind]);
            timerIds[kind] = null;
        };
        let previousKind: ReturnType<typeof resolveNaverMapOverlayKind> = null;
        let announcementMounts = 0;
        const reconcile = (restaurantsLength = 3) => {
            const kind = resolveNaverMapOverlayKind({
                hasAnnouncementTitle: true,
                isLoaded: true,
                isLoadingRestaurants: false,
                isMapToastVisible: state.mapToast,
                restaurantsLength,
                showAnnouncementToast: state.announcement,
                showOnlineUsers: state.onlineUsers,
                showRestaurantCount: state.restaurantCount,
            });
            if (kind === 'announcement' && previousKind !== 'announcement') announcementMounts += 1;
            previousKind = kind;
            const plan = resolveNaverMapTimedOverlayDropPlan(kind);
            if (plan.dropMapToast) drop('mapToast');
            if (plan.dropAnnouncement) drop('announcement');
            if (plan.dropRestaurantCount) drop('restaurantCount');
            if (plan.dropOnlineUsers) drop('onlineUsers');
            return kind;
        };

        expect(NAVER_MAP_TIMED_OVERLAY_LIFECYCLE_POLICY).toEqual({
            lowerPriorityOnPreemption: 'drop',
            timedOccurrenceResume: 'never',
            persistentEmptyResume: 'when-timed-slot-clears',
        });

        show('restaurantCount', NAVER_MAP_RESTAURANT_COUNT_HIDE_DELAY_MS);
        expect(reconcile()).toBe('restaurant-count');
        advanceBy(500);

        show('announcement', NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS);
        expect(reconcile()).toBe('announcement');
        expect(state.restaurantCount).toBe(false);
        expect(renderOverlay({
            announcementToastTitle: '선점 공지',
            showAnnouncementToast: state.announcement,
            showOnlineUsers: state.onlineUsers,
            showRestaurantCount: state.restaurantCount,
        })).toContain('<button');

        show('onlineUsers', NAVER_MAP_ONLINE_USERS_HIDE_DELAY_MS);
        expect(reconcile()).toBe('announcement');
        expect(state.onlineUsers).toBe(false);

        show('mapToast', NAVER_MAP_TOAST_HIDE_DELAY_MS);
        expect(reconcile()).toBe('map-toast');
        expect(state.announcement).toBe(false);
        expect(renderOverlay({
            announcementToastTitle: '선점 공지',
            mapToast: { message: '상위 알림', type: 'info', isVisible: state.mapToast },
            showAnnouncementToast: state.announcement,
        })).not.toContain('<button');
        advanceBy(NAVER_MAP_TOAST_HIDE_DELAY_MS);

        expect(reconcile()).toBe(null);
        advanceBy(NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS);
        expect(reconcile()).toBe(null);
        expect(announcementMounts).toBe(1);
        expect(renderOverlay({
            announcementToastTitle: '선점 공지',
            mapToast: { message: '상위 알림', type: 'info', isVisible: state.mapToast },
            showAnnouncementToast: state.announcement,
        })).not.toContain('<button');

        show('announcement', NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS);
        expect(reconcile(0)).toBe('announcement');
        advanceBy(NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS);
        expect(reconcile(0)).toBe('empty');
        expect(renderOverlay({
            announcementToastTitle: '새 공지',
            restaurantsLength: 0,
            showAnnouncementToast: state.announcement,
        })).toContain('data-map-overlay-kind="empty"');
    });
});
